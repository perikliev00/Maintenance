import {
  CleaningServiceType,
  InspectionResult,
  Prisma,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { getOperations } from "./settings";

export type CleaningResultsQuery = {
  from: string;
  to: string;
  page: number;
  pageSize: number;
  serviceTypes?: CleaningServiceType[];
  /** Optional session filter from data scope (supervisor sectors, etc.). */
  sessionWhere?: Prisma.CleaningSessionWhereInput;
  /** Optional task filter from data scope. */
  taskWhere?: Prisma.CleaningTaskWhereInput;
};

export type CleaningResultsCounters = {
  completedSessions: number;
  completedTasks: number;
  acceptedTasks: number;
  reworkEvents: number;
  anomalousSessions: number;
  distinctRooms: number;
  onTimePct: number | null;
  avgValidMinutes: number | null;
  totalValidSessionMinutes: number;
  totalExcludedSessionMinutes: number;
};

export type CleaningResultsRow = {
  employeeId: string;
  fullName: string;
  employeeNumber: string;
} & CleaningResultsCounters;

export type CleaningResultsResponse = {
  period: { from: string; to: string };
  summary: {
    housekeeperCount: number;
    completedSessions: number;
    completedTasks: number;
    acceptedTasks: number;
    reworkEvents: number;
    anomalousSessions: number;
    distinctRooms: number;
    onTimePct: number | null;
    productivity: number | null;
    totalValidSessionMinutes: number;
    totalExcludedSessionMinutes: number;
    byServiceType: Array<{ key: CleaningServiceType; count: number }>;
  };
  series: Array<{ hour: number; completedSessions: number }>;
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

function asFlags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export function isAnomalousSession(input: {
  startedAt: Date;
  finishedAt: Date;
  anomalyFlags: unknown;
  anomalyThresholdMinutes: number;
}): boolean {
  const flags = asFlags(input.anomalyFlags);
  if (flags.length > 0) return true;
  const durationMin =
    (input.finishedAt.getTime() - input.startedAt.getTime()) / 60000;
  return durationMin >= input.anomalyThresholdMinutes;
}

/** Split session duration into valid vs excluded (anomalous) minutes. */
export function sessionDurationBuckets(input: {
  startedAt: Date;
  finishedAt: Date;
  anomalyFlags: unknown;
  anomalyThresholdMinutes: number;
}): { anomalous: boolean; durationMs: number } {
  const durationMs = Math.max(
    0,
    input.finishedAt.getTime() - input.startedAt.getTime(),
  );
  return {
    anomalous: isAnomalousSession(input),
    durationMs,
  };
}

/** Sum non-anomalous completed-session durations for a task (or session list). */
export function sumValidSessionMs(
  sessions: Array<{
    startedAt: Date;
    finishedAt: Date | null;
    anomalyFlags: unknown;
  }>,
  anomalyThresholdMinutes: number,
): number {
  return sessions.reduce((sum, s) => {
    if (!s.finishedAt) return sum;
    if (
      isAnomalousSession({
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        anomalyFlags: s.anomalyFlags,
        anomalyThresholdMinutes,
      })
    ) {
      return sum;
    }
    return (
      sum + Math.max(0, s.finishedAt.getTime() - s.startedAt.getTime())
    );
  }, 0);
}

/** Average valid minutes per completed task with valid session time. */
export function avgValidMinutesFromTaskMs(
  totalValidMsForTasks: number,
  tasksWithValidTime: number,
): number | null {
  return tasksWithValidTime > 0
    ? round1(totalValidMsForTasks / (1000 * 60) / tasksWithValidTime)
    : null;
}

function emptyCounters(): Omit<
  CleaningResultsCounters,
  | "onTimePct"
  | "avgValidMinutes"
  | "totalValidSessionMinutes"
  | "totalExcludedSessionMinutes"
> & {
  onTimeKnown: number;
  onTimeOk: number;
  totalValidSessionMs: number;
  totalExcludedSessionMs: number;
  totalValidMsForTasks: number;
  tasksWithValidTime: number;
} {
  return {
    completedSessions: 0,
    completedTasks: 0,
    acceptedTasks: 0,
    reworkEvents: 0,
    anomalousSessions: 0,
    distinctRooms: 0,
    onTimeKnown: 0,
    onTimeOk: 0,
    totalValidSessionMs: 0,
    totalExcludedSessionMs: 0,
    totalValidMsForTasks: 0,
    tasksWithValidTime: 0,
  };
}

function finalizeCounters(
  agg: ReturnType<typeof emptyCounters>,
  roomSet: Set<string>,
): CleaningResultsCounters {
  const totalValidSessionMinutes = round1(agg.totalValidSessionMs / (1000 * 60));
  const totalExcludedSessionMinutes = round1(
    agg.totalExcludedSessionMs / (1000 * 60),
  );
  return {
    completedSessions: agg.completedSessions,
    completedTasks: agg.completedTasks,
    acceptedTasks: agg.acceptedTasks,
    reworkEvents: agg.reworkEvents,
    anomalousSessions: agg.anomalousSessions,
    distinctRooms: roomSet.size,
    onTimePct:
      agg.onTimeKnown > 0
        ? round1((agg.onTimeOk / agg.onTimeKnown) * 100)
        : null,
    avgValidMinutes: avgValidMinutesFromTaskMs(
      agg.totalValidMsForTasks,
      agg.tasksWithValidTime,
    ),
    totalValidSessionMinutes,
    totalExcludedSessionMinutes,
  };
}

export async function getCleaningResults(
  query: CleaningResultsQuery,
): Promise<CleaningResultsResponse> {
  const fromStart = dayStartUtc(query.from);
  const toEnd = dayEndExclusiveUtc(query.to);
  const ops = await getOperations();
  const anomalyThresholdMinutes = ops.overdueSessionMinutes * 2;

  const serviceTypeFilter =
    query.serviceTypes && query.serviceTypes.length > 0
      ? { serviceType: { in: query.serviceTypes } }
      : {};

  const taskScope = {
    ...serviceTypeFilter,
    ...(query.taskWhere ?? {}),
  };

  const [sessions, completedTasks, approvedInspections, rejectedInspections] =
    await Promise.all([
      prisma.cleaningSession.findMany({
        where: {
          status: SessionStatus.completed,
          finishedAt: { gte: fromStart, lt: toEnd },
          ...(query.sessionWhere ?? {}),
          ...(Object.keys(taskScope).length
            ? { task: taskScope }
            : {}),
        },
        include: {
          employee: {
            select: { id: true, fullName: true, employeeNumber: true },
          },
          task: {
            select: {
              id: true,
              dueAt: true,
              locationId: true,
              serviceType: true,
              assignedEmployeeId: true,
            },
          },
        },
      }),
      prisma.cleaningTask.findMany({
        where: {
          status: TaskStatus.completed,
          completedAt: { gte: fromStart, lt: toEnd },
          ...taskScope,
        },
        include: {
          assignedEmployee: {
            select: { id: true, fullName: true, employeeNumber: true },
          },
          sessions: {
            where: { status: SessionStatus.completed },
            select: {
              startedAt: true,
              finishedAt: true,
              anomalyFlags: true,
              employeeId: true,
            },
          },
          inspections: {
            where: { result: InspectionResult.approved },
            select: { id: true },
            take: 1,
          },
        },
      }),
      prisma.inspection.count({
        where: {
          inspectedAt: { gte: fromStart, lt: toEnd },
          result: InspectionResult.approved,
          ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
        },
      }),
      prisma.inspection.count({
        where: {
          inspectedAt: { gte: fromStart, lt: toEnd },
          result: InspectionResult.rejected,
          ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
        },
      }),
    ]);

  // Auto-completed tasks (no inspection) count as accepted when completedAt in period.
  const autoAccepted = completedTasks.filter((t) => t.inspections.length === 0)
    .length;
  const acceptedTasks = approvedInspections + autoAccepted;

  type EmpAgg = ReturnType<typeof emptyCounters> & {
    employeeId: string;
    fullName: string;
    employeeNumber: string;
    roomIds: Set<string>;
  };

  const byEmployee = new Map<string, EmpAgg>();
  const hourBuckets = Array.from({ length: 24 }, () => 0);
  const summaryAgg = emptyCounters();
  const summaryRooms = new Set<string>();
  const byServiceType = new Map<CleaningServiceType, number>();

  function ensureEmp(
    employeeId: string,
    fullName: string,
    employeeNumber: string,
  ): EmpAgg {
    let agg = byEmployee.get(employeeId);
    if (!agg) {
      agg = {
        employeeId,
        fullName,
        employeeNumber,
        roomIds: new Set(),
        ...emptyCounters(),
      };
      byEmployee.set(employeeId, agg);
    }
    return agg;
  }

  for (const session of sessions) {
    if (!session.finishedAt) continue;

    const { anomalous, durationMs } = sessionDurationBuckets({
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      anomalyFlags: session.anomalyFlags,
      anomalyThresholdMinutes,
    });

    summaryAgg.completedSessions += 1;
    if (anomalous) {
      summaryAgg.anomalousSessions += 1;
      summaryAgg.totalExcludedSessionMs += durationMs;
    } else {
      summaryAgg.totalValidSessionMs += durationMs;
    }

    const hour = session.finishedAt.getUTCHours();
    hourBuckets[hour] += 1;

    const emp = ensureEmp(
      session.employee.id,
      session.employee.fullName,
      session.employee.employeeNumber,
    );
    emp.completedSessions += 1;
    if (anomalous) {
      emp.anomalousSessions += 1;
      emp.totalExcludedSessionMs += durationMs;
    } else {
      emp.totalValidSessionMs += durationMs;
    }
  }

  for (const task of completedTasks) {
    summaryAgg.completedTasks += 1;
    summaryRooms.add(task.locationId);
    byServiceType.set(
      task.serviceType,
      (byServiceType.get(task.serviceType) ?? 0) + 1,
    );

    if (task.dueAt && task.completedAt) {
      summaryAgg.onTimeKnown += 1;
      if (task.completedAt.getTime() <= task.dueAt.getTime()) {
        summaryAgg.onTimeOk += 1;
      }
    }

    const validSessionMs = sumValidSessionMs(
      task.sessions,
      anomalyThresholdMinutes,
    );
    if (validSessionMs > 0) {
      summaryAgg.tasksWithValidTime += 1;
      summaryAgg.totalValidMsForTasks += validSessionMs;
    }

    const assignee = task.assignedEmployee;
    if (assignee) {
      const emp = ensureEmp(
        assignee.id,
        assignee.fullName,
        assignee.employeeNumber,
      );
      emp.completedTasks += 1;
      emp.roomIds.add(task.locationId);
      if (task.dueAt && task.completedAt) {
        emp.onTimeKnown += 1;
        if (task.completedAt.getTime() <= task.dueAt.getTime()) {
          emp.onTimeOk += 1;
        }
      }
      if (validSessionMs > 0) {
        emp.tasksWithValidTime += 1;
        emp.totalValidMsForTasks += validSessionMs;
      }
    }
  }

  // Accepted / rework attributed to assignee when possible
  const [approvedRows, rejectedRows] = await Promise.all([
    prisma.inspection.findMany({
      where: {
        inspectedAt: { gte: fromStart, lt: toEnd },
        result: InspectionResult.approved,
        ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
      },
      select: {
        task: { select: { assignedEmployeeId: true } },
      },
    }),
    prisma.inspection.findMany({
      where: {
        inspectedAt: { gte: fromStart, lt: toEnd },
        result: InspectionResult.rejected,
        ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
      },
      select: {
        task: { select: { assignedEmployeeId: true } },
      },
    }),
  ]);

  summaryAgg.acceptedTasks = acceptedTasks;
  summaryAgg.reworkEvents = rejectedInspections;

  for (const row of approvedRows) {
    const id = row.task.assignedEmployeeId;
    if (!id) continue;
    const emp = byEmployee.get(id);
    if (emp) emp.acceptedTasks += 1;
  }
  for (const task of completedTasks) {
    if (task.inspections.length === 0 && task.assignedEmployee) {
      const emp = byEmployee.get(task.assignedEmployee.id);
      if (emp) emp.acceptedTasks += 1;
    }
  }
  for (const row of rejectedRows) {
    const id = row.task.assignedEmployeeId;
    if (!id) continue;
    const emp = byEmployee.get(id);
    if (emp) emp.reworkEvents += 1;
  }

  const summaryCounters = finalizeCounters(summaryAgg, summaryRooms);
  const totalValidHours = summaryAgg.totalValidSessionMs / (1000 * 60 * 60);
  const productivity =
    totalValidHours > 0
      ? round1(summaryCounters.completedTasks / totalValidHours)
      : null;

  const allRows: CleaningResultsRow[] = [...byEmployee.values()]
    .map((agg) => {
      const counters = finalizeCounters(agg, agg.roomIds);
      return {
        employeeId: agg.employeeId,
        fullName: agg.fullName,
        employeeNumber: agg.employeeNumber,
        ...counters,
      };
    })
    .sort((a, b) => {
      if (b.completedTasks !== a.completedTasks) {
        return b.completedTasks - a.completedTasks;
      }
      if (b.completedSessions !== a.completedSessions) {
        return b.completedSessions - a.completedSessions;
      }
      return a.fullName.localeCompare(b.fullName, "bg");
    });

  /** Employees with ≥1 completed session in the period. */
  const housekeeperCount = allRows.filter((r) => r.completedSessions > 0).length;

  const total = allRows.length;
  const start = (query.page - 1) * query.pageSize;
  const rows = allRows.slice(start, start + query.pageSize);

  const series = hourBuckets.map((completedSessions, hour) => ({
    hour,
    completedSessions,
  }));

  return {
    period: { from: query.from, to: query.to },
    summary: {
      housekeeperCount,
      completedSessions: summaryCounters.completedSessions,
      completedTasks: summaryCounters.completedTasks,
      acceptedTasks: summaryCounters.acceptedTasks,
      reworkEvents: summaryCounters.reworkEvents,
      anomalousSessions: summaryCounters.anomalousSessions,
      distinctRooms: summaryCounters.distinctRooms,
      onTimePct: summaryCounters.onTimePct,
      productivity,
      totalValidSessionMinutes: summaryCounters.totalValidSessionMinutes,
      totalExcludedSessionMinutes: summaryCounters.totalExcludedSessionMinutes,
      byServiceType: [...byServiceType.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    },
    series,
    rows,
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}
