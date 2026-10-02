import {
  AttendanceAdjustmentStatus,
  AttendanceEventKind,
  AttendanceIntervalStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "./cleaning";
import { getOperations } from "./settings";
import { recordAudit } from "./audit";

const OPEN_MISSING_END_HOURS = 14;
const ABSURD_DURATION_HOURS = 16;
const LARGE_SKEW_SECONDS = 1800;

type AnomalyFlag =
  | "missing_end"
  | "overlap"
  | "duplicate_kind"
  | "absurd_duration"
  | "large_clock_skew";

const intervalInclude = {
  employee: {
    select: {
      id: true,
      fullName: true,
      employeeNumber: true,
      department: true,
    },
  },
  adjustments: {
    orderBy: { createdAt: "desc" as const },
    take: 5,
    include: {
      requestedBy: {
        select: { id: true, fullName: true, employeeNumber: true },
      },
      reviewedBy: {
        select: { id: true, fullName: true, employeeNumber: true },
      },
    },
  },
} satisfies Prisma.AttendanceIntervalInclude;

function asFlags(value: unknown): AnomalyFlag[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is AnomalyFlag => typeof v === "string") as AnomalyFlag[];
}

function uniqueFlags(flags: AnomalyFlag[]): AnomalyFlag[] {
  return Array.from(new Set(flags));
}

/** Hotel calendar date (YYYY-MM-DD) in the configured timezone for a UTC instant. */
export function hotelDateString(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function hotelDateAsUtcDate(instant: Date, timeZone: string): Date {
  const ymd = hotelDateString(instant, timeZone);
  return new Date(`${ymd}T00:00:00.000Z`);
}

function startOfHotelDayUtc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthRange(month: string): { from: Date; to: Date } {
  // month = YYYY-MM
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) {
    throw new AppError(400, "validation", "Invalid month (expected YYYY-MM)");
  }
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return { from, to };
}

function computeBreakMinutes(
  events: Array<{ kind: AttendanceEventKind; normalizedTime: Date }>,
): number {
  let total = 0;
  let breakStart: Date | null = null;
  const ordered = [...events].sort(
    (a, b) => a.normalizedTime.getTime() - b.normalizedTime.getTime(),
  );
  for (const ev of ordered) {
    if (ev.kind === AttendanceEventKind.break_start) {
      breakStart = ev.normalizedTime;
    } else if (ev.kind === AttendanceEventKind.break_end && breakStart) {
      const mins = Math.max(
        0,
        Math.round(
          (ev.normalizedTime.getTime() - breakStart.getTime()) / 60_000,
        ),
      );
      total += mins;
      breakStart = null;
    }
  }
  return total;
}

function computeWorkedMinutes(
  startedAt: Date,
  endedAt: Date | null,
  breakMinutes: number,
): number | null {
  if (!endedAt) return null;
  const raw = Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000);
  return Math.max(0, raw - breakMinutes);
}

