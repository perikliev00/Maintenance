/**
 * Attendance interval queries: scoped list (today/week/month/review),
 * cursor pagination, CSV export drain, and single-interval fetch.
 */
import { Prisma, AttendanceIntervalStatus } from "@prisma/client";
import { prisma } from "../../../db";
import { AppError } from "../../../errors";
import { addDaysYmd, hotelDateKey } from "../../attendanceRules";
import { hotelDateString } from "../../hotelTime";
import { getOperations } from "../../settings";
import {
  EXPORT_BATCH,
  EXPORT_CEILING,
  intervalInclude,
  mapInterval,
  type ListIntervalsFilter,
  type ListIntervalsPage,
} from "./map";
import {
  decodeIntervalCursor,
  drainExportPages,
  listPageFromRows,
  resolveListLimit,
  type IntervalCursor,
} from "./pagination";

/** Inclusive UTC-month start and exclusive next-month start for a YYYY-MM key. */
function monthRange(month: string): { from: Date; to: Date } {
  // Split "YYYY-MM" into numeric year/month parts.
  const [y, m] = month.split("-").map(Number);
  // Reject missing parts or month outside 1–12.
  if (!y || !m || m < 1 || m > 12) {
    throw new AppError(400, "validation", "Invalid month (expected YYYY-MM)");
  }
  // Month window as UTC midnights (matches hotelDate column storage).
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return { from, to };
}

/**
 * Resolve the hotel-date window (or review-only mode) for a list filter.
 * Uses operations timezone for "today" / "week" relative scopes.
 */
async function resolveDateWindow(
  filter: ListIntervalsFilter,
  timeZone: string,
): Promise<{ from?: Date; to?: Date; reviewOnly?: boolean }> {
  // Current instant → hotel calendar YMD in the configured timezone.
  const now = new Date();
  const todayYmd = hotelDateString(now, timeZone);
  // Default scope is calendar month when the client omits it.
  const scope = filter.scope ?? "month";

  // Review queue: status filter only, no date bounds.
  if (scope === "review") {
    return { reviewOnly: true };
  }
  // Single hotel day [today, tomorrow).
  if (scope === "today") {
    // Filter by hotelDate column keys (UTC midnight YMD), not zoned instants.
    const from = hotelDateKey(todayYmd);
    const to = hotelDateKey(addDaysYmd(todayYmd, 1));
    return { from, to };
  }
  // ISO week Mon–Sun relative to today in hotel timezone.
  if (scope === "week") {
    // UTC noon of todayYmd so getUTCDay matches the hotel calendar day.
    const dow = new Date(`${todayYmd}T12:00:00.000Z`).getUTCDay();
    // Sunday → previous Monday (-6); else back to Monday of this week.
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = addDaysYmd(todayYmd, mondayOffset);
    const nextMonday = addDaysYmd(monday, 7);
    return {
      from: hotelDateKey(monday),
      to: hotelDateKey(nextMonday),
    };
  }
  // Month scope: explicit filter.month or current YYYY-MM from todayYmd.
  const month =
    filter.month ?? `${todayYmd.slice(0, 4)}-${todayYmd.slice(5, 7)}`;
  return monthRange(month);
}

