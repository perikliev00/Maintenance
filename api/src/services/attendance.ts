import {
  OPEN_MISSING_END_HOURS,
  addDaysYmd,
  asFlags,
  assertValidAdjustmentTimes,
  computeWorkedMinutes,
  hotelDateKey,
  pairEventsToIntervalDrafts,
  uniqueFlags,
  type AnomalyFlag,
  type FrozenRange,
} from "./attendanceRules";
import { getInterval } from "./attendanceReports";

export {
  OPEN_MISSING_END_HOURS,
  addDaysYmd,
  asFlags,
  assertValidAdjustmentTimes,
  computeWorkedMinutes,
  eventRequiresIntervalLink,
  hotelDateKey,
  pairEventsToIntervalDrafts,
  uniqueFlags,
  type AnomalyFlag,
  type FrozenRange,
  type IntervalDraft,
  type RebuildEvent,
} from "./attendanceRules";
export {
  EXPORT_BATCH,
  EXPORT_CEILING,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  decodeIntervalCursor,
  drainExportPages,
  encodeIntervalCursor,
  getInterval,
  intervalsToCsv,
  listIntervals,
  listIntervalsForExport,
  listPageFromRows,
  mapInterval,
  maxClockSkewSeconds,
  resolveListLimit,
  type IntervalCursor,
  type ListIntervalsFilter,
  type ListIntervalsPage,
} from "./attendanceReports";

