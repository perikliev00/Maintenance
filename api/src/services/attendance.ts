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
import { recordAudit } from "./audit";
import {
  createNotifications,
  recipientsWithAction,
} from "./notifications";

const OPEN_MISSING_END_HOURS = 14;
const ABSURD_DURATION_HOURS = 16;
const LARGE_SKEW_SECONDS = 1800;
const LIST_DEFAULT_LIMIT = 200;
const LIST_MAX_LIMIT = 500;
const EXPORT_BATCH = 1000;
const EXPORT_CEILING = 50_000;

type Tx = Prisma.TransactionClient;

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

export type ListIntervalsPage = {
  limit?: number;
  cursor?: string;
};

type IntervalCursor = {
  hotelDate: string;
  startedAt: string;
  id: string;
};

export function encodeIntervalCursor(c: IntervalCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeIntervalCursor(raw: string): IntervalCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as Partial<IntervalCursor>;
    if (
      typeof parsed.hotelDate !== "string" ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.id !== "string"
    ) {
      throw new Error("invalid");
    }
    return {
      hotelDate: parsed.hotelDate,
      startedAt: parsed.startedAt,
      id: parsed.id,
    };
  } catch {
    throw new AppError(400, "validation", "Invalid attendance cursor");
  }
}

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
    const dow = new Date(`${todayYmd}T12:00:00.000Z`).getUTCDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = addDaysYmd(todayYmd, mondayOffset);
    const nextMonday = addDaysYmd(monday, 7);
    return {
      from: startOfHotelDayUtc(monday),
      to: startOfHotelDayUtc(nextMonday),
    };
  }
  const month =
    filter.month ?? `${todayYmd.slice(0, 4)}-${todayYmd.slice(5, 7)}`;
  return monthRange(month);
}

async function buildIntervalWhere(
  filter: ListIntervalsFilter,
): Promise<Prisma.AttendanceIntervalWhereInput> {
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
  return where;
}

function cursorWhere(
  cursor: IntervalCursor,
): Prisma.AttendanceIntervalWhereInput {
  const hotelDate = new Date(`${cursor.hotelDate}T00:00:00.000Z`);
  const startedAt = new Date(cursor.startedAt);
  return {
    OR: [
      { hotelDate: { lt: hotelDate } },
      {
        AND: [{ hotelDate }, { startedAt: { lt: startedAt } }],
      },
      {
        AND: [{ hotelDate }, { startedAt }, { id: { lt: cursor.id } }],
      },
    ],
  };
}

