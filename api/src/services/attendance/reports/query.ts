/**
 * Attendance interval queries: scoped list (today/week/month/review),
 * cursor pagination, CSV export drain, and single-interval fetch.
 */
import { Prisma, AttendanceIntervalStatus } from "@prisma/client";
// Shared Prisma client singleton.
import { prisma } from "../../../db";
// Runtime import from ../../../errors.
import { AppError } from "../../../errors";
// Runtime import from ../../attendanceRules.
import { addDaysYmd, hotelDateKey } from "../../attendanceRules";
// Runtime import from ../../hotelTime.
import { formatHotelDate, hotelDateString } from "../../hotelTime";
// Runtime import from ../../settings.
import { getOperations } from "../../settings";
// Module import required below.
import {
  EXPORT_BATCH,
  EXPORT_CEILING,
  intervalInclude,
  mapInterval,
  // Type alias ListIntervalsFilter.
  type ListIntervalsFilter,
  // Type alias ListIntervalsPage.
  type ListIntervalsPage,
// Support the surrounding control flow.
} from "./map";
// Module import required below.
import {
  decodeIntervalCursor,
  drainExportPages,
  listPageFromRows,
  resolveListLimit,
  // Type alias IntervalCursor.
  type IntervalCursor,
// Support the surrounding control flow.
} from "./pagination";

/** Inclusive UTC-month start and exclusive next-month start for a YYYY-MM key. */
function monthRange(month: string): { from: Date; to: Date } {
  // Split "YYYY-MM" into numeric year/month parts.
  const [y, m] = month.split("-").map(Number);
  // Reject missing parts or month outside 1–12.
  if (!y || !m || m < 1 || m > 12) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(400, "validation", "Invalid month (expected YYYY-MM)");
  }
  // Month window as UTC midnights (matches hotelDate column storage).
  const from = new Date(Date.UTC(y, m - 1, 1));
  // Date to for window math.
  const to = new Date(Date.UTC(y, m, 1));
  // Return response object.
  return { from, to };
}

/**
 * Resolve the hotel-date window (or review-only mode) for a list filter.
 * Uses operations timezone for "today" / "week" relative scopes.
 */
async function resolveDateWindow(
  // Param filter required by this function.
  filter: ListIntervalsFilter,
  // Param timeZone required by this function.
  timeZone: string,
// Support the surrounding control flow.
): Promise<{ from?: Date; to?: Date; reviewOnly?: boolean }> {
  // Current instant → hotel calendar YMD in the configured timezone.
  const now = new Date();
  // Local todayYmd used below.
  const todayYmd = hotelDateString(now, timeZone);
  // Default scope is calendar month when the client omits it.
  const scope = filter.scope ?? "month";

  // Review queue: status filter only, no date bounds.
  if (scope === "review") {
    // Return response object.
    return { reviewOnly: true };
  }
  // Single hotel day [today, tomorrow).
  if (scope === "today") {
    // Filter by hotelDate column keys (UTC midnight YMD), not zoned instants.
    const from = hotelDateKey(todayYmd);
    // Local to used below.
    const to = hotelDateKey(addDaysYmd(todayYmd, 1));
    // Return response object.
    return { from, to };
  }
  // ISO week Mon–Sun relative to today in hotel timezone.
  if (scope === "week") {
    // UTC noon of todayYmd so getUTCDay matches the hotel calendar day.
    const dow = new Date(`${todayYmd}T12:00:00.000Z`).getUTCDay();
    // Sunday → previous Monday (-6); else back to Monday of this week.
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    // Local monday used below.
    const monday = addDaysYmd(todayYmd, mondayOffset);
    // Local nextMonday used below.
    const nextMonday = addDaysYmd(monday, 7);
    // Return response object.
    return {
      // Compute from for the payload.
      from: hotelDateKey(monday),
      // Compute to for the payload.
      to: hotelDateKey(nextMonday),
    };
  }
  // Month scope: explicit filter.month or current YYYY-MM from todayYmd.
  const month =
    // Support the surrounding control flow.
    filter.month ?? `${todayYmd.slice(0, 4)}-${todayYmd.slice(5, 7)}`;
  // Return computed result.
  return monthRange(month);
}

