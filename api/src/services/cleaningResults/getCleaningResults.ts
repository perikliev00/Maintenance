/**
 * Build the housekeeping cleaning-results report for a date range:
 * per-employee counters, period summary, and hourly completion series.
 */
import {
  InspectionResult,
  SessionStatus,
  TaskStatus,
// Execute: } from "@prisma/client";
} from "@prisma/client";
// Import ../../db for cleaningResults/getCleaningResults.ts.
import { prisma } from "../../db";
// Import ../settings for cleaningResults/getCleaningResults.ts.
import { getOperations } from "../settings";
import type {
  CleaningResultsQuery,
  CleaningResultsResponse,
// Execute: } from "./types";
} from "./types";
// Import ./assembleCleaningResults for cleaningResults/getCleaningResults.ts.
import { assembleCleaningResults } from "./assembleCleaningResults";
// Import ./metrics for cleaningResults/getCleaningResults.ts.
import { normalizeAnomalyFlags } from "./metrics";
// Import ./periodBounds for cleaningResults/getCleaningResults.ts.
import { dayEndExclusiveUtc, dayStartUtc } from "./periodBounds";

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
    // Execute: query.serviceTypes && query.serviceTypes.length > 0
    query.serviceTypes && query.serviceTypes.length > 0
      // Continue the previous expression with this clause.
      ? { serviceType: { in: query.serviceTypes } }
      // Continue the previous expression with this clause.
      : {};

  // Merge service-type with optional data-scope taskWhere.
  const taskScope = {
    // Spread remaining fields without dropping caller data.
    ...serviceTypeFilter,
    // Spread remaining fields without dropping caller data.
    ...(query.taskWhere ?? {}),
  };

  // Parallel load: completed sessions, completed tasks, inspection counts.
  const [sessions, completedTasks, approvedInspections, rejectedInspections] =
    await Promise.all([
      prisma.cleaningSession.findMany({
        // Restrict the query to the relevant rows only.
        where: {
          status: SessionStatus.completed,
          finishedAt: { gte: fromStart, lt: toEnd },
          // Spread remaining fields without dropping caller data.
          ...(query.sessionWhere ?? {}),
          // Spread remaining fields without dropping caller data.
          ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
        },
        // Eager-load relations needed by the API response shape.
        include: {
          // Open nested structure for the next related fields.
          employee: {
            // Project only the columns the caller needs.
            select: { id: true, fullName: true, employeeNumber: true },
          },
          // Open nested structure for the next related fields.
          task: {
            // Project only the columns the caller needs.
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
        // Restrict the query to the relevant rows only.
        where: {
          status: TaskStatus.completed,
          completedAt: { gte: fromStart, lt: toEnd },
          // Spread remaining fields without dropping caller data.
          ...taskScope,
        },
        // Eager-load relations needed by the API response shape.
        include: {
          // Open nested structure for the next related fields.
          assignedEmployee: {
            // Project only the columns the caller needs.
            select: { id: true, fullName: true, employeeNumber: true },
          },
          // Open nested structure for the next related fields.
          sessions: {
            // Restrict the query to the relevant rows only.
            where: { status: SessionStatus.completed },
            // Project only the columns the caller needs.
            select: {
              startedAt: true,
              finishedAt: true,
              anomalyFlags: true,
              employeeId: true,
            },
          },
          // Open nested structure for the next related fields.
          inspections: {
            // Restrict the query to the relevant rows only.
            where: { result: InspectionResult.approved },
            // Project only the columns the caller needs.
            select: { id: true },
            take: 1,
          },
        },
      }),
      prisma.inspection.count({
        // Restrict the query to the relevant rows only.
        where: {
          inspectedAt: { gte: fromStart, lt: toEnd },
          result: InspectionResult.approved,
          // Spread remaining fields without dropping caller data.
          ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
        },
      }),
      prisma.inspection.count({
        // Restrict the query to the relevant rows only.
        where: {
          inspectedAt: { gte: fromStart, lt: toEnd },
          result: InspectionResult.rejected,
          // Spread remaining fields without dropping caller data.
          ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
        },
      }),
    ]);

  // Begin list of values/items for this step.
  const [approvedRows, rejectedRows] = await Promise.all([
    prisma.inspection.findMany({
      // Restrict the query to the relevant rows only.
      where: {
        inspectedAt: { gte: fromStart, lt: toEnd },
        result: InspectionResult.approved,
        // Spread remaining fields without dropping caller data.
        ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
      },
      // Project only the columns the caller needs.
      select: {
        task: { select: { assignedEmployeeId: true } },
      },
    }),
    prisma.inspection.findMany({
      // Restrict the query to the relevant rows only.
      where: {
        inspectedAt: { gte: fromStart, lt: toEnd },
        result: InspectionResult.rejected,
        // Spread remaining fields without dropping caller data.
        ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
      },
      // Project only the columns the caller needs.
      select: {
        task: { select: { assignedEmployeeId: true } },
      },
    }),
  ]);

  // Normalize Prisma JsonValue → string[] at the aggregator boundary.
  return assembleCleaningResults({
    query,
    anomalyThresholdMinutes,
    // Open nested structure for the next related fields.
    sessions: sessions.map((s) => ({
      finishedAt: s.finishedAt,
      startedAt: s.startedAt,
      anomalyFlags: normalizeAnomalyFlags(s.anomalyFlags),
      employee: s.employee,
    // Execute: })),
    })),
    // Open nested structure for the next related fields.
    completedTasks: completedTasks.map((t) => ({
      locationId: t.locationId,
      serviceType: t.serviceType,
      dueAt: t.dueAt,
      completedAt: t.completedAt,
      assignedEmployee: t.assignedEmployee,
      // Open nested structure for the next related fields.
      sessions: t.sessions.map((s) => ({
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        anomalyFlags: normalizeAnomalyFlags(s.anomalyFlags),
        employeeId: s.employeeId,
      // Execute: })),
      })),
      inspections: t.inspections,
    // Execute: })),
    })),
    approvedInspections,
    rejectedInspections,
    approvedRows,
    rejectedRows,
  });
}
