/**
 * Idempotent attendance event ingest from terminals / simulators.
 * Unique on `(source, externalEventId)`; always rebuilds intervals for the
 * employee hotel day after a successful insert (or reconciles on conflict).
 */
import {
  AttendanceEventKind,
  AttendanceIntervalStatus,
  Prisma,
// Support the surrounding control flow.
} from "@prisma/client";
// Shared Prisma client singleton.
import { prisma } from "../../db";
// Runtime import from ../../errors.
import { AppError } from "../../errors";
// Runtime import from ../settings.
import { getOperations } from "../settings";
// Runtime import from ../hotelTime.
import { hotelDateAsUtcDate } from "../hotelTime";
// Runtime import from ../db/prismaErrors.
import { isP2002, p2002Targets } from "../db/prismaErrors";
// Type-only import from ../db/types (erased at runtime).
import type { Tx } from "../db/types";
// Runtime import from ./rebuild.
import { rebuildIntervalsForEmployee } from "./rebuild";

/** True when the unique conflict is on (source, externalEventId). */
function isAttendanceEventUniqueConflict(
  // Param err required by this function.
  err: Prisma.PrismaClientKnownRequestError,
) {
  // Local binding for this step.
  const targets = p2002Targets(err).map((t) => t.toLowerCase());
  // Return result to caller.
  return targets.some(
    // Support the surrounding control flow.
    (t) =>
      // Additional clause in this boolean decision.
      t.includes("source") ||
      // Additional clause in this boolean decision.
      t.includes("externaleventid") ||
      // Support the surrounding control flow.
      t.includes("source_externaleventid"),
  );
}

/**
 * Resolve the interval linked to an event (start/end ids), or for break events
 * the covering non-adjusted interval by time window.
 */
async function findIntervalForEvent(
  // Param event required by this function.
  event: {
    // Param id required by this function.
    id: string;
    // Param kind required by this function.
    kind: AttendanceEventKind;
    // Param employeeId required by this function.
    employeeId: string;
    // Param normalizedTime required by this function.
    normalizedTime: Date;
  },
  // Param db required by this function.
  db: Tx | typeof prisma = prisma,
) {
  // Prefer intervals that explicitly reference this event as start or end.
  const linked = await db.attendanceInterval.findFirst({
    // Filter matching rows.
    where: {
      // Field OR on this type/payload.
      OR: [{ startEventId: event.id }, { endEventId: event.id }],
    },
    // Select only needed columns.
    select: { id: true },
  });
  // Guard / branch on preconditions.
  if (linked) return linked;
  // Break punches sit inside a shift — find the covering non-adjusted interval.
  if (
    // Additional clause in this boolean decision.
    event.kind === AttendanceEventKind.break_start ||
    // Assign event.kind.
    event.kind === AttendanceEventKind.break_end
  ) {
    // Return result to caller.
    return db.attendanceInterval.findFirst({
      // Filter matching rows.
      where: {
        // Field employeeId on this type/payload.
        employeeId: event.employeeId,
        // Time field startedAt.
        startedAt: { lte: event.normalizedTime },
        // Field OR on this type/payload.
        OR: [
          // Support the surrounding control flow.
          { endedAt: null },
          // Support the surrounding control flow.
          { endedAt: { gte: event.normalizedTime } },
        ],
        // Field status on this type/payload.
        status: { not: AttendanceIntervalStatus.adjusted },
      },
      // Stable sort for paging.
      orderBy: { startedAt: "desc" },
      // Select only needed columns.
      select: { id: true },
    });
  }
  // Clock-in/out without a link yet — caller may rebuild first.
  return null;
}

/** Ensure an existing event has a linked interval (rebuild hotel day if needed). */
async function reconcileExistingEvent<
  // Support the surrounding control flow.
  T extends {
    // Param id required by this function.
    id: string;
    // Param kind required by this function.
    kind: AttendanceEventKind;
    // Param employeeId required by this function.
    employeeId: string;
    // Param normalizedTime required by this function.
    normalizedTime: Date;
  },