/** Build Prisma where from scope window + optional employee/department/q. */
async function buildIntervalWhere(
  // Param filter required by this function.
  filter: ListIntervalsFilter,
): Promise<Prisma.AttendanceIntervalWhereInput> {
  // Hotel timezone from operations settings (not server local time).
  const ops = await getOperations();
  // Await window before dependent work.
  const window = await resolveDateWindow(filter, ops.hotelTimezone);

  // Accumulator object where.
  const where: Prisma.AttendanceIntervalWhereInput = {};
  // Review mode: only needs_review intervals (ignore date window).
  if (window.reviewOnly) {
    // Assign where.status.
    where.status = AttendanceIntervalStatus.needs_review;
  // Support the surrounding control flow.
  } else if (window.from && window.to) {
    // Half-open hotelDate range [from, to).
    where.hotelDate = { gte: window.from, lt: window.to };
  }
  // Optional single-employee filter.
  if (filter.employeeId) {
    // Assign where.employeeId.
    where.employeeId = filter.employeeId;
  }
  // Nested employee filters for department and free-text search.
  if (filter.department?.trim() || filter.q?.trim()) {
    // Accumulator object empWhere.
    const empWhere: Prisma.EmployeeWhereInput = {};
    // Case-insensitive exact department match.
    if (filter.department?.trim()) {
      // Assign empWhere.department.
      empWhere.department = {
        // Field equals on this type/payload.
        equals: filter.department.trim(),
        // Field mode on this type/payload.
        mode: "insensitive",
      };
    }
    // q matches fullName or employeeNumber (contains, case-insensitive).
    if (filter.q?.trim()) {
      // Local q used below.
      const q = filter.q.trim();
      // Assign empWhere.OR.
      empWhere.OR = [
        // Support the surrounding control flow.
        { fullName: { contains: q, mode: "insensitive" } },
        // Support the surrounding control flow.
        { employeeNumber: { contains: q, mode: "insensitive" } },
      ];
    }
    // Assign where.employee.
    where.employee = empWhere;
  }
  // Return computed result.
  return where;
}

/**
 * Keyset filter matching orderBy hotelDate/startedAt/id desc:
 * rows strictly "after" (older than) the cursor position.
 */
function cursorWhere(
  // Param cursor required by this function.
  cursor: IntervalCursor,
): Prisma.AttendanceIntervalWhereInput {
  // Reconstruct Date keys from opaque cursor strings.
  const hotelDate = new Date(`${cursor.hotelDate}T00:00:00.000Z`);
  // Date startedAt for window math.
  const startedAt = new Date(cursor.startedAt);
  // Lexicographic "less than" under desc sort: older hotelDate, then earlier
  // startedAt, then smaller id for ties.
  return {
    // Set OR.
    OR: [
      // Support the surrounding control flow.
      { hotelDate: { lt: hotelDate } },
      // Support the surrounding control flow.
      {
        // Compute AND for the payload.
        AND: [{ hotelDate }, { startedAt: { lt: startedAt } }],
      },
      // Support the surrounding control flow.
      {
        // Compute AND for the payload.
        AND: [{ hotelDate }, { startedAt }, { id: { lt: cursor.id } }],
      },
    ],
  };
}

/** Build an IntervalCursor from a fetched row's keyset columns. */
function rowToIntervalCursor(row: {
  // Param hotelDate required by this function.
  hotelDate: Date;
  // Param startedAt required by this function.
  startedAt: Date;
  // Param id required by this function.
  id: string;
// Support the surrounding control flow.
}): IntervalCursor {
  // hotelDate as YYYY-MM-DD; startedAt as full ISO for stable keyset ties.
  return {
    // Param hotelDate required by this function.
    hotelDate: formatHotelDate(row.hotelDate),
    // Param startedAt required by this function.
    startedAt: row.startedAt.toISOString(),
    // Param id required by this function.
    id: row.id,
  };
}