import {
  AttendanceAdjustmentStatus,
  AttendanceEventKind,
  AttendanceIntervalStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { getOperations } from "./settings";
import { hotelDateAsUtcDate, hotelDateString, zonedDayStartUtc } from "./hotelTime";
import { recordAudit } from "./audit";
import {
  createNotifications,
  recipientsWithAction,
} from "./notifications";

export {
  hotelDateAsUtcDate,
  hotelDateString,
  resolveUsableHotelTimeZone,
  todayHotelDateYmd,
  zonedDayStartUtc,
} from "./hotelTime";

/** Open intervals older than this become `missing_end` → `needs_review`. */
/** Default page size for GET /attendance/intervals */

type Tx = Prisma.TransactionClient;






type StaleIntervalRow = {
  status: AttendanceIntervalStatus;
  endedAt: Date | null;
  startedAt: Date;
  anomalyFlags: unknown;
};

/** DB surface needed to claim a single stale open interval. */
export type StaleOpenClaimDb = {
  attendanceInterval: {
    findUnique: (args: {
      where: { id: string };
      select: {
        status: true;
        endedAt: true;
        startedAt: true;
        anomalyFlags: true;
      };
    }) => Promise<StaleIntervalRow | null>;
    updateMany: (args: {
      where: {
        id: string;
        status: typeof AttendanceIntervalStatus.open;
        endedAt: null;
        startedAt: { lte: Date };
      };
      data: {
        status: typeof AttendanceIntervalStatus.needs_review;
        anomalyFlags: AnomalyFlag[];
      };
    }) => Promise<{ count: number }>;
  };
};

/**
 * Atomically flag one interval as `missing_end` / `needs_review` only if it is
 * still open, has no end, and started at or before `cutoff`. Re-reads flags so
 * a concurrent close/adjust cannot be overwritten with a stale snapshot.
 * @internal exported for unit tests with a fake DB
 */
export async function claimStaleOpenInterval(
  db: StaleOpenClaimDb,
  id: string,
  cutoff: Date,
): Promise<boolean> {
  const row = await db.attendanceInterval.findUnique({
    where: { id },
    select: {
      status: true,
      endedAt: true,
      startedAt: true,
      anomalyFlags: true,
    },
  });
  if (
    !row ||
    row.status !== AttendanceIntervalStatus.open ||
    row.endedAt !== null ||
    row.startedAt.getTime() > cutoff.getTime()
  ) {
    return false;
  }

  const nextFlags = uniqueFlags([...asFlags(row.anomalyFlags), "missing_end"]);
  const claimed = await db.attendanceInterval.updateMany({
    where: {
      id,
      status: AttendanceIntervalStatus.open,
      endedAt: null,
      startedAt: { lte: cutoff },
    },
    data: {
      status: AttendanceIntervalStatus.needs_review,
      anomalyFlags: nextFlags,
    },
  });
  return claimed.count > 0;
}

/**
 * Persist `missing_end` / `needs_review` for open intervals that aged past
 * OPEN_MISSING_END_HOURS without a new ingest rebuild.
 */
export async function markStaleOpenIntervals(now = new Date()) {
  const cutoff = new Date(
    now.getTime() - OPEN_MISSING_END_HOURS * 3600_000,
  );
  const candidates = await prisma.attendanceInterval.findMany({
    where: {
      status: AttendanceIntervalStatus.open,
      endedAt: null,
      startedAt: { lte: cutoff },
    },
    select: { id: true },
  });

  let flagged = 0;
  for (const { id } of candidates) {
    if (
      await claimStaleOpenInterval(
        prisma as unknown as StaleOpenClaimDb,
        id,
        cutoff,
      )
    ) {
      flagged += 1;
    }
  }

  return { scanned: candidates.length, flagged };
}

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

/**
 * Rebuild intervals for the event's hotel day and the previous hotel day so
 * overnight clock-outs close the shift that started the day before.
 * Event fetch uses zoned local midnights; hotelDate column keys stay UTC YMD.
 */
export async function rebuildIntervalsForEmployee(
  employeeId: string,
  hotelDate: Date,
  timeZone: string,
  db: Tx | typeof prisma = prisma,
) {
  const centerYmd = hotelDate.toISOString().slice(0, 10);
  const prevYmd = addDaysYmd(centerYmd, -1);
  const replaceYmds = [prevYmd, centerYmd];
  const replaceKeys = replaceYmds.map(hotelDateKey);

  const from = zonedDayStartUtc(prevYmd, timeZone);
  const to = zonedDayStartUtc(addDaysYmd(centerYmd, 2), timeZone);

  const [events, frozen, replaceable] = await Promise.all([
    db.attendanceEvent.findMany({
      where: {
        employeeId,
        normalizedTime: { gte: from, lt: to },
      },
      orderBy: [
        { normalizedTime: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: {
        id: true,
        kind: true,
        normalizedTime: true,
        clockSkewSeconds: true,
      },
    }),
    db.attendanceInterval.findMany({
      where: {
        employeeId,
        hotelDate: { in: replaceKeys },
        status: AttendanceIntervalStatus.adjusted,
      },
      select: { id: true, startedAt: true, endedAt: true },
    }),
    db.attendanceInterval.findMany({
      where: {
        employeeId,
        hotelDate: { in: replaceKeys },
        status: { not: AttendanceIntervalStatus.adjusted },
      },
      include: {
        // Preserve pending requests and rejected history across rebuild.
        // Approved corrections live on frozen `adjusted` intervals above.
        adjustments: {
          where: {
            status: {
              in: [
                AttendanceAdjustmentStatus.pending,
                AttendanceAdjustmentStatus.rejected,
              ],
            },
          },
        },
      },
    }),
  ]);

  const adjustmentsToRematch = replaceable.flatMap((iv) =>
    iv.adjustments
      .filter((a) => iv.startEventId)
      .map((a) => ({
        startEventId: iv.startEventId!,
        requestedById: a.requestedById,
        reviewedById: a.reviewedById,
        reason: a.reason,
        proposedStartedAt: a.proposedStartedAt,
        proposedEndedAt: a.proposedEndedAt,
        proposedBreakMinutes: a.proposedBreakMinutes,
        status: a.status,
        createdAt: a.createdAt,
        reviewedAt: a.reviewedAt,
      })),
  );

  const replaceIds = replaceable.map((r) => r.id);
  if (replaceIds.length) {
    await db.attendanceAdjustment.deleteMany({
      where: { intervalId: { in: replaceIds } },
    });
    await db.attendanceInterval.deleteMany({
      where: { id: { in: replaceIds } },
    });
  }

  const frozenRanges: FrozenRange[] = frozen.map((f) => ({
    startMs: f.startedAt.getTime(),
    endMs: (f.endedAt ?? new Date(f.startedAt.getTime() + 36 * 3600_000)).getTime(),
  }));

  const drafts = pairEventsToIntervalDrafts({
    events,
    frozen: frozenRanges,
    timeZone,
  }).filter((d) => {
    const ymd = d.hotelDate.toISOString().slice(0, 10);
    return replaceYmds.includes(ymd);
  });

  const createdByStart = new Map<string, string>();
  for (const draft of drafts) {
    const created = await db.attendanceInterval.create({
      data: {
        employeeId,
        hotelDate: draft.hotelDate,
        startedAt: draft.startedAt,
        endedAt: draft.endedAt,
        startEventId: draft.startEventId,
        endEventId: draft.endEventId,
        breakMinutes: draft.breakMinutes,
        workedMinutes: draft.workedMinutes,
        anomalyFlags: draft.anomalyFlags,
        status: draft.status,
      },
    });
    if (draft.startEventId) {
      createdByStart.set(draft.startEventId, created.id);
    }
  }

  for (const adj of adjustmentsToRematch) {
    const intervalId = createdByStart.get(adj.startEventId);
    if (!intervalId) continue;
    await db.attendanceAdjustment.create({
      data: {
        intervalId,
        requestedById: adj.requestedById,
        reviewedById: adj.reviewedById,
        reason: adj.reason,
        proposedStartedAt: adj.proposedStartedAt,
        proposedEndedAt: adj.proposedEndedAt,
        proposedBreakMinutes: adj.proposedBreakMinutes,
        status: adj.status,
        createdAt: adj.createdAt,
        reviewedAt: adj.reviewedAt,
      },
    });
    if (adj.status === AttendanceAdjustmentStatus.pending) {
      await db.attendanceInterval.update({
        where: { id: intervalId },
        data: {
          status: AttendanceIntervalStatus.needs_review,
        },
      });
    }
  }
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

export async function requestAdjustment(input: {
  intervalId: string;
  requestedById: string;
  actorRole: Role;
  reason: string;
  proposedStartedAt?: string;
  proposedEndedAt?: string;
  proposedBreakMinutes?: number;
}) {
  const interval = await prisma.attendanceInterval.findUnique({
    where: { id: input.intervalId },
  });
  if (!interval) {
    throw new AppError(404, "not_found", "Attendance interval not found");
  }

  const isOwner = input.actorRole === Role.owner;
  const privileged: Role[] = [
    Role.supervisor,
    Role.manager,
    Role.admin,
    Role.owner,
  ];
  const isPrivileged = privileged.includes(input.actorRole);
  if (
    !isOwner &&
    !isPrivileged &&
    interval.employeeId !== input.requestedById
  ) {
    throw new AppError(
      403,
      "forbidden",
      "You can only request adjustments for your own intervals",
    );
  }

  const reason = input.reason.trim();
  if (!reason) {
    throw new AppError(400, "validation", "Reason is required");
  }

  const proposedStartedAt = input.proposedStartedAt
    ? new Date(input.proposedStartedAt)
    : null;
  const proposedEndedAt = input.proposedEndedAt
    ? new Date(input.proposedEndedAt)
    : null;
  if (proposedStartedAt && Number.isNaN(proposedStartedAt.getTime())) {
    throw new AppError(400, "validation", "Invalid proposedStartedAt");
  }
  if (proposedEndedAt && Number.isNaN(proposedEndedAt.getTime())) {
    throw new AppError(400, "validation", "Invalid proposedEndedAt");
  }

  const effStart = proposedStartedAt ?? interval.startedAt;
  const effEnd = proposedEndedAt ?? interval.endedAt;
  const effBreak = input.proposedBreakMinutes ?? interval.breakMinutes;
  assertValidAdjustmentTimes(effStart, effEnd, effBreak);

  const adj = await prisma.attendanceAdjustment.create({
    data: {
      intervalId: interval.id,
      requestedById: input.requestedById,
      reason,
      proposedStartedAt,
      proposedEndedAt,
      proposedBreakMinutes: input.proposedBreakMinutes ?? null,
      status: AttendanceAdjustmentStatus.pending,
    },
  });

  if (interval.status === AttendanceIntervalStatus.closed) {
    await prisma.attendanceInterval.update({
      where: { id: interval.id },
      data: { status: AttendanceIntervalStatus.needs_review },
    });
  }

  await recordAudit({
    actorEmployeeId: input.requestedById,
    action: "adjustment.request",
    entityType: "attendance_adjustment",
    entityId: adj.id,
    reason,
    after: {
      intervalId: interval.id,
      proposedStartedAt,
      proposedEndedAt,
      proposedBreakMinutes: input.proposedBreakMinutes ?? null,
    },
    summary: `Requested attendance adjustment`,
  });

  {
    const recipients = await recipientsWithAction(
      "attendance.approve_adjustment",
    );
    await createNotifications({
      type: "attendance.adjustment_requested",
      title: "Attendance adjustment requested",
      body: "A team member requested an attendance adjustment",
      entityType: "attendance_adjustment",
      entityId: adj.id,
      actorEmployeeId: input.requestedById,
      recipientEmployeeIds: recipients,
      dedupeKey: `attendance.adjustment_requested:${adj.id}`,
      payload: {
        panel: "attendance",
        adjustmentId: adj.id,
      },
    });
  }

  return adj;
}

export async function reviewAdjustment(input: {
  adjustmentId: string;
  reviewedById: string;
  decision: "approved" | "rejected";
  reason?: string;
}) {
  const adj = await prisma.attendanceAdjustment.findUnique({
    where: { id: input.adjustmentId },
    include: { interval: true },
  });
  if (!adj) {
    throw new AppError(404, "not_found", "Adjustment not found");
  }
  if (adj.status !== AttendanceAdjustmentStatus.pending) {
    throw new AppError(409, "conflict", "Adjustment already reviewed");
  }

  const reviewedAt = new Date();
  const startedAt = adj.proposedStartedAt ?? adj.interval.startedAt;
  const endedAt = adj.proposedEndedAt ?? adj.interval.endedAt;
  const breakMinutes =
    adj.proposedBreakMinutes ?? adj.interval.breakMinutes;
  if (input.decision === "approved") {
    assertValidAdjustmentTimes(startedAt, endedAt, breakMinutes);
  }
  const workedMinutes = computeWorkedMinutes(startedAt, endedAt, breakMinutes);
  const ops =
    input.decision === "approved" ? await getOperations() : null;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.attendanceAdjustment.updateMany({
      where: {
        id: adj.id,
        status: AttendanceAdjustmentStatus.pending,
      },
      data: {
        status:
          input.decision === "rejected"
            ? AttendanceAdjustmentStatus.rejected
            : AttendanceAdjustmentStatus.approved,
        reviewedById: input.reviewedById,
        reviewedAt,
        ...(input.decision === "rejected"
          ? { reason: input.reason?.trim() || adj.reason }
          : {}),
      },
    });
    if (claimed.count === 0) {
      throw new AppError(409, "conflict", "Adjustment already reviewed");
    }

    if (input.decision === "approved" && ops) {
      await tx.attendanceInterval.update({
        where: { id: adj.intervalId },
        data: {
          startedAt,
          endedAt,
          breakMinutes,
          workedMinutes,
          hotelDate: hotelDateAsUtcDate(startedAt, ops.hotelTimezone),
          status: AttendanceIntervalStatus.adjusted,
          anomalyFlags: [],
        },
      });
    }
  });

  if (input.decision === "rejected") {
    await recordAudit({
      actorEmployeeId: input.reviewedById,
      action: "adjustment.review",
      entityType: "attendance_adjustment",
      entityId: adj.id,
      reason: input.reason,
      after: { decision: "rejected", intervalId: adj.intervalId },
      summary: `Rejected attendance adjustment`,
    });
    await createNotifications({
      type: "attendance.adjustment_reviewed",
      title: "Attendance adjustment rejected",
      body: "Your attendance adjustment was rejected",
      entityType: "attendance_adjustment",
      entityId: adj.id,
      actorEmployeeId: input.reviewedById,
      recipientEmployeeIds: [adj.requestedById],
      dedupeKey: `attendance.adjustment_reviewed:${adj.id}`,
      payload: {
        panel: "attendance",
        adjustmentId: adj.id,
      },
    });
    return getInterval(adj.intervalId);
  }

  await recordAudit({
    actorEmployeeId: input.reviewedById,
    action: "adjustment.review",
    entityType: "attendance_adjustment",
    entityId: adj.id,
    after: {
      decision: "approved",
      intervalId: adj.intervalId,
      startedAt,
      endedAt,
      breakMinutes,
    },
    summary: `Approved attendance adjustment`,
  });

  await createNotifications({
    type: "attendance.adjustment_reviewed",
    title: "Attendance adjustment approved",
    body: "Your attendance adjustment was approved",
    entityType: "attendance_adjustment",
    entityId: adj.id,
    actorEmployeeId: input.reviewedById,
    recipientEmployeeIds: [adj.requestedById],
    dedupeKey: `attendance.adjustment_reviewed:${adj.id}`,
    payload: {
      panel: "attendance",
      adjustmentId: adj.id,
    },
  });

  return getInterval(adj.intervalId);
}