/** Build Prisma where from scope window + optional employee/department/q. */
async function buildIntervalWhere(
  filter: ListIntervalsFilter,
): Promise<Prisma.AttendanceIntervalWhereInput> {
  // Hotel timezone from operations settings (not server local time).
  const ops = await getOperations();
  const window = await resolveDateWindow(filter, ops.hotelTimezone);

  const where: Prisma.AttendanceIntervalWhereInput = {};
  // Review mode: only needs_review intervals (ignore date window).
  if (window.reviewOnly) {
    where.status = AttendanceIntervalStatus.needs_review;
  } else if (window.from && window.to) {
    // Half-open hotelDate range [from, to).
    where.hotelDate = { gte: window.from, lt: window.to };
  }
  // Optional single-employee filter.
  if (filter.employeeId) {
    where.employeeId = filter.employeeId;
  }
  // Nested employee filters for department and free-text search.
  if (filter.department?.trim() || filter.q?.trim()) {
    const empWhere: Prisma.EmployeeWhereInput = {};
    // Case-insensitive exact department match.
    if (filter.department?.trim()) {
      empWhere.department = {
        equals: filter.department.trim(),
        mode: "insensitive",
      };
    }
    // q matches fullName or employeeNumber (contains, case-insensitive).
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

/**
 * Keyset filter matching orderBy hotelDate/startedAt/id desc:
 * rows strictly "after" (older than) the cursor position.
 */
function cursorWhere(
  cursor: IntervalCursor,
): Prisma.AttendanceIntervalWhereInput {
  // Reconstruct Date keys from opaque cursor strings.
  const hotelDate = new Date(`${cursor.hotelDate}T00:00:00.000Z`);
  const startedAt = new Date(cursor.startedAt);
  // Lexicographic "less than" under desc sort: older hotelDate, then earlier
  // startedAt, then smaller id for ties.
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

/** Build an IntervalCursor from a fetched row's keyset columns. */
function rowToIntervalCursor(row: {
  hotelDate: Date;
  startedAt: Date;
  id: string;
}): IntervalCursor {
  // hotelDate as YYYY-MM-DD; startedAt as full ISO for stable keyset ties.
  return {
    hotelDate: row.hotelDate.toISOString().slice(0, 10),
    startedAt: row.startedAt.toISOString(),
    id: row.id,
  };
}

/** Paginated interval list for the given scope/filters (newest hotelDate first). */
export async function listIntervals(
  filter: ListIntervalsFilter,
  page: ListIntervalsPage = {},
) {
  // Scope/department/q → Prisma where.
  const where = await buildIntervalWhere(filter);
  // Clamp page size into allowed bounds.
  const limit = resolveListLimit(page.limit);
  // Decode opaque cursor when continuing a prior page.
  const cursor = page.cursor ? decodeIntervalCursor(page.cursor) : null;

  // Count total matching rows; fetch one extra row to detect hasMore.
  const [total, rows] = await Promise.all([
    prisma.attendanceInterval.count({ where }),
    prisma.attendanceInterval.findMany({
      where: cursor ? { AND: [where, cursorWhere(cursor)] } : where,
      include: intervalInclude,
      orderBy: [{ hotelDate: "desc" }, { startedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
  ]);

  // Slice to page size and encode nextCursor from the last included row.
  const { pageRows, nextCursor } = listPageFromRows(
    rows,
    limit,
    rowToIntervalCursor,
  );

  // Map Prisma rows to API DTOs.
  return {
    intervals: pageRows.map(mapInterval),
    total,
    nextCursor,
    limit,
  };
}

/**
 * Drain all matching intervals for CSV export, rejecting upfront when `total`
 * exceeds {@link EXPORT_CEILING}.
 */
export async function listIntervalsForExport(filter: ListIntervalsFilter) {
  // Same filters as the list endpoint.
  const where = await buildIntervalWhere(filter);
  // Cheap count before draining pages.
  const total = await prisma.attendanceInterval.count({ where });
  // Reject oversized exports early with actionable error metadata.
  if (total > EXPORT_CEILING) {
    throw new AppError(
      413,
      "too_large",
      `Attendance export exceeds ${EXPORT_CEILING} rows; narrow the filter`,
      { total, ceiling: EXPORT_CEILING },
    );
  }

  // Cursor-drain all pages up to EXPORT_CEILING (truncation flag if hit).
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

  // Map rows; truncated true when the hard ceiling stopped the drain.
  return {
    intervals: rows.map(mapInterval),
    truncated,
    total,
  };
}

/** Fetch one interval by id (404 if missing). */
export async function getInterval(id: string) {
  // Load with the same include shape as list responses.
  const row = await prisma.attendanceInterval.findUnique({
    where: { id },
    include: intervalInclude,
  });
  // Missing id → 404 (not an empty DTO).
  if (!row) {
    throw new AppError(404, "not_found", "Attendance interval not found");
  }
  return mapInterval(row);
}

/** Max absolute clockSkewSeconds among start/end events in the filtered set. */
export async function maxClockSkewSeconds(
  filter: ListIntervalsFilter,
): Promise<number | null> {
  // Same interval filter as list/export.
  const where = await buildIntervalWhere(filter);
  // Only need event foreign keys to gather skew samples.
  const intervals = await prisma.attendanceInterval.findMany({
    where,
    select: { startEventId: true, endEventId: true },
  });
  // Flatten start+end ids; drop null endEventId for open intervals.
  const eventIds = intervals
    .flatMap((i) => [i.startEventId, i.endEventId])
    .filter((id): id is string => !!id);
  // No linked events → no skew to report.
  if (!eventIds.length) return null;
  // Load clockSkewSeconds for all referenced punch events.
  const events = await prisma.attendanceEvent.findMany({
    where: { id: { in: eventIds } },
    select: { clockSkewSeconds: true },
  });
  // Track max absolute skew; skip null skew values.
  let max: number | null = null;
  for (const e of events) {
    if (e.clockSkewSeconds == null) continue;
    const abs = Math.abs(e.clockSkewSeconds);
    if (max == null || abs > max) max = abs;
  }
  return max;
}