export function mapInterval(
  row: Prisma.AttendanceIntervalGetPayload<{ include: typeof intervalInclude }>,
) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employee: row.employee,
    hotelDate: row.hotelDate.toISOString().slice(0, 10),
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    breakMinutes: row.breakMinutes,
    workedMinutes: row.workedMinutes,
    status: row.status,
    anomalyFlags: asFlags(row.anomalyFlags),
    startEventId: row.startEventId,
    endEventId: row.endEventId,
    adjustments: row.adjustments.map((a) => ({
      id: a.id,
      status: a.status,
      reason: a.reason,
      proposedStartedAt: a.proposedStartedAt?.toISOString() ?? null,
      proposedEndedAt: a.proposedEndedAt?.toISOString() ?? null,
      proposedBreakMinutes: a.proposedBreakMinutes,
      requestedBy: a.requestedBy,
      reviewedBy: a.reviewedBy,
      createdAt: a.createdAt.toISOString(),
      reviewedAt: a.reviewedAt?.toISOString() ?? null,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type ListIntervalsFilter = {
  scope?: "month" | "today" | "week" | "review";
  month?: string;
  department?: string;
  q?: string;
  employeeId?: string;
};

async function resolveDateWindow(
  filter: ListIntervalsFilter,
  timeZone: string,
): Promise<{ from?: Date; to?: Date; reviewOnly?: boolean }> {
  const now = new Date();
  const todayYmd = hotelDateString(now, timeZone);
  const scope = filter.scope ?? "month";

  if (scope === "review") {
    return { reviewOnly: true };
  }
  if (scope === "today") {
    const from = startOfHotelDayUtc(todayYmd);
    const to = startOfHotelDayUtc(addDaysYmd(todayYmd, 1));
    return { from, to };
  }
  if (scope === "week") {
    // Mon–Sun of hotel week containing today
    const dow = new Date(`${todayYmd}T12:00:00.000Z`).getUTCDay(); // 0=Sun
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = addDaysYmd(todayYmd, mondayOffset);
    const nextMonday = addDaysYmd(monday, 7);
    return {
      from: startOfHotelDayUtc(monday),
      to: startOfHotelDayUtc(nextMonday),
    };
  }
  // month
  const month =
    filter.month ??
    `${todayYmd.slice(0, 4)}-${todayYmd.slice(5, 7)}`;
  return monthRange(month);
}

export async function listIntervals(filter: ListIntervalsFilter) {
  const ops = await getOperations();
  const window = await resolveDateWindow(filter, ops.hotelTimezone);

  const where: Prisma.AttendanceIntervalWhereInput = {};
  if (window.reviewOnly) {
    where.status = AttendanceIntervalStatus.needs_review;
  } else if (window.from && window.to) {
    where.hotelDate = { gte: window.from, lt: window.to };
  }
  if (filter.employeeId) {
    where.employeeId = filter.employeeId;
  }
  if (filter.department?.trim() || filter.q?.trim()) {
    const empWhere: Prisma.EmployeeWhereInput = {};
    if (filter.department?.trim()) {
      empWhere.department = {
        equals: filter.department.trim(),
        mode: "insensitive",
      };
    }
    if (filter.q?.trim()) {
      const q = filter.q.trim();
      empWhere.OR = [
        { fullName: { contains: q, mode: "insensitive" } },
        { employeeNumber: { contains: q, mode: "insensitive" } },
      ];
    }
    where.employee = empWhere;
  }

  const rows = await prisma.attendanceInterval.findMany({
    where,
    include: intervalInclude,
    orderBy: [{ hotelDate: "desc" }, { startedAt: "desc" }],
    take: 500,
  });
  return rows.map(mapInterval);
}

export async function getInterval(id: string) {
  const row = await prisma.attendanceInterval.findUnique({
    where: { id },
    include: intervalInclude,
  });
  if (!row) {
    throw new AppError(404, "not_found", "Attendance interval not found");
  }
  return mapInterval(row);
}

export async function maxClockSkewSeconds(
  filter: ListIntervalsFilter,
): Promise<number | null> {
  const intervals = await listIntervals(filter);
  const eventIds = intervals
    .flatMap((i) => [i.startEventId, i.endEventId])
    .filter((id): id is string => !!id);
  if (!eventIds.length) return null;
  const events = await prisma.attendanceEvent.findMany({
    where: { id: { in: eventIds } },
    select: { clockSkewSeconds: true },
  });
  let max: number | null = null;
  for (const e of events) {
    if (e.clockSkewSeconds == null) continue;
    const abs = Math.abs(e.clockSkewSeconds);
    if (max == null || abs > max) max = abs;
  }
  return max;
}

async function recomputeIntervalFromEvents(intervalId: string) {
  const interval = await prisma.attendanceInterval.findUnique({
    where: { id: intervalId },
  });
  if (!interval) return;

  const events = await prisma.attendanceEvent.findMany({
    where: {
      employeeId: interval.employeeId,
      normalizedTime: {
        gte: interval.startedAt,
        ...(interval.endedAt
          ? { lte: interval.endedAt }
          : { lte: new Date(interval.startedAt.getTime() + 36 * 3600_000) }),
      },
    },
    orderBy: { normalizedTime: "asc" },
  });

  const breakMinutes = computeBreakMinutes(events);
  const workedMinutes = computeWorkedMinutes(
    interval.startedAt,
    interval.endedAt,
    breakMinutes,
  );
  const flags = asFlags(interval.anomalyFlags);

  if (
    interval.endedAt &&
    (interval.endedAt.getTime() - interval.startedAt.getTime()) /
      3600_000 >
      ABSURD_DURATION_HOURS
  ) {
    flags.push("absurd_duration");
  }
  if (!interval.endedAt) {
    const ageH =
      (Date.now() - interval.startedAt.getTime()) / 3600_000;
    if (ageH >= OPEN_MISSING_END_HOURS) {
      flags.push("missing_end");
    }
  }

  let status = interval.status;
  if (status !== AttendanceIntervalStatus.adjusted) {
    const uniq = uniqueFlags(flags);
    if (
      uniq.includes("missing_end") ||
      uniq.includes("overlap") ||
      uniq.includes("absurd_duration") ||
      uniq.includes("duplicate_kind") ||
      uniq.includes("large_clock_skew")
    ) {
      status = AttendanceIntervalStatus.needs_review;
    } else if (interval.endedAt) {
      status = AttendanceIntervalStatus.closed;
    } else {
      status = AttendanceIntervalStatus.open;
    }
  }

  await prisma.attendanceInterval.update({
    where: { id: intervalId },
    data: {
      breakMinutes,
      workedMinutes,
      anomalyFlags: uniqueFlags(flags),
      status,
    },
  });
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
    return { event: existing, created: false, intervalId: null as string | null };
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

  const event = await prisma.attendanceEvent.create({
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

  let intervalId: string | null = null;
  const flags: AnomalyFlag[] = [];
  if (Math.abs(skew) >= LARGE_SKEW_SECONDS) {
    flags.push("large_clock_skew");
  }

  if (input.kind === AttendanceEventKind.clock_in) {
    const open = await prisma.attendanceInterval.findFirst({
      where: {
        employeeId: input.employeeId,
        endedAt: null,
        status: {
          in: [
            AttendanceIntervalStatus.open,
            AttendanceIntervalStatus.needs_review,
          ],
        },
      },
      orderBy: { startedAt: "desc" },
    });
    if (open) {
      // Duplicate clock_in while open → flag and leave open interval
      await prisma.attendanceInterval.update({
        where: { id: open.id },
        data: {
          anomalyFlags: uniqueFlags([
            ...asFlags(open.anomalyFlags),
            "duplicate_kind",
            ...flags,
          ]),
          status: AttendanceIntervalStatus.needs_review,
        },
      });
      intervalId = open.id;
    } else {
      // Overlap check: closed interval covering this start
      const overlapping = await prisma.attendanceInterval.findFirst({
        where: {
          employeeId: input.employeeId,
          startedAt: { lte: normalizedTime },
          endedAt: { gt: normalizedTime },
        },
      });
      if (overlapping) {
        flags.push("overlap");
      }
      const created = await prisma.attendanceInterval.create({
        data: {
          employeeId: input.employeeId,
          hotelDate,
          startedAt: normalizedTime,
          status:
            flags.length > 0
              ? AttendanceIntervalStatus.needs_review
              : AttendanceIntervalStatus.open,
          anomalyFlags: uniqueFlags(flags),
          startEventId: event.id,
          breakMinutes: 0,
        },
      });
      intervalId = created.id;
    }
  } else if (input.kind === AttendanceEventKind.clock_out) {
    const open = await prisma.attendanceInterval.findFirst({
      where: {
        employeeId: input.employeeId,
        endedAt: null,
      },
      orderBy: { startedAt: "desc" },
    });
    if (!open) {
      // Orphan clock_out → create interval needing review
      const created = await prisma.attendanceInterval.create({
        data: {
          employeeId: input.employeeId,
          hotelDate,
          startedAt: normalizedTime,
          endedAt: normalizedTime,
          status: AttendanceIntervalStatus.needs_review,
          anomalyFlags: uniqueFlags(["missing_end", ...flags]),
          endEventId: event.id,
          breakMinutes: 0,
          workedMinutes: 0,
        },
      });
      intervalId = created.id;
    } else {
      const durationH =
        (normalizedTime.getTime() - open.startedAt.getTime()) / 3600_000;
      if (durationH > ABSURD_DURATION_HOURS) {
        flags.push("absurd_duration");
      }
      if (normalizedTime < open.startedAt) {
        flags.push("absurd_duration");
      }
      const breakMinutes = computeBreakMinutes(
        await prisma.attendanceEvent.findMany({
          where: {
            employeeId: input.employeeId,
            normalizedTime: {
              gte: open.startedAt,
              lte: normalizedTime,
            },
          },
        }),
      );
      const workedMinutes = computeWorkedMinutes(
        open.startedAt,
        normalizedTime,
        breakMinutes,
      );
      const nextFlags = uniqueFlags([
        ...asFlags(open.anomalyFlags),
        ...flags,
      ]).filter((f) => f !== "missing_end");
      const needsReview = nextFlags.length > 0;
      await prisma.attendanceInterval.update({
        where: { id: open.id },
        data: {
          endedAt: normalizedTime,
          endEventId: event.id,
          breakMinutes,
          workedMinutes,
          anomalyFlags: nextFlags,
          status: needsReview
            ? AttendanceIntervalStatus.needs_review
            : AttendanceIntervalStatus.closed,
        },
      });
      intervalId = open.id;
    }
  } else {
    // break_start / break_end — attach to open interval
    const open = await prisma.attendanceInterval.findFirst({
      where: {
        employeeId: input.employeeId,
        endedAt: null,
      },
      orderBy: { startedAt: "desc" },
    });
    if (open) {
      if (flags.length) {
        await prisma.attendanceInterval.update({
          where: { id: open.id },
          data: {
            anomalyFlags: uniqueFlags([...asFlags(open.anomalyFlags), ...flags]),
            status: AttendanceIntervalStatus.needs_review,
          },
        });
      }
      await recomputeIntervalFromEvents(open.id);
      intervalId = open.id;
    }
  }

  // Promote long-open intervals to needs_review
  const stale = await prisma.attendanceInterval.findMany({
    where: {
      employeeId: input.employeeId,
      endedAt: null,
      status: AttendanceIntervalStatus.open,
      startedAt: {
        lte: new Date(Date.now() - OPEN_MISSING_END_HOURS * 3600_000),
      },
    },
  });
  for (const s of stale) {
    await prisma.attendanceInterval.update({
      where: { id: s.id },
      data: {
        status: AttendanceIntervalStatus.needs_review,
        anomalyFlags: uniqueFlags([...asFlags(s.anomalyFlags), "missing_end"]),
      },
    });
  }

  return { event, created: true, intervalId };
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

  if (input.decision === "rejected") {
    await prisma.attendanceAdjustment.update({
      where: { id: adj.id },
      data: {
        status: AttendanceAdjustmentStatus.rejected,
        reviewedById: input.reviewedById,
        reviewedAt: new Date(),
        reason: input.reason?.trim() || adj.reason,
      },
    });
    await recordAudit({
      actorEmployeeId: input.reviewedById,
      action: "adjustment.review",
      entityType: "attendance_adjustment",
      entityId: adj.id,
      reason: input.reason,
      after: { decision: "rejected", intervalId: adj.intervalId },
      summary: `Rejected attendance adjustment`,
    });
    return getInterval(adj.intervalId);
  }

  // Approve: apply proposed times; never mutate events
  const startedAt = adj.proposedStartedAt ?? adj.interval.startedAt;
  const endedAt = adj.proposedEndedAt ?? adj.interval.endedAt;
  const breakMinutes =
    adj.proposedBreakMinutes ?? adj.interval.breakMinutes;
  const workedMinutes = computeWorkedMinutes(startedAt, endedAt, breakMinutes);
  const ops = await getOperations();

  await prisma.$transaction([
    prisma.attendanceAdjustment.update({
      where: { id: adj.id },
      data: {
        status: AttendanceAdjustmentStatus.approved,
        reviewedById: input.reviewedById,
        reviewedAt: new Date(),
      },
    }),
    prisma.attendanceInterval.update({
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
    }),
  ]);

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

  return getInterval(adj.intervalId);
}

export function intervalsToCsv(
  rows: ReturnType<typeof mapInterval>[],
): string {
  const header = [
    "hotelDate",
    "employeeNumber",
    "fullName",
    "department",
    "startedAt",
    "endedAt",
    "breakMinutes",
    "workedMinutes",
    "status",
    "anomalyFlags",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.hotelDate,
      r.employee.employeeNumber,
      `"${r.employee.fullName.replace(/"/g, '""')}"`,
      r.employee.department ?? "",
      r.startedAt,
      r.endedAt ?? "",
      String(r.breakMinutes),
      r.workedMinutes == null ? "" : String(r.workedMinutes),
      r.status,
      `"${r.anomalyFlags.join("|")}"`,
    ];
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}
