/**
 * In-memory aggregation of loaded cleaning-results sources into the report DTO.
 */
import { CleaningServiceType } from "@prisma/client";
import type {
  CleaningResultsQuery,
  CleaningResultsResponse,
  CleaningResultsRow,
// Execute: } from "./types";
} from "./types";
// Side-effect or default import required by this module.
import {
  round1,
  sessionDurationBuckets,
  sumValidSessionMs,
// Execute: } from "./metrics";
} from "./metrics";
// Import ./counters for cleaningResults/assembleCleaningResults.ts.
import { emptyCounters, finalizeCounters } from "./counters";

// Public type describing CleaningResultsSessionRow.
export type CleaningResultsSessionRow = {
  finishedAt: Date | null;
  startedAt: Date;
  anomalyFlags: string[];
  employee: { id: string; fullName: string; employeeNumber: string };
};

// Public type describing CleaningResultsTaskRow.
export type CleaningResultsTaskRow = {
  locationId: string;
  serviceType: CleaningServiceType;
  dueAt: Date | null;
  completedAt: Date | null;
  // Open nested structure for the next related fields.
  assignedEmployee: {
    id: string;
    fullName: string;
    employeeNumber: string;
  // Execute: } | null;
  } | null;
  // Open nested structure for the next related fields.
  sessions: Array<{
    startedAt: Date;
    finishedAt: Date | null;
    anomalyFlags: string[];
    employeeId: string;
  // Execute: }>;
  }>;
  inspections: Array<{ id: string }>;
};

