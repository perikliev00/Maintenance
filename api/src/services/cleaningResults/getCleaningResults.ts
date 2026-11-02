/**
 * Build the housekeeping cleaning-results report for a date range:
 * per-employee counters, period summary, and hourly completion series.
 */
import {
  InspectionResult,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../../db";
import { getOperations } from "../settings";
import type {
  CleaningResultsQuery,
  CleaningResultsResponse,
} from "./types";
import { assembleCleaningResults } from "./assembleCleaningResults";
import { normalizeAnomalyFlags } from "./metrics";
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
      prisma.cleaningSession.findMany({
        where: {
          status: SessionStatus.completed,
          finishedAt: { gte: fromStart, lt: toEnd },
          ...(query.sessionWhere ?? {}),
          ...(Object.keys(taskScope).length ? { task: taskScope } : {}),
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

  // Normalize Prisma JsonValue → string[] at the aggregator boundary.
  return assembleCleaningResults({
    query,
    anomalyThresholdMinutes,
    sessions: sessions.map((s) => ({
      finishedAt: s.finishedAt,
      startedAt: s.startedAt,
      anomalyFlags: normalizeAnomalyFlags(s.anomalyFlags),
      employee: s.employee,
    })),
    completedTasks: completedTasks.map((t) => ({
      locationId: t.locationId,
      serviceType: t.serviceType,
      dueAt: t.dueAt,
      completedAt: t.completedAt,
      assignedEmployee: t.assignedEmployee,
      sessions: t.sessions.map((s) => ({
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        anomalyFlags: normalizeAnomalyFlags(s.anomalyFlags),
        employeeId: s.employeeId,
      })),
      inspections: t.inspections,
    })),
    approvedInspections,
    rejectedInspections,
    approvedRows,
    rejectedRows,
  });
}
