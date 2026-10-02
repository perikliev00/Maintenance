import { SessionStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";

export type CleaningResultsQuery = {
  from: string;
  to: string;
  page: number;
  pageSize: number;
  /** Optional session filter from data scope (supervisor sectors, etc.). */
  sessionWhere?: Prisma.CleaningSessionWhereInput;
};

export type CleaningResultsRow = {
  employeeId: string;
  fullName: string;
  employeeNumber: string;
  tasksCompleted: number;
  roomsCleaned: number;
  onTimePct: number | null;
  avgMinutes: number | null;
  totalSessionMinutes: number;
};

export type CleaningResultsResponse = {
  period: { from: string; to: string };
  summary: {
    housekeeperCount: number;
    roomsCleaned: number;
    onTimePct: number | null;
    productivity: number | null;
  };
  series: Array<{ hour: number; rooms: number }>;
  rows: CleaningResultsRow[];
  page: number;
  pageSize: number;
  total: number;
};

function dayStartUtc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** Exclusive end: midnight of the day after `to`. */
function dayEndExclusiveUtc(isoDate: string): Date {
  const d = dayStartUtc(isoDate);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function getCleaningResults(
  query: CleaningResultsQuery,
): Promise<CleaningResultsResponse> {
  const fromStart = dayStartUtc(query.from);
  const toEnd = dayEndExclusiveUtc(query.to);

  const sessions = await prisma.cleaningSession.findMany({
    where: {
      status: SessionStatus.completed,
      finishedAt: {
        gte: fromStart,
        lt: toEnd,
      },
      ...(query.sessionWhere ?? {}),
    },
    include: {
      employee: {
        select: { id: true, fullName: true, employeeNumber: true },
      },
      task: {
        select: { dueAt: true },
      },
    },
  });

  type Agg = {
    employeeId: string;
    fullName: string;
    employeeNumber: string;
    tasksCompleted: number;
    onTimeKnown: number;
    onTimeOk: number;
    totalSessionMs: number;
  };

  const byEmployee = new Map<string, Agg>();
  const hourBuckets = Array.from({ length: 24 }, () => 0);

  let roomsCleaned = 0;
  let onTimeKnown = 0;
  let onTimeOk = 0;
  let totalSessionMs = 0;

  for (const session of sessions) {
    if (!session.finishedAt) continue;

    const durationMs = Math.max(
      0,
      session.finishedAt.getTime() - session.startedAt.getTime(),
    );
    roomsCleaned += 1;
    totalSessionMs += durationMs;

    const hour = session.finishedAt.getUTCHours();
    hourBuckets[hour] += 1;

    const dueAt = session.task.dueAt;
    let sessionOnTime: boolean | null = null;
    if (dueAt) {
      onTimeKnown += 1;
      sessionOnTime = session.finishedAt.getTime() <= dueAt.getTime();
      if (sessionOnTime) onTimeOk += 1;
    }

    let agg = byEmployee.get(session.employeeId);
    if (!agg) {
      agg = {
        employeeId: session.employee.id,
        fullName: session.employee.fullName,
        employeeNumber: session.employee.employeeNumber,
        tasksCompleted: 0,
        onTimeKnown: 0,
        onTimeOk: 0,
        totalSessionMs: 0,
      };
      byEmployee.set(session.employeeId, agg);
    }
    agg.tasksCompleted += 1;
    agg.totalSessionMs += durationMs;
    if (sessionOnTime !== null) {
      agg.onTimeKnown += 1;
      if (sessionOnTime) agg.onTimeOk += 1;
    }
  }

  const totalHours = totalSessionMs / (1000 * 60 * 60);
  const summaryOnTimePct =
    onTimeKnown > 0 ? round1((onTimeOk / onTimeKnown) * 100) : null;
  const productivity =
    totalHours > 0 ? round1(roomsCleaned / totalHours) : null;

  const allRows: CleaningResultsRow[] = [...byEmployee.values()]
    .map((agg) => {
      const totalSessionMinutes = round1(agg.totalSessionMs / (1000 * 60));
      return {
        employeeId: agg.employeeId,
        fullName: agg.fullName,
        employeeNumber: agg.employeeNumber,
        tasksCompleted: agg.tasksCompleted,
        roomsCleaned: agg.tasksCompleted,
        onTimePct:
          agg.onTimeKnown > 0
            ? round1((agg.onTimeOk / agg.onTimeKnown) * 100)
            : null,
        avgMinutes:
          agg.tasksCompleted > 0
            ? round1(totalSessionMinutes / agg.tasksCompleted)
            : null,
        totalSessionMinutes,
      };
    })
    .sort((a, b) => {
      if (b.tasksCompleted !== a.tasksCompleted) {
        return b.tasksCompleted - a.tasksCompleted;
      }
      return a.fullName.localeCompare(b.fullName, "bg");
    });

  const total = allRows.length;
  const start = (query.page - 1) * query.pageSize;
  const rows = allRows.slice(start, start + query.pageSize);

  const series = hourBuckets.map((rooms, hour) => ({ hour, rooms }));

  return {
    period: { from: query.from, to: query.to },
    summary: {
      housekeeperCount: total,
      roomsCleaned,
      onTimePct: summaryOnTimePct,
      productivity,
    },
    series,
    rows,
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}
