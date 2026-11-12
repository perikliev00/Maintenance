/**
 * Build the housekeeping cleaning-results report for a date range:
 * per-employee counters, period summary, and hourly completion series.
 */
import {
  // Carry this field through the payload or query.
  InspectionResult,
  // Carry this field through the payload or query.
  SessionStatus,
  // Carry this field through the payload or query.
  TaskStatus,
// Execute: } from "@prisma/client";
} from "@prisma/client";
// Import ../../db for cleaningResults/getCleaningResults.ts.
import { prisma } from "../../db";
// Import ../settings for cleaningResults/getCleaningResults.ts.
import { getOperations } from "../settings";
// Type-only import from module used by cleaningResults/getCleaningResults.ts.
import type {
  // Carry this field through the payload or query.
  CleaningResultsQuery,
  // Carry this field through the payload or query.
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
  // Carry this field through the payload or query.
  query: CleaningResultsQuery,
// Begin block/object for the following statements.
): Promise<CleaningResultsResponse> {
  // Inclusive `[from, to]` as half-open UTC `[fromStart, toEnd)`.
  const fromStart = dayStartUtc(query.from);
  // Capture toEnd for subsequent checks or writes.
  const toEnd = dayEndExclusiveUtc(query.to);
  // Anomaly duration threshold = 2× configured overdue session minutes.
  const ops = await getOperations();
  // Capture anomalyThresholdMinutes for subsequent checks or writes.
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
    // Await side effect or helper before continuing.
    await Promise.all([
      // Begin block/object for the following statements.
      prisma.cleaningSession.findMany({
        // Restrict the query to the relevant rows only.
        where: {
          // Carry this field through the payload or query.
          status: SessionStatus.completed,
          // Carry this field through the payload or query.
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
              // Field value required by this payload or query.
              id: true,
              // Field value required by this payload or query.
              dueAt: true,
              // Field value required by this payload or query.
              locationId: true,
              // Field value required by this payload or query.
              serviceType: true,
              // Field value required by this payload or query.
              assignedEmployeeId: true,
            },
          },
        },
      }),
      // Begin block/object for the following statements.
      prisma.cleaningTask.findMany({
        // Restrict the query to the relevant rows only.
        where: {
          // Carry this field through the payload or query.
          status: TaskStatus.completed,
          // Carry this field through the payload or query.
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
              // Field value required by this payload or query.
              startedAt: true,
              // Field value required by this payload or query.
              finishedAt: true,
              // Field value required by this payload or query.
              anomalyFlags: true,
              // Field value required by this payload or query.
              employeeId: true,
            },
          },
          // Open nested structure for the next related fields.
          inspections: {
            // Restrict the query to the relevant rows only.
            where: { result: InspectionResult.approved },
            // Project only the columns the caller needs.
            select: { id: true },
            // Field value required by this payload or query.
            take: 1,
          },
        },
      }),
      // Begin block/object for the following statements.
      prisma.inspection.count({
        // Restrict the query to the relevant rows only.
        where: {
          // Carry this field through the payload or query.
          inspectedAt: { gte: fromStart, lt: toEnd },
          // Carry this field through the payload or query.
          result: InspectionResult.approved,
          // Spread remaining fields without dropping caller data.
          ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
        },
      }),
      // Begin block/object for the following statements.
      prisma.inspection.count({
        // Restrict the query to the relevant rows only.
        where: {
          // Carry this field through the payload or query.
          inspectedAt: { gte: fromStart, lt: toEnd },
          // Carry this field through the payload or query.
          result: InspectionResult.rejected,
          // Spread remaining fields without dropping caller data.
          ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
        },
      }),
    ]);

  // Begin list of values/items for this step.
  const [approvedRows, rejectedRows] = await Promise.all([
    // Begin block/object for the following statements.
    prisma.inspection.findMany({
      // Restrict the query to the relevant rows only.
      where: {
        // Carry this field through the payload or query.
        inspectedAt: { gte: fromStart, lt: toEnd },
        // Carry this field through the payload or query.
        result: InspectionResult.approved,
        // Spread remaining fields without dropping caller data.
        ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
      },
      // Project only the columns the caller needs.
      select: {
        // Field value required by this payload or query.
        task: { select: { assignedEmployeeId: true } },
      },
    }),
    // Begin block/object for the following statements.
    prisma.inspection.findMany({
      // Restrict the query to the relevant rows only.
      where: {
        // Carry this field through the payload or query.
        inspectedAt: { gte: fromStart, lt: toEnd },
        // Carry this field through the payload or query.
        result: InspectionResult.rejected,
        // Spread remaining fields without dropping caller data.
        ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
      },
      // Project only the columns the caller needs.
      select: {
        // Field value required by this payload or query.
        task: { select: { assignedEmployeeId: true } },
      },
    }),
  ]);

  // Normalize Prisma JsonValue → string[] at the aggregator boundary.
  return assembleCleaningResults({
    // Carry this field through the payload or query.
    query,
    // Carry this field through the payload or query.
    anomalyThresholdMinutes,
    // Open nested structure for the next related fields.
    sessions: sessions.map((s) => ({
      // Carry this field through the payload or query.
      finishedAt: s.finishedAt,
      // Carry this field through the payload or query.
      startedAt: s.startedAt,
      // Carry this field through the payload or query.
      anomalyFlags: normalizeAnomalyFlags(s.anomalyFlags),
      // Carry this field through the payload or query.
      employee: s.employee,
    // Execute: })),
    })),
    // Open nested structure for the next related fields.
    completedTasks: completedTasks.map((t) => ({
      // Carry this field through the payload or query.
      locationId: t.locationId,
      // Carry this field through the payload or query.
      serviceType: t.serviceType,
      // Carry this field through the payload or query.
      dueAt: t.dueAt,
      // Carry this field through the payload or query.
      completedAt: t.completedAt,
      // Carry this field through the payload or query.
      assignedEmployee: t.assignedEmployee,
      // Open nested structure for the next related fields.
      sessions: t.sessions.map((s) => ({
        // Carry this field through the payload or query.
        startedAt: s.startedAt,
        // Carry this field through the payload or query.
        finishedAt: s.finishedAt,
        // Carry this field through the payload or query.
        anomalyFlags: normalizeAnomalyFlags(s.anomalyFlags),
        // Carry this field through the payload or query.
        employeeId: s.employeeId,
      // Execute: })),
      })),
      // Carry this field through the payload or query.
      inspections: t.inspections,
    // Execute: })),
    })),
    // Carry this field through the payload or query.
    approvedInspections,
    // Carry this field through the payload or query.
    rejectedInspections,
    // Carry this field through the payload or query.
    approvedRows,
    // Carry this field through the payload or query.
    rejectedRows,
  });
}