/** Paginated interval list for the given scope/filters (newest hotelDate first). */
export async function listIntervals(
  // Param filter required by this function.
  filter: ListIntervalsFilter,
  // Param page required by this function.
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
    // Database access for this step.
    prisma.attendanceInterval.count({ where }),
    // Database access for this step.
    prisma.attendanceInterval.findMany({
      // Filter matching rows.
      where: cursor ? { AND: [where, cursorWhere(cursor)] } : where,
      // Include relations for labels/checks.
      include: intervalInclude,
      // Stable sort for paging.
      orderBy: [{ hotelDate: "desc" }, { startedAt: "desc" }, { id: "desc" }],
      // Page size limit.
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
    // Set intervals.
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
    // Throw typed AppError for HTTP mapping.
    throw new AppError(
      413,
      "too_large",
      `Attendance export exceeds ${EXPORT_CEILING} rows; narrow the filter`,
      // Support the surrounding control flow.
      { total, ceiling: EXPORT_CEILING },
    );
  }

  // Cursor-drain all pages up to EXPORT_CEILING (truncation flag if hit).
  const { rows, truncated } = await drainExportPages({
    // Param batchSize required by this function.
    batchSize: EXPORT_BATCH,
    // Param ceiling required by this function.
    ceiling: EXPORT_CEILING,
    // Param toCursor required by this function.
    toCursor: rowToIntervalCursor,
    // Param fetchPage required by this function.
    fetchPage: async (cursor) =>
      // Database access for this step.
      prisma.attendanceInterval.findMany({
        // Filter matching rows.
        where: cursor ? { AND: [where, cursorWhere(cursor)] } : where,
        // Include relations for labels/checks.
        include: intervalInclude,
        // Stable sort for paging.
        orderBy: [
          // Support the surrounding control flow.
          { hotelDate: "desc" },
          // Support the surrounding control flow.
          { startedAt: "desc" },
          // Support the surrounding control flow.
          { id: "desc" },
        ],
        // Page size limit.
        take: EXPORT_BATCH,
      }),
  });

  // Map rows; truncated true when the hard ceiling stopped the drain.
  return {
    // Param intervals required by this function.
    intervals: rows.map(mapInterval),
    truncated,
    total,
  };
}

/** Fetch one interval by id (404 if missing). */
export async function getInterval(id: string) {
  // Load with the same include shape as list responses.
  const row = await prisma.attendanceInterval.findUnique({
    // Filter matching rows.
    where: { id },
    // Include relations for labels/checks.
    include: intervalInclude,
  });
  // Missing id → 404 (not an empty DTO).
  if (!row) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(404, "not_found", "Attendance interval not found");
  }
  // Return computed result.
  return mapInterval(row);
}

/** Max absolute clockSkewSeconds among start/end events in the filtered set. */
export async function maxClockSkewSeconds(
  // Param filter required by this function.
  filter: ListIntervalsFilter,
): Promise<number | null> {
  // Same interval filter as list/export.
  const where = await buildIntervalWhere(filter);
  // Only need event foreign keys to gather skew samples.
  const intervals = await prisma.attendanceInterval.findMany({
    where,
    // Select only needed columns.
    select: { startEventId: true, endEventId: true },
  });
  // Flatten start+end ids; drop null endEventId for open intervals.
  const eventIds = intervals
    // Continue fluent chain.
    .flatMap((i) => [i.startEventId, i.endEventId])
    // Filter with predicate.
    .filter((id): id is string => !!id);
  // No linked events → no skew to report.
  if (!eventIds.length) return null;
  // Load clockSkewSeconds for all referenced punch events.
  const events = await prisma.attendanceEvent.findMany({
    // Filter matching rows.
    where: { id: { in: eventIds } },
    // Select only needed columns.
    select: { clockSkewSeconds: true },
  });
  // Track max absolute skew; skip null skew values.
  let max: number | null = null;
  // Iterate items for aggregation or writes.
  for (const e of events) {
    // Conditional path for this guard.
    if (e.clockSkewSeconds == null) continue;
    // Derived metric abs.
    const abs = Math.abs(e.clockSkewSeconds);
    // Conditional path for this guard.
    if (max == null || abs > max) max = abs;
  }
  // Return computed result.
  return max;
}
