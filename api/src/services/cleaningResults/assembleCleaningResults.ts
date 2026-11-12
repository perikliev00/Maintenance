/**
 * In-memory aggregation of loaded cleaning-results sources into the report DTO.
 */
import { CleaningServiceType } from "@prisma/client";
// Type-only import from module used by cleaningResults/assembleCleaningResults.ts.
import type {
  // Carry this field through the payload or query.
  CleaningResultsQuery,
  // Carry this field through the payload or query.
  CleaningResultsResponse,
  // Carry this field through the payload or query.
  CleaningResultsRow,
// Execute: } from "./types";
} from "./types";
// Side-effect or default import required by this module.
import {
  // Field value required by this payload or query.
  round1,
  // Carry this field through the payload or query.
  sessionDurationBuckets,
  // Carry this field through the payload or query.
  sumValidSessionMs,
// Execute: } from "./metrics";
} from "./metrics";
// Import ./counters for cleaningResults/assembleCleaningResults.ts.
import { emptyCounters, finalizeCounters } from "./counters";

// Public type describing CleaningResultsSessionRow.
export type CleaningResultsSessionRow = {
  // Field value required by this payload or query.
  finishedAt: Date | null;
  // Carry this field through the payload or query.
  startedAt: Date;
  // Carry this field through the payload or query.
  anomalyFlags: string[];
  // Carry this field through the payload or query.
  employee: { id: string; fullName: string; employeeNumber: string };
};

// Public type describing CleaningResultsTaskRow.
export type CleaningResultsTaskRow = {
  // Carry this field through the payload or query.
  locationId: string;
  // Carry this field through the payload or query.
  serviceType: CleaningServiceType;
  // Field value required by this payload or query.
  dueAt: Date | null;
  // Field value required by this payload or query.
  completedAt: Date | null;
  // Open nested structure for the next related fields.
  assignedEmployee: {
    // Carry this field through the payload or query.
    id: string;
    // Carry this field through the payload or query.
    fullName: string;
    // Carry this field through the payload or query.
    employeeNumber: string;
  // Execute: } | null;
  } | null;
  // Open nested structure for the next related fields.
  sessions: Array<{
    // Carry this field through the payload or query.
    startedAt: Date;
    // Field value required by this payload or query.
    finishedAt: Date | null;
    // Carry this field through the payload or query.
    anomalyFlags: string[];
    // Carry this field through the payload or query.
    employeeId: string;
  // Execute: }>;
  }>;
  // Carry this field through the payload or query.
  inspections: Array<{ id: string }>;
};

// Public type describing CleaningResultsInspectionAssigneeRow.
export type CleaningResultsInspectionAssigneeRow = {
  // Field value required by this payload or query.
  task: { assignedEmployeeId: string | null };
};

