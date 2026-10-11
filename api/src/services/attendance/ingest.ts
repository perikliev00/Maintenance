import {
  AttendanceEventKind,
  AttendanceIntervalStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { getOperations } from "../settings";
import { hotelDateAsUtcDate } from "../hotelTime";
import { rebuildIntervalsForEmployee } from "./rebuild";

type Tx = Prisma.TransactionClient;

function isP2002(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

function p2002Targets(err: Prisma.PrismaClientKnownRequestError): string[] {
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === "string") return [target];
  return [];
}

function isAttendanceEventUniqueConflict(
  err: Prisma.PrismaClientKnownRequestError,
) {
  const targets = p2002Targets(err).map((t) => t.toLowerCase());
  return targets.some(
    (t) =>
      t.includes("source") ||
      t.includes("externaleventid") ||
      t.includes("source_externaleventid"),
  );
}

async function findIntervalForEvent(
  event: {
    id: string;
    kind: AttendanceEventKind;
    employeeId: string;
    normalizedTime: Date;
  },
  db: Tx | typeof prisma = prisma,
) {
  const linked = await db.attendanceInterval.findFirst({
    where: {
      OR: [{ startEventId: event.id }, { endEventId: event.id }],
    },
    select: { id: true },
  });
  if (linked) return linked;
  if (
    event.kind === AttendanceEventKind.break_start ||
    event.kind === AttendanceEventKind.break_end
  ) {
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
  return null;
}

async function reconcileExistingEvent<
  T extends {
    id: string;
    kind: AttendanceEventKind;
    employeeId: string;
    normalizedTime: Date;
  },
>(existing: T) {
  let linked = await findIntervalForEvent(existing);
  if (!linked) {
    const ops = await getOperations();
    const hotelDate = hotelDateAsUtcDate(
      existing.normalizedTime,
      ops.hotelTimezone,
    );
    await prisma.$transaction(async (tx) => {
      await rebuildIntervalsForEmployee(
        existing.employeeId,
        hotelDate,
        ops.hotelTimezone,
        tx,
      );
    });
    linked = await findIntervalForEvent(existing);
  }
  return {
    event: existing,
    created: false as const,
    intervalId: linked?.id ?? null,
  };
}

export async function ingestEvent(input: {
  externalEventId: string;
  source?: string;
  employeeId: string;
  kind: AttendanceEventKind;
  deviceTime: string;
  receivedAt?: string;
  clockSkewSeconds?: number | null;
}) {
  const source = input.source?.trim() || "terminal_sim";
  const existing = await prisma.attendanceEvent.findUnique({
    where: {
      source_externalEventId: {
        source,
        externalEventId: input.externalEventId,
      },
    },
  });

  if (existing) {
    return reconcileExistingEvent(existing);
  }

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
  });
  if (!employee) {
    throw new AppError(404, "not_found", "Employee not found");
  }

  const deviceTime = new Date(input.deviceTime);
  if (Number.isNaN(deviceTime.getTime())) {
    throw new AppError(400, "validation", "Invalid deviceTime");
  }
  const receivedAt = input.receivedAt
    ? new Date(input.receivedAt)
    : new Date();
  const normalizedTime = deviceTime;
  const skew =
    input.clockSkewSeconds ??
    Math.round((deviceTime.getTime() - receivedAt.getTime()) / 1000);
  const ops = await getOperations();
  const hotelDate = hotelDateAsUtcDate(normalizedTime, ops.hotelTimezone);

  try {
    const result = await prisma.$transaction(async (tx) => {
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

      await rebuildIntervalsForEmployee(
        input.employeeId,
        hotelDate,
        ops.hotelTimezone,
        tx,
      );

      const linked = await findIntervalForEvent(event, tx);
      return { event, intervalId: linked?.id ?? null };
    });

    return { event: result.event, created: true, intervalId: result.intervalId };
  } catch (err) {
    if (isP2002(err) && isAttendanceEventUniqueConflict(err)) {
      const again = await prisma.attendanceEvent.findUnique({
        where: {
          source_externalEventId: {
            source,
            externalEventId: input.externalEventId,
          },
        },
      });
      if (again) {
        return reconcileExistingEvent(again);
      }
    }
    throw err;
  }
}
