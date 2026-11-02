/**
 * Idempotent attendance event ingest from terminals / simulators.
 * Unique on `(source, externalEventId)`; always rebuilds intervals for the
 * employee hotel day after a successful insert (or reconciles on conflict).
 */
import {
  AttendanceEventKind,
  AttendanceIntervalStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { getOperations } from "../settings";
import { hotelDateAsUtcDate } from "../hotelTime";
import { isP2002, p2002Targets } from "../db/prismaErrors";
import type { Tx } from "../db/types";
import { rebuildIntervalsForEmployee } from "./rebuild";

/** True when the unique conflict is on (source, externalEventId). */
function isAttendanceEventUniqueConflict(
  err: Prisma.PrismaClientKnownRequestError,
) {
  // Local binding for this step.
  const targets = p2002Targets(err).map((t) => t.toLowerCase());
  // Return result to caller.
  return targets.some(
    (t) =>
      t.includes("source") ||
      t.includes("externaleventid") ||
      t.includes("source_externaleventid"),
  );
}

/**
 * Resolve the interval linked to an event (start/end ids), or for break events
 * the covering non-adjusted interval by time window.
 */
async function findIntervalForEvent(
  event: {
    id: string;
    kind: AttendanceEventKind;
    employeeId: string;
    normalizedTime: Date;
  },
  db: Tx | typeof prisma = prisma,
) {
  // Prefer intervals that explicitly reference this event as start or end.
  const linked = await db.attendanceInterval.findFirst({
    where: {
      OR: [{ startEventId: event.id }, { endEventId: event.id }],
    },
    select: { id: true },
  });
  // Guard / branch on preconditions.
  if (linked) return linked;
  // Break punches sit inside a shift — find the covering non-adjusted interval.
  if (
    event.kind === AttendanceEventKind.break_start ||
    event.kind === AttendanceEventKind.break_end
  ) {
    // Return result to caller.
    return db.attendanceInterval.findFirst({
      where: {
        employeeId: event.employeeId,
        startedAt: { lte: event.normalizedTime },
        OR: [
          { endedAt: null },
          { endedAt: { gte: event.normalizedTime } },
        ],
        status: { not: AttendanceIntervalStatus.adjusted },
      },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
  }
  // Clock-in/out without a link yet — caller may rebuild first.
  return null;
}

/** Ensure an existing event has a linked interval (rebuild hotel day if needed). */
async function reconcileExistingEvent<
  T extends {
    id: string;
    kind: AttendanceEventKind;
    employeeId: string;
    normalizedTime: Date;
  },
>(existing: T) {
  // Try current link first (cheap path for already-reconciled events).
  let linked = await findIntervalForEvent(existing);
  // Guard / branch on preconditions.
  if (!linked) {
    // Rebuild the hotel day so pairing can attach this event.
    const ops = await getOperations();
    // Local binding for this step.
    const hotelDate = hotelDateAsUtcDate(
      existing.normalizedTime,
      ops.hotelTimezone,
    );
    // Await async persistence or side effect.
    await prisma.$transaction(async (tx) => {
      // Await async persistence or side effect.
      await rebuildIntervalsForEmployee(
        existing.employeeId,
        hotelDate,
        ops.hotelTimezone,
        tx,
      );
    });
    // Re-resolve after rebuild.
    linked = await findIntervalForEvent(existing);
  }
  // Return result to caller.
  return {
    event: existing,
    created: false as const,
    intervalId: linked?.id ?? null,
  };
}

/**
 * Ingest one punch event. Retries with the same external id return the existing
 * event (`created: false`) after ensuring intervals are rebuilt/linked.
 */
export async function ingestEvent(input: {
  externalEventId: string;
  source?: string;
  employeeId: string;
  kind: AttendanceEventKind;
  deviceTime: string;
  receivedAt?: string;
  clockSkewSeconds?: number | null;
}) {
  // Default source for simulator / unspecified terminals.
  const source = input.source?.trim() || "terminal_sim";
  // Lookup by unique (source, externalEventId) for idempotent retries.
  const existing = await prisma.attendanceEvent.findUnique({
    where: {
      source_externalEventId: {
        source,
        externalEventId: input.externalEventId,
      },
    },
  });

  // Idempotent: same (source, externalEventId) never creates a duplicate row.
  if (existing) {
    // Return result to caller.
    return reconcileExistingEvent(existing);
  }

  // Employee must exist before we accept a punch.
  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
  });
  // Guard / branch on preconditions.
  if (!employee) {
    // Fail closed with structured AppError.
    throw new AppError(404, "not_found", "Employee not found");
  }

  // Parse device clock; reject non-dates.
  const deviceTime = new Date(input.deviceTime);
  // Guard / branch on preconditions.
  if (Number.isNaN(deviceTime.getTime())) {
    // Fail closed with structured AppError.
    throw new AppError(400, "validation", "Invalid deviceTime");
  }
  // Server receive time defaults to now when the client omits it.
  const receivedAt = input.receivedAt
    ? new Date(input.receivedAt)
    : new Date();
  if (Number.isNaN(receivedAt.getTime())) {
    throw new AppError(400, "validation", "Invalid receivedAt");
  }
  // Normalized time currently equals deviceTime (no TZ rewrite here).
  const normalizedTime = deviceTime;
  // Skew seconds: explicit input or derived device−received delta.
  const skew =
    input.clockSkewSeconds ??
    Math.round((deviceTime.getTime() - receivedAt.getTime()) / 1000);
  // Hotel calendar day for interval rebuild scoping.
  const ops = await getOperations();
  // Local binding for this step.
  const hotelDate = hotelDateAsUtcDate(normalizedTime, ops.hotelTimezone);

  try {
    // Insert event + rebuild intervals atomically.
    const result = await prisma.$transaction(async (tx) => {
      // Serialize per-employee rebuilds so concurrent punches cannot fork intervals.
      await tx.$executeRaw`
        SELECT id FROM "Employee" WHERE id = ${input.employeeId} FOR UPDATE
      `;
      // Await async query or service call.
      const event = await tx.attendanceEvent.create({
        data: {
          externalEventId: input.externalEventId,
          source,
          employeeId: input.employeeId,
          kind: input.kind,
          deviceTime,
          receivedAt,
          normalizedTime,
          clockSkewSeconds: skew,
        },
      });

      // Pair punches into intervals for this hotel day (+ prior day overnight).
      await rebuildIntervalsForEmployee(
        input.employeeId,
        hotelDate,
        ops.hotelTimezone,
        tx,
      );

      // Resolve which interval now owns this event.
      const linked = await findIntervalForEvent(event, tx);
      // Return result to caller.
      return { event, intervalId: linked?.id ?? null };
    });

    // Return result to caller.
    return { event: result.event, created: true, intervalId: result.intervalId };
  } catch (err) {
    // Concurrent inserts racing on the unique key → treat as idempotent success.
    if (isP2002(err) && isAttendanceEventUniqueConflict(err)) {
      // Await async query or service call.
      const again = await prisma.attendanceEvent.findUnique({
        where: {
          source_externalEventId: {
            source,
            externalEventId: input.externalEventId,
          },
        },
      });
      // Guard / branch on preconditions.
      if (again) {
        // Return result to caller.
        return reconcileExistingEvent(again);
      }
    }
    // Step in workflow.
    throw err;
  }
}