/** Aggregate loaded sessions/tasks/inspections into the public report shape. */
export function assembleCleaningResults(input: {
  // Carry this field through the payload or query.
  query: CleaningResultsQuery;
  // Carry this field through the payload or query.
  anomalyThresholdMinutes: number;
  // Carry this field through the payload or query.
  sessions: CleaningResultsSessionRow[];
  // Carry this field through the payload or query.
  completedTasks: CleaningResultsTaskRow[];
  // Carry this field through the payload or query.
  approvedInspections: number;
  // Carry this field through the payload or query.
  rejectedInspections: number;
  // Carry this field through the payload or query.
  approvedRows: CleaningResultsInspectionAssigneeRow[];
  // Carry this field through the payload or query.
  rejectedRows: CleaningResultsInspectionAssigneeRow[];
// Begin block/object for the following statements.
}): CleaningResultsResponse {
  // Begin block/object for the following statements.
  const {
    // Carry this field through the payload or query.
    query,
    // Carry this field through the payload or query.
    anomalyThresholdMinutes,
    // Carry this field through the payload or query.
    sessions,
    // Carry this field through the payload or query.
    completedTasks,
    // Carry this field through the payload or query.
    approvedInspections,
    // Carry this field through the payload or query.
    rejectedInspections,
    // Carry this field through the payload or query.
    approvedRows,
    // Carry this field through the payload or query.
    rejectedRows,
  // Execute: } = input;
  } = input;

  // Capture autoAccepted for subsequent checks or writes.
  const autoAccepted = completedTasks.filter((t) => t.inspections.length === 0)
    // Continue the previous expression with this clause.
    .length;
  // Capture acceptedTasks for subsequent checks or writes.
  const acceptedTasks = approvedInspections + autoAccepted;

  // Local structural type for this module's contracts.
  type EmpAgg = ReturnType<typeof emptyCounters> & {
    // Carry this field through the payload or query.
    employeeId: string;
    // Carry this field through the payload or query.
    fullName: string;
    // Carry this field through the payload or query.
    employeeNumber: string;
    // Carry this field through the payload or query.
    roomIds: Set<string>;
  };

  // Construct byEmployee for later use in this flow.
  const byEmployee = new Map<string, EmpAgg>();
  // Capture hourBuckets for subsequent checks or writes.
  const hourBuckets = Array.from({ length: 24 }, () => 0);
  // Capture summaryAgg for subsequent checks or writes.
  const summaryAgg = emptyCounters();
  // Construct summaryRooms for later use in this flow.
  const summaryRooms = new Set<string>();
  // Construct byServiceType for later use in this flow.
  const byServiceType = new Map<CleaningServiceType, number>();

  // Local helper ensureEmp keeps the main flow readable.
  function ensureEmp(
    // Carry this field through the payload or query.
    employeeId: string,
    // Carry this field through the payload or query.
    fullName: string,
    // Carry this field through the payload or query.
    employeeNumber: string,
  // Begin block/object for the following statements.
  ): EmpAgg {
    // Capture agg for subsequent checks or writes.
    let agg = byEmployee.get(employeeId);
    // Guard: handle missing/invalid state before continuing.
    if (!agg) {
      // Begin block/object for the following statements.
      agg = {
        // Carry this field through the payload or query.
        employeeId,
        // Carry this field through the payload or query.
        fullName,
        // Carry this field through the payload or query.
        employeeNumber,
        // Carry this field through the payload or query.
        roomIds: new Set(),
        // Spread remaining fields without dropping caller data.
        ...emptyCounters(),
      };
      // Execute: byEmployee.set(employeeId, agg);
      byEmployee.set(employeeId, agg);
    }
    // Return the computed result to the caller.
    return agg;
  }

  // Iterate items to apply the same rule to each.
  for (const session of sessions) {
    // Guard: handle missing/invalid state before continuing.
    if (!session.finishedAt) continue;

    // Begin block/object for the following statements.
    const { anomalous, durationMs } = sessionDurationBuckets({
      // Carry this field through the payload or query.
      startedAt: session.startedAt,
      // Carry this field through the payload or query.
      finishedAt: session.finishedAt,
      // Carry this field through the payload or query.
      anomalyFlags: session.anomalyFlags,
      // Carry this field through the payload or query.
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
    // Begin block/object for the following statements.
    } else {
      // Execute: summaryAgg.totalValidSessionMs += durationMs;
      summaryAgg.totalValidSessionMs += durationMs;
    }

    // Capture hour for subsequent checks or writes.
    const hour = session.finishedAt.getUTCHours();
    // Execute: hourBuckets[hour] += 1;
    hourBuckets[hour] += 1;

    // Capture emp for subsequent checks or writes.
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
    // Begin block/object for the following statements.
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

    // Capture validSessionMs for subsequent checks or writes.
    const validSessionMs = sumValidSessionMs(
      // Execute: task.sessions,
      task.sessions,
      // Carry this field through the payload or query.
      anomalyThresholdMinutes,
    );
    // Branch when this condition holds for the domain rule.
    if (validSessionMs > 0) {
      // Execute: summaryAgg.tasksWithValidTime += 1;
      summaryAgg.tasksWithValidTime += 1;
      // Execute: summaryAgg.totalValidMsForTasks += validSessionMs;
      summaryAgg.totalValidMsForTasks += validSessionMs;
    }

    // Capture assignee for subsequent checks or writes.
    const assignee = task.assignedEmployee;
    // Branch when this condition holds for the domain rule.
    if (assignee) {
      // Capture emp for subsequent checks or writes.
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
    // Capture id for subsequent checks or writes.
    const id = row.task.assignedEmployeeId;
    // Guard: handle missing/invalid state before continuing.
    if (!id) continue;
    // Capture emp for subsequent checks or writes.
    const emp = byEmployee.get(id);
    // Branch when this condition holds for the domain rule.
    if (emp) emp.acceptedTasks += 1;
  }
  // Iterate items to apply the same rule to each.
  for (const task of completedTasks) {
    // Empty result — branch to not-found or no-op path.
    if (task.inspections.length === 0 && task.assignedEmployee) {
      // Capture emp for subsequent checks or writes.
      const emp = byEmployee.get(task.assignedEmployee.id);
      // Branch when this condition holds for the domain rule.
      if (emp) emp.acceptedTasks += 1;
    }
  }
  // Iterate items to apply the same rule to each.
  for (const row of rejectedRows) {
    // Capture id for subsequent checks or writes.
    const id = row.task.assignedEmployeeId;
    // Guard: handle missing/invalid state before continuing.
    if (!id) continue;
    // Capture emp for subsequent checks or writes.
    const emp = byEmployee.get(id);
    // Branch when this condition holds for the domain rule.
    if (emp) emp.reworkEvents += 1;
  }

  // Capture summaryCounters for subsequent checks or writes.
  const summaryCounters = finalizeCounters(summaryAgg, summaryRooms);
  // Capture totalValidHours for subsequent checks or writes.
  const totalValidHours = summaryAgg.totalValidSessionMs / (1000 * 60 * 60);
  // Capture productivity for subsequent checks or writes.
  const productivity =
    // Execute: totalValidHours > 0
    totalValidHours > 0
      // Continue the previous expression with this clause.
      ? round1(summaryCounters.completedTasks / totalValidHours)
      // Continue the previous expression with this clause.
      : null;

  // Execute: const allRows: CleaningResultsRow[] = [...byEmployee.values()]
  const allRows: CleaningResultsRow[] = [...byEmployee.values()]
    // Begin block/object for the following statements.
    .map((agg) => {
      // Capture counters for subsequent checks or writes.
      const counters = finalizeCounters(agg, agg.roomIds);
      // Return the computed result to the caller.
      return {
        // Carry this field through the payload or query.
        employeeId: agg.employeeId,
        // Carry this field through the payload or query.
        fullName: agg.fullName,
        // Carry this field through the payload or query.
        employeeNumber: agg.employeeNumber,
        // Spread remaining fields without dropping caller data.
        ...counters,
      };
    })
    // Begin block/object for the following statements.
    .sort((a, b) => {
      // Guard: handle missing/invalid state before continuing.
      if (b.completedTasks !== a.completedTasks) {
        // Return the computed result to the caller.
        return b.completedTasks - a.completedTasks;
      }
      // Guard: handle missing/invalid state before continuing.
      if (b.completedSessions !== a.completedSessions) {
        // Return the computed result to the caller.
        return b.completedSessions - a.completedSessions;
      }
      // Return the computed result to the caller.
      return (
        // Execute: a.fullName.localeCompare(b.fullName, "bg") ||
        a.fullName.localeCompare(b.fullName, "bg") ||
        // Execute: a.employeeId.localeCompare(b.employeeId)
        a.employeeId.localeCompare(b.employeeId)
      );
    });

  // Capture housekeeperCount for subsequent checks or writes.
  const housekeeperCount = allRows.filter((r) => r.completedSessions > 0).length;
  // Capture total for subsequent checks or writes.
  const total = allRows.length;
  // Capture start for subsequent checks or writes.
  const start = (query.page - 1) * query.pageSize;
  // Capture rows for subsequent checks or writes.
  const rows = allRows.slice(start, start + query.pageSize);
  // Capture series for subsequent checks or writes.
  const series = hourBuckets.map((completedSessions, hour) => ({
    // Carry this field through the payload or query.
    hour,
    // Carry this field through the payload or query.
    completedSessions,
  // Execute: }));
  }));

  // Return the computed result to the caller.
  return {
    // Carry this field through the payload or query.
    period: { from: query.from, to: query.to },
    // Open nested structure for the next related fields.
    summary: {
      // Carry this field through the payload or query.
      housekeeperCount,
      // Carry this field through the payload or query.
      completedSessions: summaryCounters.completedSessions,
      // Carry this field through the payload or query.
      completedTasks: summaryCounters.completedTasks,
      // Carry this field through the payload or query.
      acceptedTasks: summaryCounters.acceptedTasks,
      // Carry this field through the payload or query.
      reworkEvents: summaryCounters.reworkEvents,
      // Carry this field through the payload or query.
      anomalousSessions: summaryCounters.anomalousSessions,
      // Carry this field through the payload or query.
      distinctRooms: summaryCounters.distinctRooms,
      // Carry this field through the payload or query.
      onTimePct: summaryCounters.onTimePct,
      // Carry this field through the payload or query.
      productivity,
      // Carry this field through the payload or query.
      totalValidSessionMinutes: summaryCounters.totalValidSessionMinutes,
      // Carry this field through the payload or query.
      totalExcludedSessionMinutes: summaryCounters.totalExcludedSessionMinutes,
      // Carry this field through the payload or query.
      byServiceType: [...byServiceType.entries()]
        // Continue the previous expression with this clause.
        .map(([key, count]) => ({ key, count }))
        // Continue the previous expression with this clause.
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    },
    // Carry this field through the payload or query.
    series,
    // Carry this field through the payload or query.
    rows,
    // Carry this field through the payload or query.
    page: query.page,
    // Carry this field through the payload or query.
    pageSize: query.pageSize,
    // Carry this field through the payload or query.
    total,
  };
}