export async function listIntervals(
  filter: ListIntervalsFilter,
  page: ListIntervalsPage = {},
) {
  const where = await buildIntervalWhere(filter);
  const limit = Math.min(
    Math.max(1, page.limit ?? LIST_DEFAULT_LIMIT),
    LIST_MAX_LIMIT,
  );
  const cursor = page.cursor ? decodeIntervalCursor(page.cursor) : null;

  const [total, rows] = await Promise.all([
    prisma.attendanceInterval.count({ where }),
    prisma.attendanceInterval.findMany({
      where: cursor ? { AND: [where, cursorWhere(cursor)] } : where,
      include: intervalInclude,
      orderBy: [{ hotelDate: "desc" }, { startedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
  ]);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeIntervalCursor({
          hotelDate: last.hotelDate.toISOString().slice(0, 10),
          startedAt: last.startedAt.toISOString(),
          id: last.id,
        })
      : null;

  return {
    intervals: pageRows.map(mapInterval),
    total,
    nextCursor,
    limit,
  };
}

export async function listIntervalsForExport(filter: ListIntervalsFilter) {
  const where = await buildIntervalWhere(filter);
  const total = await prisma.attendanceInterval.count({ where });
  if (total > EXPORT_CEILING) {
    throw new AppError(
      413,
      "too_large",
      `Attendance export exceeds ${EXPORT_CEILING} rows; narrow the filter`,
      { total, ceiling: EXPORT_CEILING },
    );
  }

  const intervals: ReturnType<typeof mapInterval>[] = [];
  let cursor: IntervalCursor | null = null;
  for (;;) {
    const rows: Prisma.AttendanceIntervalGetPayload<{
      include: typeof intervalInclude;
    }>[] = await prisma.attendanceInterval.findMany({
      where: cursor ? { AND: [where, cursorWhere(cursor)] } : where,
      include: intervalInclude,
      orderBy: [{ hotelDate: "desc" }, { startedAt: "desc" }, { id: "desc" }],
      take: EXPORT_BATCH,
    });
    if (!rows.length) break;
    for (const row of rows) {
      intervals.push(mapInterval(row));
    }
    if (rows.length < EXPORT_BATCH) break;
    const last: (typeof rows)[number] = rows[rows.length - 1]!;
    cursor = {
      hotelDate: last.hotelDate.toISOString().slice(0, 10),
      startedAt: last.startedAt.toISOString(),
      id: last.id,
    };
    if (intervals.length >= EXPORT_CEILING) {
      return {
        intervals: intervals.slice(0, EXPORT_CEILING),
        truncated: true,
        total,
      };
    }
  }
  return { intervals, truncated: false, total };
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
  const where = await buildIntervalWhere(filter);
  const intervals = await prisma.attendanceInterval.findMany({
    where,
    select: { startEventId: true, endEventId: true },
  });
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

export type RebuildEvent = {
  id: string;
  kind: AttendanceEventKind;
  normalizedTime: Date;
  clockSkewSeconds: number | null;
};

export type FrozenRange = { startMs: number; endMs: number };

export type IntervalDraft = {
  startedAt: Date;
  endedAt: Date | null;
  startEventId: string | null;
  endEventId: string | null;
  anomalyFlags: AnomalyFlag[];
  breakMinutes: number;
  workedMinutes: number | null;
  status: AttendanceIntervalStatus;
  hotelDate: Date;
};

function eventInFrozenRange(t: number, frozen: FrozenRange[]): boolean {
  return frozen.some((r) => t >= r.startMs && t <= r.endMs);
}

/** Pure event→interval pairing used by rebuild (and unit tests). */
export function pairEventsToIntervalDrafts(input: {
  events: RebuildEvent[];
  frozen: FrozenRange[];
  hotelDate: Date;
  now?: Date;
}): IntervalDraft[] {
  const now = input.now ?? new Date();
  const usable = input.events.filter(
    (e) => !eventInFrozenRange(e.normalizedTime.getTime(), input.frozen),
  );

  type Open = {
    startedAt: Date;
    startEventId: string;
    flags: AnomalyFlag[];
  };

  let open: Open | null = null;
  const drafts: IntervalDraft[] = [];

  function skewFlags(ev: RebuildEvent): AnomalyFlag[] {
    if (
      ev.clockSkewSeconds != null &&
      Math.abs(ev.clockSkewSeconds) >= LARGE_SKEW_SECONDS
    ) {
      return ["large_clock_skew"];
    }
    return [];
  }

  function finalize(
    startedAt: Date,
    endedAt: Date | null,
    startEventId: string | null,
    endEventId: string | null,
    flags: AnomalyFlag[],
    windowEvents: RebuildEvent[],
  ) {
    const breakMinutes = computeBreakMinutes(windowEvents);
    const workedMinutes = computeWorkedMinutes(startedAt, endedAt, breakMinutes);
    const nextFlags = uniqueFlags(flags);
    if (
      endedAt &&
      (endedAt.getTime() - startedAt.getTime()) / 3600_000 > ABSURD_DURATION_HOURS
    ) {
      nextFlags.push("absurd_duration");
    }
    if (!endedAt) {
      const ageH = (now.getTime() - startedAt.getTime()) / 3600_000;
      if (ageH >= OPEN_MISSING_END_HOURS) {
        nextFlags.push("missing_end");
      }
    }
    const uniq = uniqueFlags(nextFlags);
    let status: AttendanceIntervalStatus = AttendanceIntervalStatus.open;
    if (
      uniq.includes("missing_end") ||
      uniq.includes("overlap") ||
      uniq.includes("absurd_duration") ||
      uniq.includes("duplicate_kind") ||
      uniq.includes("large_clock_skew")
    ) {
      status = AttendanceIntervalStatus.needs_review;
    } else if (endedAt) {
      status = AttendanceIntervalStatus.closed;
    }
    drafts.push({
      startedAt,
      endedAt,
      startEventId,
      endEventId,
      anomalyFlags: uniq,
      breakMinutes,
      workedMinutes,
      status,
      hotelDate: input.hotelDate,
    });
  }

  for (const ev of usable) {
    if (ev.kind === AttendanceEventKind.clock_in) {
      if (open) {
        open.flags = uniqueFlags([
          ...open.flags,
          "duplicate_kind",
          ...skewFlags(ev),
        ]);
      } else {
        open = {
          startedAt: ev.normalizedTime,
          startEventId: ev.id,
          flags: skewFlags(ev),
        };
      }
    } else if (ev.kind === AttendanceEventKind.clock_out) {
      if (!open) {
        finalize(
          ev.normalizedTime,
          ev.normalizedTime,
          null,
          ev.id,
          uniqueFlags(["missing_end", ...skewFlags(ev)]),
          [],
        );
      } else {
        const flags = uniqueFlags([...open.flags, ...skewFlags(ev)]);
        if (ev.normalizedTime < open.startedAt) {
          flags.push("absurd_duration");
        }
        const windowEvents = usable.filter(
          (e) =>
            e.normalizedTime >= open!.startedAt &&
            e.normalizedTime <= ev.normalizedTime,
        );
        finalize(
          open.startedAt,
          ev.normalizedTime,
          open.startEventId,
          ev.id,
          flags.filter((f) => f !== "missing_end"),
          windowEvents,
        );
        open = null;
      }
    } else if (open) {
      open.flags = uniqueFlags([...open.flags, ...skewFlags(ev)]);
    }
  }

  if (open) {
    const windowEvents = usable.filter(
      (e) => e.normalizedTime >= open!.startedAt,
    );
    finalize(
      open.startedAt,
      null,
      open.startEventId,
      null,
      open.flags,
      windowEvents,
    );
  }

  return drafts;
}

export function eventRequiresIntervalLink(kind: AttendanceEventKind): boolean {
  return (
    kind === AttendanceEventKind.clock_in ||
    kind === AttendanceEventKind.clock_out
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

export async function rebuildIntervalsForEmployee(
  employeeId: string,
  hotelDate: Date,
  db: Tx | typeof prisma = prisma,
) {
  const from = hotelDate;
  const to = new Date(hotelDate.getTime() + 48 * 3600_000);

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
        hotelDate: from,
        status: AttendanceIntervalStatus.adjusted,
      },
      select: { id: true, startedAt: true, endedAt: true },
    }),
    db.attendanceInterval.findMany({
      where: {
        employeeId,
        hotelDate: from,
        status: { not: AttendanceIntervalStatus.adjusted },
      },
      include: {
        adjustments: {
          where: { status: AttendanceAdjustmentStatus.pending },
        },
      },
    }),
  ]);

  const pendingToRematch = replaceable.flatMap((iv) =>
    iv.adjustments
      .filter((a) => iv.startEventId)
      .map((a) => ({
        startEventId: iv.startEventId!,
        requestedById: a.requestedById,
        reason: a.reason,
        proposedStartedAt: a.proposedStartedAt,
        proposedEndedAt: a.proposedEndedAt,
        proposedBreakMinutes: a.proposedBreakMinutes,
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
    hotelDate: from,
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

  for (const pending of pendingToRematch) {
    const intervalId = createdByStart.get(pending.startEventId);
    if (!intervalId) continue;
    await db.attendanceAdjustment.create({
      data: {
        intervalId,
        requestedById: pending.requestedById,
        reason: pending.reason,
        proposedStartedAt: pending.proposedStartedAt,
        proposedEndedAt: pending.proposedEndedAt,
        proposedBreakMinutes: pending.proposedBreakMinutes,
        status: AttendanceAdjustmentStatus.pending,
      },
    });
    await db.attendanceInterval.update({
      where: { id: intervalId },
      data: {
        status: AttendanceIntervalStatus.needs_review,
      },
    });
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

  const ops = await getOperations();

  if (existing) {
    let linked = await findIntervalForEvent(existing);
    if (!linked && eventRequiresIntervalLink(existing.kind)) {
      const hotelDate = hotelDateAsUtcDate(
        existing.normalizedTime,
        ops.hotelTimezone,
      );
      await prisma.$transaction(async (tx) => {
        await rebuildIntervalsForEmployee(existing.employeeId, hotelDate, tx);
      });
      linked = await findIntervalForEvent(existing);
    }
    return {
      event: existing,
      created: false,
      intervalId: linked?.id ?? null,
    };
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
  const hotelDate = hotelDateAsUtcDate(normalizedTime, ops.hotelTimezone);

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

    await rebuildIntervalsForEmployee(input.employeeId, hotelDate, tx);

    const linked = await findIntervalForEvent(event, tx);
    return { event, intervalId: linked?.id ?? null };
  });

  return { event: result.event, created: true, intervalId: result.intervalId };
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
