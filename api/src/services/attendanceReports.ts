import { Prisma, AttendanceIntervalStatus } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { addDaysYmd, asFlags, hotelDateKey } from "./attendanceRules";
import { hotelDateString } from "./hotelTime";
import { getOperations } from "./settings";

export const LIST_DEFAULT_LIMIT = 200;
/** Max page size for a single list request (not a hard total cap) */
export const LIST_MAX_LIMIT = 500;
/** Batch size when draining all rows for CSV export */
export const EXPORT_BATCH = 1000;
/** Hard ceiling for a single CSV export response */
export const EXPORT_CEILING = 50_000;

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

function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) {
    throw new AppError(400, "validation", "Invalid month (expected YYYY-MM)");
  }
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return { from, to };
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

export type IntervalCursor = {
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

/** Clamp a requested list page size into [1, LIST_MAX_LIMIT]. */
export function resolveListLimit(requested?: number): number {
  return Math.min(
    Math.max(1, requested ?? LIST_DEFAULT_LIMIT),
    LIST_MAX_LIMIT,
  );
}

/**
 * Slice a findMany result fetched with `take: limit + 1` into a page plus
 * opaque nextCursor. Used by listIntervals so pagination is unit-testable.
 */
export function listPageFromRows<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => IntervalCursor,
): { pageRows: T[]; nextCursor: string | null; limit: number } {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeIntervalCursor(toCursor(last)) : null;
  return { pageRows, nextCursor, limit };
}

/**
 * Drain all pages via cursor batches until exhausted or ceiling is hit.
 * Used by listIntervalsForExport so full CSV export is unit-testable.
 */
export async function drainExportPages<T>(opts: {
  batchSize: number;
  ceiling: number;
  fetchPage: (cursor: IntervalCursor | null) => Promise<T[]>;
  toCursor: (row: T) => IntervalCursor;
}): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let cursor: IntervalCursor | null = null;
  for (;;) {
    const batch = await opts.fetchPage(cursor);
    if (!batch.length) break;
    for (const row of batch) {
      rows.push(row);
    }
    if (batch.length < opts.batchSize) break;
    const last = batch[batch.length - 1]!;
    cursor = opts.toCursor(last);
    if (rows.length >= opts.ceiling) {
      return { rows: rows.slice(0, opts.ceiling), truncated: true };
    }
  }
  return { rows, truncated: false };
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
    // Filter by hotelDate column keys (UTC midnight YMD), not zoned instants.
    const from = hotelDateKey(todayYmd);
    const to = hotelDateKey(addDaysYmd(todayYmd, 1));
    return { from, to };
  }
  if (scope === "week") {
    const dow = new Date(`${todayYmd}T12:00:00.000Z`).getUTCDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = addDaysYmd(todayYmd, mondayOffset);
    const nextMonday = addDaysYmd(monday, 7);
    return {
      from: hotelDateKey(monday),
      to: hotelDateKey(nextMonday),
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

function rowToIntervalCursor(row: {
  hotelDate: Date;
  startedAt: Date;
  id: string;
}): IntervalCursor {
  return {
    hotelDate: row.hotelDate.toISOString().slice(0, 10),
    startedAt: row.startedAt.toISOString(),
    id: row.id,
  };
}

export async function listIntervals(
  filter: ListIntervalsFilter,
  page: ListIntervalsPage = {},
) {
  const where = await buildIntervalWhere(filter);
  const limit = resolveListLimit(page.limit);
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

  const { pageRows, nextCursor } = listPageFromRows(
    rows,
    limit,
    rowToIntervalCursor,
  );

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

  const { rows, truncated } = await drainExportPages({
    batchSize: EXPORT_BATCH,
    ceiling: EXPORT_CEILING,
    toCursor: rowToIntervalCursor,
    fetchPage: async (cursor) =>
      prisma.attendanceInterval.findMany({
        where: cursor ? { AND: [where, cursorWhere(cursor)] } : where,
        include: intervalInclude,
        orderBy: [
          { hotelDate: "desc" },
          { startedAt: "desc" },
          { id: "desc" },
        ],
        take: EXPORT_BATCH,
      }),
  });

  return {
    intervals: rows.map(mapInterval),
    truncated,
    total,
  };
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

/** Quote a CSV cell when it contains comma, quote, CR, or LF (doubling internal quotes). */
function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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
  ].map(escapeCsvCell);
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.hotelDate,
      r.employee.employeeNumber,
      r.employee.fullName,
      r.employee.department ?? "",
      r.startedAt,
      r.endedAt ?? "",
      String(r.breakMinutes),
      r.workedMinutes == null ? "" : String(r.workedMinutes),
      r.status,
      r.anomalyFlags.join("|"),
    ].map(escapeCsvCell);
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}
