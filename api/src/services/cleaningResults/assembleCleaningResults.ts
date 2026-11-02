/**
 * In-memory aggregation of loaded cleaning-results sources into the report DTO.
 */
import { CleaningServiceType } from "@prisma/client";
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

export type CleaningResultsSessionRow = {
  finishedAt: Date | null;
  startedAt: Date;
  anomalyFlags: string[];
  employee: { id: string; fullName: string; employeeNumber: string };
};

export type CleaningResultsTaskRow = {
  locationId: string;
  serviceType: CleaningServiceType;
  dueAt: Date | null;
  completedAt: Date | null;
  assignedEmployee: {
    id: string;
    fullName: string;
    employeeNumber: string;
  } | null;
  sessions: Array<{
    startedAt: Date;
    finishedAt: Date | null;
    anomalyFlags: string[];
    employeeId: string;
  }>;
  inspections: Array<{ id: string }>;
};

export type CleaningResultsInspectionAssigneeRow = {
  task: { assignedEmployeeId: string | null };
};

/** Aggregate loaded sessions/tasks/inspections into the public report shape. */
export function assembleCleaningResults(input: {
  query: CleaningResultsQuery;
  anomalyThresholdMinutes: number;
  sessions: CleaningResultsSessionRow[];
  completedTasks: CleaningResultsTaskRow[];
  approvedInspections: number;
  rejectedInspections: number;
  approvedRows: CleaningResultsInspectionAssigneeRow[];
  rejectedRows: CleaningResultsInspectionAssigneeRow[];
}): CleaningResultsResponse {
  const {
    query,
    anomalyThresholdMinutes,
    sessions,
    completedTasks,
    approvedInspections,
    rejectedInspections,
    approvedRows,
    rejectedRows,
  } = input;

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
      return (
        a.fullName.localeCompare(b.fullName, "bg") ||
        a.employeeId.localeCompare(b.employeeId)
      );
    });

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
