/**
 * Build the housekeeping cleaning-results report for a date range:
 * per-employee counters, period summary, and hourly completion series.
 */
import {
  CleaningServiceType,
  InspectionResult,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../../db";
import { getOperations } from "../settings";
import type {
  CleaningResultsQuery,
  CleaningResultsResponse,
  CleaningResultsRow,
} from "./types";
import {
  round1,
  sessionDurationBuckets,
  sumValidSessionMs,
} from "./metrics";
import { emptyCounters, finalizeCounters } from "./counters";

/** Inclusive range start: UTC midnight of `isoDate` (YYYY-MM-DD). */
function dayStartUtc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** Exclusive end: midnight of the day after `to`. */
function dayEndExclusiveUtc(isoDate: string): Date {
  // Advance one calendar day so `finishedAt < toEnd` includes all of `to`.
  const d = dayStartUtc(isoDate);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/**
 * Aggregate completed sessions/tasks in `[from, to]` (inclusive YYYY-MM-DD),
 * applying optional service-type and data-scope filters. Anomalous sessions use
 * 2× overdueSessionMinutes as the duration threshold.
 */
export async function getCleaningResults(
  query: CleaningResultsQuery,
): Promise<CleaningResultsResponse> {
  // Inclusive `[from, to]` as half-open UTC `[fromStart, toEnd)`.
  const fromStart = dayStartUtc(query.from);
  const toEnd = dayEndExclusiveUtc(query.to);
  // Anomaly duration threshold = 2× configured overdue session minutes.
  const ops = await getOperations();
  const anomalyThresholdMinutes = ops.overdueSessionMinutes * 2;

  // Optional service-type IN filter (empty list → no filter).
  const serviceTypeFilter =
    query.serviceTypes && query.serviceTypes.length > 0
      ? { serviceType: { in: query.serviceTypes } }
      : {};

  // Merge service-type with optional data-scope taskWhere.
  const taskScope = {
    ...serviceTypeFilter,
    ...(query.taskWhere ?? {}),
  };

  // Parallel load: completed sessions, completed tasks, inspection counts.
  const [sessions, completedTasks, approvedInspections, rejectedInspections] =
    await Promise.all([
      // Completed sessions finished in the period (employee + task joins).
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
      // Completed tasks in the period with sessions + any approved inspection.
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
      // Period approved-inspection count (summary acceptedTasks input).
      prisma.inspection.count({
        where: {
          inspectedAt: { gte: fromStart, lt: toEnd },
          result: InspectionResult.approved,
          ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
        },
      }),
      // Period rejected-inspection count (summary reworkEvents).
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

  // Per-employee accumulators + period summary + hourly series buckets.
  const byEmployee = new Map<string, EmpAgg>();
  const hourBuckets = Array.from({ length: 24 }, () => 0);
  const summaryAgg = emptyCounters();
  const summaryRooms = new Set<string>();
  const byServiceType = new Map<CleaningServiceType, number>();

  /** Get or create the mutable accumulator for one housekeeper. */
  function ensureEmp(
    employeeId: string,
    fullName: string,
    employeeNumber: string,
  ): EmpAgg {
    let agg = byEmployee.get(employeeId);
    // First sighting of this employee in the period → seed zeroed counters.
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

  // Roll completed sessions into summary + per-employee + hour series.
  for (const session of sessions) {
    // Defensive: completed status should always have finishedAt.
    if (!session.finishedAt) continue;

    // Split duration into valid vs excluded (anomalous) ms.
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

    // Hour-of-day series uses UTC hour of finishedAt.
    const hour = session.finishedAt.getUTCHours();
    hourBuckets[hour] += 1;

    // Attribute session counts to the employee who ran the session.
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

  // Roll completed tasks into summary + per-assignee counters.
  for (const task of completedTasks) {
    summaryAgg.completedTasks += 1;
    summaryRooms.add(task.locationId);
    // Service-type breakdown for the summary chart.
    byServiceType.set(
      task.serviceType,
      (byServiceType.get(task.serviceType) ?? 0) + 1,
    );

    // On-time scoring only when both dueAt and completedAt are present.
    if (task.dueAt && task.completedAt) {
      summaryAgg.onTimeKnown += 1;
      if (task.completedAt.getTime() <= task.dueAt.getTime()) {
        summaryAgg.onTimeOk += 1;
      }
    }

    // Valid session time on this task feeds avg-minutes KPI.
    const validSessionMs = sumValidSessionMs(
      task.sessions,
      anomalyThresholdMinutes,
    );
    if (validSessionMs > 0) {
      summaryAgg.tasksWithValidTime += 1;
      summaryAgg.totalValidMsForTasks += validSessionMs;
    }

    // Per-employee task stats require an assignee.
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
    // Approved inspections → per-assignee acceptedTasks.
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
    // Rejected inspections → per-assignee reworkEvents.
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

  // Summary accepted/rework from the period counts computed above.
  summaryAgg.acceptedTasks = acceptedTasks;
  summaryAgg.reworkEvents = rejectedInspections;

  // Credit each approved inspection to the task assignee (if known).
  for (const row of approvedRows) {
    const id = row.task.assignedEmployeeId;
    if (!id) continue;
    const emp = byEmployee.get(id);
    if (emp) emp.acceptedTasks += 1;
  }
  // Auto-accepted (no inspection) tasks also credit the assignee.
  for (const task of completedTasks) {
    if (task.inspections.length === 0 && task.assignedEmployee) {
      const emp = byEmployee.get(task.assignedEmployee.id);
      if (emp) emp.acceptedTasks += 1;
    }
  }
  // Credit each rejection to the task assignee as a rework event.
  for (const row of rejectedRows) {
    const id = row.task.assignedEmployeeId;
    if (!id) continue;
    const emp = byEmployee.get(id);
    if (emp) emp.reworkEvents += 1;
  }

  // Finalize summary counters (minutes, on-time %, avg valid minutes).
  const summaryCounters = finalizeCounters(summaryAgg, summaryRooms);
  // Productivity = completed tasks per valid session hour (null if no valid time).
  const totalValidHours = summaryAgg.totalValidSessionMs / (1000 * 60 * 60);
  const productivity =
    totalValidHours > 0
      ? round1(summaryCounters.completedTasks / totalValidHours)
      : null;

  // Build paged employee rows: finalize, then sort by volume then name.
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
      // Primary: more completed tasks first.
      if (b.completedTasks !== a.completedTasks) {
        return b.completedTasks - a.completedTasks;
      }
      // Secondary: more completed sessions first.
      if (b.completedSessions !== a.completedSessions) {
        return b.completedSessions - a.completedSessions;
      }
      // Tertiary: Bulgarian locale name order.
      return a.fullName.localeCompare(b.fullName, "bg") || a.employeeId.localeCompare(b.employeeId);
    });

  /** Employees with ≥1 completed session in the period. */
  const housekeeperCount = allRows.filter((r) => r.completedSessions > 0).length;

  // Page slice for the results table.
  const total = allRows.length;
  const start = (query.page - 1) * query.pageSize;
  const rows = allRows.slice(start, start + query.pageSize);

  // Hourly completion series (0–23 UTC).
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
      // Service-type breakdown sorted by count desc, then key asc.
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