// Public type describing CleaningResultsInspectionAssigneeRow.
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
  // Execute: } = input;
  } = input;

  const autoAccepted = completedTasks.filter((t) => t.inspections.length === 0)
    // Continue the previous expression with this clause.
    .length;
  const acceptedTasks = approvedInspections + autoAccepted;

  // Local structural type for this module's contracts.
  type EmpAgg = ReturnType<typeof emptyCounters> & {
    employeeId: string;
    fullName: string;
    employeeNumber: string;
    roomIds: Set<string>;
  };

  // Construct byEmployee for later use in this flow.
  const byEmployee = new Map<string, EmpAgg>();
  const hourBuckets = Array.from({ length: 24 }, () => 0);
  const summaryAgg = emptyCounters();
  // Construct summaryRooms for later use in this flow.
  const summaryRooms = new Set<string>();
  // Construct byServiceType for later use in this flow.
  const byServiceType = new Map<CleaningServiceType, number>();

  // Local helper ensureEmp keeps the main flow readable.
  function ensureEmp(
    employeeId: string,
    fullName: string,
    employeeNumber: string,
  ): EmpAgg {
    let agg = byEmployee.get(employeeId);
    // Guard: handle missing/invalid state before continuing.
    if (!agg) {
      agg = {
        employeeId,
        fullName,
        employeeNumber,
        roomIds: new Set(),
        // Spread remaining fields without dropping caller data.
        ...emptyCounters(),
      };
      // Execute: byEmployee.set(employeeId, agg);
      byEmployee.set(employeeId, agg);
    }
    return agg;
  }

  // Iterate items to apply the same rule to each.
  for (const session of sessions) {
    // Guard: handle missing/invalid state before continuing.
    if (!session.finishedAt) continue;

    const { anomalous, durationMs } = sessionDurationBuckets({
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      anomalyFlags: session.anomalyFlags,
      anomalyThresholdMinutes,
    });

    // Execute: summaryAgg.completedSessions += 1;
    summaryAgg.completedSessions += 1;
    // Branch when this condition holds for the domain rule.
    if (anomalous) {
      // Execute: summaryAgg.anomalousSessions += 1;
      summaryAgg.anomalousSessions += 1;
      // Execute: summaryAgg.totalExcludedSessionMs += durationMs;
      summaryAgg.totalExcludedSessionMs += durationMs;
    } else {
      // Execute: summaryAgg.totalValidSessionMs += durationMs;
      summaryAgg.totalValidSessionMs += durationMs;
    }

    const hour = session.finishedAt.getUTCHours();
    // Execute: hourBuckets[hour] += 1;
    hourBuckets[hour] += 1;

    const emp = ensureEmp(
      // Execute: session.employee.id,
      session.employee.id,
      // Execute: session.employee.fullName,
      session.employee.fullName,
      // Execute: session.employee.employeeNumber,
      session.employee.employeeNumber,
    );
    // Execute: emp.completedSessions += 1;
    emp.completedSessions += 1;
    // Branch when this condition holds for the domain rule.
    if (anomalous) {
      // Execute: emp.anomalousSessions += 1;
      emp.anomalousSessions += 1;
      // Execute: emp.totalExcludedSessionMs += durationMs;
      emp.totalExcludedSessionMs += durationMs;
    } else {
      // Execute: emp.totalValidSessionMs += durationMs;
      emp.totalValidSessionMs += durationMs;
    }
  }

  // Iterate items to apply the same rule to each.
  for (const task of completedTasks) {
    // Execute: summaryAgg.completedTasks += 1;
    summaryAgg.completedTasks += 1;
    // Execute: summaryRooms.add(task.locationId);
    summaryRooms.add(task.locationId);
    // Execute: byServiceType.set(
    byServiceType.set(
      // Execute: task.serviceType,
      task.serviceType,
      // Execute: (byServiceType.get(task.serviceType) ?? 0) + 1,
      (byServiceType.get(task.serviceType) ?? 0) + 1,
    );

    // Branch when this condition holds for the domain rule.
    if (task.dueAt && task.completedAt) {
      // Execute: summaryAgg.onTimeKnown += 1;
      summaryAgg.onTimeKnown += 1;
      // Branch when this condition holds for the domain rule.
      if (task.completedAt.getTime() <= task.dueAt.getTime()) {
        // Execute: summaryAgg.onTimeOk += 1;
        summaryAgg.onTimeOk += 1;
      }
    }

    const validSessionMs = sumValidSessionMs(
      // Execute: task.sessions,
      task.sessions,
      anomalyThresholdMinutes,
    );
    // Branch when this condition holds for the domain rule.
    if (validSessionMs > 0) {
      // Execute: summaryAgg.tasksWithValidTime += 1;
      summaryAgg.tasksWithValidTime += 1;
      // Execute: summaryAgg.totalValidMsForTasks += validSessionMs;
      summaryAgg.totalValidMsForTasks += validSessionMs;
    }

    const assignee = task.assignedEmployee;
    // Branch when this condition holds for the domain rule.
    if (assignee) {
      const emp = ensureEmp(
        // Execute: assignee.id,
        assignee.id,
        // Execute: assignee.fullName,
        assignee.fullName,
        // Execute: assignee.employeeNumber,
        assignee.employeeNumber,
      );
      // Execute: emp.completedTasks += 1;
      emp.completedTasks += 1;
      // Execute: emp.roomIds.add(task.locationId);
      emp.roomIds.add(task.locationId);
      // Branch when this condition holds for the domain rule.
      if (task.dueAt && task.completedAt) {
        // Execute: emp.onTimeKnown += 1;
        emp.onTimeKnown += 1;
        // Branch when this condition holds for the domain rule.
        if (task.completedAt.getTime() <= task.dueAt.getTime()) {
          // Execute: emp.onTimeOk += 1;
          emp.onTimeOk += 1;
        }
      }
      // Branch when this condition holds for the domain rule.
      if (validSessionMs > 0) {
        // Execute: emp.tasksWithValidTime += 1;
        emp.tasksWithValidTime += 1;
        // Execute: emp.totalValidMsForTasks += validSessionMs;
        emp.totalValidMsForTasks += validSessionMs;
      }
    }
  }

  // Execute: summaryAgg.acceptedTasks = acceptedTasks;
  summaryAgg.acceptedTasks = acceptedTasks;
  // Execute: summaryAgg.reworkEvents = rejectedInspections;
  summaryAgg.reworkEvents = rejectedInspections;

  // Iterate items to apply the same rule to each.
  for (const row of approvedRows) {
    const id = row.task.assignedEmployeeId;
    // Guard: handle missing/invalid state before continuing.
    if (!id) continue;
    const emp = byEmployee.get(id);
    // Branch when this condition holds for the domain rule.
    if (emp) emp.acceptedTasks += 1;
  }
  // Iterate items to apply the same rule to each.
  for (const task of completedTasks) {
    // Empty result — branch to not-found or no-op path.
    if (task.inspections.length === 0 && task.assignedEmployee) {
      const emp = byEmployee.get(task.assignedEmployee.id);
      // Branch when this condition holds for the domain rule.
      if (emp) emp.acceptedTasks += 1;
    }
  }
  // Iterate items to apply the same rule to each.
  for (const row of rejectedRows) {
    const id = row.task.assignedEmployeeId;
    // Guard: handle missing/invalid state before continuing.
    if (!id) continue;
    const emp = byEmployee.get(id);
    // Branch when this condition holds for the domain rule.
    if (emp) emp.reworkEvents += 1;
  }

  const summaryCounters = finalizeCounters(summaryAgg, summaryRooms);
  const totalValidHours = summaryAgg.totalValidSessionMs / (1000 * 60 * 60);
  const productivity =
    // Execute: totalValidHours > 0
    totalValidHours > 0
      // Continue the previous expression with this clause.
      ? round1(summaryCounters.completedTasks / totalValidHours)
      // Continue the previous expression with this clause.
      : null;

  // Execute: const allRows: CleaningResultsRow[] = [...byEmployee.values()]
  const allRows: CleaningResultsRow[] = [...byEmployee.values()]
    .map((agg) => {
      const counters = finalizeCounters(agg, agg.roomIds);
      return {
        employeeId: agg.employeeId,
        fullName: agg.fullName,
        employeeNumber: agg.employeeNumber,
        // Spread remaining fields without dropping caller data.
        ...counters,
      };
    })
    .sort((a, b) => {
      // Guard: handle missing/invalid state before continuing.
      if (b.completedTasks !== a.completedTasks) {
        return b.completedTasks - a.completedTasks;
      }
      // Guard: handle missing/invalid state before continuing.
      if (b.completedSessions !== a.completedSessions) {
        return b.completedSessions - a.completedSessions;
      }
      return (
        // Execute: a.fullName.localeCompare(b.fullName, "bg") ||
        a.fullName.localeCompare(b.fullName, "bg") ||
        // Execute: a.employeeId.localeCompare(b.employeeId)
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
  // Execute: }));
  }));

  return {
    period: { from: query.from, to: query.to },
    // Open nested structure for the next related fields.
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
        // Continue the previous expression with this clause.
        .map(([key, count]) => ({ key, count }))
        // Continue the previous expression with this clause.
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    },
    series,
    rows,
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}
