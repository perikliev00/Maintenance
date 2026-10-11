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

function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) {
    throw new AppError(400, "validation", "Invalid month (expected YYYY-MM)");
  }
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return { from, to };
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