// Support the surrounding control flow.
>(existing: T) {
  // Try current link first (cheap path for already-reconciled events).
  let linked = await findIntervalForEvent(existing);
  // Guard / branch on preconditions.
  if (!linked) {
    // Rebuild the hotel day so pairing can attach this event.
    const ops = await getOperations();
    // Local binding for this step.
    const hotelDate = hotelDateAsUtcDate(
      // Support the surrounding control flow.
      existing.normalizedTime,
      // Support the surrounding control flow.
      ops.hotelTimezone,
    );
    // Await async persistence or side effect.
    await prisma.$transaction(async (tx) => {
      // Await async persistence or side effect.
      await rebuildIntervalsForEmployee(
        // Support the surrounding control flow.
        existing.employeeId,
        hotelDate,
        // Support the surrounding control flow.
        ops.hotelTimezone,
        tx,
      );
    });
    // Re-resolve after rebuild.
    linked = await findIntervalForEvent(existing);
  }
  // Return result to caller.
  return {
    // Param event required by this function.
    event: existing,
    // Param created required by this function.
    created: false as const,
    // Param intervalId required by this function.
    intervalId: linked?.id ?? null,
  };
}

/**
 * Ingest one punch event. Retries with the same external id return the existing
 * event (`created: false`) after ensuring intervals are rebuilt/linked.
 */
export async function ingestEvent(input: {
  // Param externalEventId required by this function.
  externalEventId: string;
  // Param source required by this function.
  source?: string;
  // Param employeeId required by this function.
  employeeId: string;
  // Param kind required by this function.
  kind: AttendanceEventKind;
  // Param deviceTime required by this function.
  deviceTime: string;
  // Param receivedAt required by this function.
  receivedAt?: string;
  // Param clockSkewSeconds required by this function.
  clockSkewSeconds?: number | null;
// Support the surrounding control flow.
}) {
  // Default source for simulator / unspecified terminals.
  const source = input.source?.trim() || "terminal_sim";
  // Lookup by unique (source, externalEventId) for idempotent retries.
  const existing = await prisma.attendanceEvent.findUnique({
    // Filter matching rows.
    where: {
      // Param source_externalEventId required by this function.
      source_externalEventId: {
        source,
        // Param externalEventId required by this function.
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
    // Filter matching rows.
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
    // Support the surrounding control flow.
    ? new Date(input.receivedAt)
    // Support the surrounding control flow.
    : new Date();
  // Conditional path for this guard.
  if (Number.isNaN(receivedAt.getTime())) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(400, "validation", "Invalid receivedAt");
  }
  // Normalized time currently equals deviceTime (no TZ rewrite here).
  const normalizedTime = deviceTime;
  // Skew seconds: explicit input or derived device−received delta.
  const skew =
    // Support the surrounding control flow.
    input.clockSkewSeconds ??
    // Support the surrounding control flow.
    Math.round((deviceTime.getTime() - receivedAt.getTime()) / 1000);
  // Hotel calendar day for interval rebuild scoping.
  const ops = await getOperations();
  // Local binding for this step.
  const hotelDate = hotelDateAsUtcDate(normalizedTime, ops.hotelTimezone);

  // Catch locally so callers get mapped errors.
  try {
    // Insert event + rebuild intervals atomically.
    const result = await prisma.$transaction(async (tx) => {
      // Serialize per-employee rebuilds so concurrent punches cannot fork intervals.
      await tx.$executeRaw`
        // Support the surrounding control flow.
        SELECT id FROM "Employee" WHERE id = ${input.employeeId} FOR UPDATE
      // Support the surrounding control flow.
      `;
      // Await async query or service call.
      const event = await tx.attendanceEvent.create({
        // Mutation data payload.
        data: {
          // Param externalEventId required by this function.
          externalEventId: input.externalEventId,
          source,
          // Param employeeId required by this function.
          employeeId: input.employeeId,
          // Param kind required by this function.
          kind: input.kind,
          deviceTime,
          receivedAt,
          normalizedTime,
          // Param clockSkewSeconds required by this function.
          clockSkewSeconds: skew,
        },
      });

      // Pair punches into intervals for this hotel day (+ prior day overnight).
      await rebuildIntervalsForEmployee(
        // Support the surrounding control flow.
        input.employeeId,
        hotelDate,
        // Support the surrounding control flow.
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
  // Support the surrounding control flow.
  } catch (err) {
    // Concurrent inserts racing on the unique key → treat as idempotent success.
    if (isP2002(err) && isAttendanceEventUniqueConflict(err)) {
      // Await async query or service call.
      const again = await prisma.attendanceEvent.findUnique({
        // Filter matching rows.
        where: {
          // Param source_externalEventId required by this function.
          source_externalEventId: {
            source,
            // Param externalEventId required by this function.
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
