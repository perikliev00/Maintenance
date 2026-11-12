/**
 * Housekeeping analytics: cleaning KPIs, inspection rework, session duration
 * percentiles, room readiness, risk rooms, and a simple end-of-month forecast.
 */
import {
  CatalogStatus,
  InspectionResult,
  LocationKind,
  Prisma,
  SessionStatus,
  TaskStatus,
// Support the surrounding control flow.
} from "@prisma/client";
// Shared Prisma client singleton.
import { prisma } from "../../db";
// Runtime import from ../../constants.
import { OPEN_TICKET_STATUSES } from "../../constants";
// Runtime import from ../readiness.
import { computeReadiness } from "../readiness";
// Runtime import from ../settings.
import { getOperations } from "../settings";
// Module import required below.
import {
  avgValidMinutesFromTaskMs,
  sessionDurationBuckets,
  sumValidSessionMs,
// Support the surrounding control flow.
} from "../cleaningResults";
// Type-only import from ./types (erased at runtime).
import type { AnalyticsScopeFilters } from "./types";
// Runtime import from ./period.
import { buildDailySeries, previousPeriod } from "./period";
// Runtime import from ./forecast.
import { buildMonthlyForecast, forecastWindowStart } from "./forecast";
// Module import required below.
import {
  MIN_PERCENTILE_SAMPLES,
  bucketCounts,
  compareMetric,
  percentile,
  round1,
// Support the surrounding control flow.
} from "./stats";
// Module import required below.
import {
  formatLocationLabel,
  locationWithBuildingInclude,
// Support the surrounding control flow.
} from "./locationLabel";
// Module import required below.
import {
  mergeTicketThresholdFactor,
  sortRiskRooms,
  // Type alias RiskRoomRow.
  type RiskRoomRow,
// Support the surrounding control flow.
} from "./riskRooms";

/**
 * Aggregate housekeeping metrics for `period`, applying optional scope filters.
 * Anomalous sessions (flags or duration ≥ 2× overdue threshold) are excluded
 * from valid duration stats but still counted separately.
 */
export async function getHousekeepingSummary(
  // Param period required by this function.
  period: { from: Date; to: Date; now: Date },
  // Param riskTicketThreshold required by this function.
  riskTicketThreshold: number,
  // Param scope required by this function.
  scope: AnalyticsScopeFilters,
) {
  // Matching prior window for period-over-period deltas.
  const prev = previousPeriod(period);
  // Optional data-scope fragments applied to each entity query.
  const taskW = scope.taskWhere ?? {};
  // Local sessionW used below.
  const sessionW = scope.sessionWhere ?? {};
  // Local locW used below.
  const locW = scope.locationWhere ?? {};
  // Local ticketW used below.
  const ticketW = scope.ticketWhere ?? {};
  // Operations settings supply the overdue-session baseline for anomaly detection.
  const ops = await getOperations();
  // Sessions longer than 2× the overdue setting are treated as anomalous outliers.
  const anomalyThresholdMinutes = ops.overdueSessionMinutes * 2;

  // Tasks whose completedAt falls inside the period (scoped).
  const completedTaskWhere: Prisma.CleaningTaskWhereInput = {
    // Only finished tasks (completedAt set).
    status: TaskStatus.completed,
    // Inclusive period bounds on completion time.
    completedAt: { gte: period.from, lte: period.to },
    // Optional sector / assignee data-scope.
    ...taskW,
  };

  // Fan-out current-period rows and prior-period counts in parallel.
  const [
    completedTasks,
    rejectedInspections,
    approvedInspections,
    completedSessions,
    prevCompleted,
    prevRejected,
    prevApproved,
    taskSessions,
    autoAccepted,
  // Run independent async work in parallel.
  ] = await Promise.all([
    // Completed tasks in period: only the columns the aggregation reads.
    // Sessions, approvals and locations are NOT included per task: a nested
    // include becomes `taskId IN (<every task id>)`, which fails once a window
    // holds ~32k tasks (bind-variable limit) and hydrates unused rows.
    prisma.cleaningTask.findMany({
      // Filter matching rows.
      where: completedTaskWhere,
      // Select only needed columns.
      select: {
        // Field id on this type/payload.
        id: true,
        // Field locationId on this type/payload.
        locationId: true,
        // Time field dueAt.
        dueAt: true,
        // Time field completedAt.
        completedAt: true,
        // Field priority on this type/payload.
        priority: true,
        // Field serviceType on this type/payload.
        serviceType: true,
      },
    }),
    // Rejected inspections (rework events) in the period.
    prisma.inspection.findMany({
      // Filter matching rows.
      where: {
        // Inspection timestamp in the current window.
        inspectedAt: { gte: period.from, lte: period.to },
        // Field result on this type/payload.
        result: InspectionResult.rejected,
        // Scope via task relation when taskWhere is non-empty.
        ...(Object.keys(taskW).length ? { task: taskW } : {}),
      },
      // Include relations for labels/checks.
      include: {
        // Need room label for reject-by-location risk map.
        task: {
          // Include relations for labels/checks.
          include: {
            // Field location on this type/payload.
            location: {
              // Include relations for labels/checks.
              include: locationWithBuildingInclude,
            },
          },
        },
      },
    }),
    // Approved inspection count for accepted-tasks KPI.
    prisma.inspection.count({
      // Filter matching rows.
      where: {
        // Time field inspectedAt.
        inspectedAt: { gte: period.from, lte: period.to },
        // Field result on this type/payload.
        result: InspectionResult.approved,
        // Same task-scope pattern as rejected inspections.
        ...(Object.keys(taskW).length ? { task: taskW } : {}),
      },
    }),
    // Completed sessions for duration / anomaly stats.
    prisma.cleaningSession.findMany({
      // Filter matching rows.
      where: {
        // Field status on this type/payload.
        status: SessionStatus.completed,
        // Use finishedAt (not startedAt) for period membership.
        finishedAt: { gte: period.from, lte: period.to },
        // Spread additional fields/filters.
        ...sessionW,
      },
      // Select only needed columns.
      select: { startedAt: true, finishedAt: true, anomalyFlags: true },
    }),
    // Prior-period completed task count.
    prisma.cleaningTask.count({
      // Filter matching rows.
      where: {
        // Field status on this type/payload.
        status: TaskStatus.completed,
        // Time field completedAt.
        completedAt: { gte: prev.from, lte: prev.to },
        // Spread additional fields/filters.
        ...taskW,
      },
    }),
    // Prior-period rejected inspection count.
    prisma.inspection.count({
      // Filter matching rows.
      where: {
        // Time field inspectedAt.
        inspectedAt: { gte: prev.from, lte: prev.to },
        // Field result on this type/payload.
        result: InspectionResult.rejected,
        // Spread additional fields/filters.
        ...(Object.keys(taskW).length ? { task: taskW } : {}),
      },
    }),
    // Prior-period approved inspection count.
    prisma.inspection.count({
      // Filter matching rows.
      where: {
        // Time field inspectedAt.
        inspectedAt: { gte: prev.from, lte: prev.to },
        // Field result on this type/payload.
        result: InspectionResult.approved,
        // Spread additional fields/filters.
        ...(Object.keys(taskW).length ? { task: taskW } : {}),
      },
    }),
    // Completed sessions of the period's completed tasks (per-task valid time),
    // joined through the task relation rather than an id list.
    prisma.cleaningSession.findMany({
      // Filter matching rows.
      where: { status: SessionStatus.completed, task: completedTaskWhere },
      // Select only needed columns.
      select: {
        // Field taskId on this type/payload.
        taskId: true,
        // Time field startedAt.
        startedAt: true,
        // Time field finishedAt.
        finishedAt: true,
        // Field anomalyFlags on this type/payload.
        anomalyFlags: true,
      },
    }),
    // Completed with no approved inspection counts as auto-accepted (skip inspection).
    prisma.cleaningTask.count({
      // Filter matching rows.
      where: {
        // Field AND on this type/payload.
        AND: [
          completedTaskWhere,
          // Support the surrounding control flow.
          { inspections: { none: { result: InspectionResult.approved } } },
        ],
      },
    }),
  ]);

  // Accepted = inspector-approved + auto-accepted (skip-inspection) completes.
  const acceptedTasks = approvedInspections + autoAccepted;

  // Prior-period auto-accepted (completed with no approved inspection).
  const prevAutoAccepted = await prisma.cleaningTask.count({
    // Filter matching rows.
    where: {
      // Field status on this type/payload.
      status: TaskStatus.completed,
      // Time field completedAt.
      completedAt: { gte: prev.from, lte: prev.to },
      // Field inspections on this type/payload.
      inspections: { none: { result: InspectionResult.approved } },
      // Spread additional fields/filters.
      ...taskW,
    },
  });
  // Mirror acceptedTasks for the comparison KPI.
  const prevAccepted = prevApproved + prevAutoAccepted;

  // Prior-period on-time sample for comparison KPI.
  const prevTasksWithDue = await prisma.cleaningTask.findMany({
    // Filter matching rows.
    where: {
      // Field status on this type/payload.
      status: TaskStatus.completed,
      // Time field completedAt.
      completedAt: { gte: prev.from, lte: prev.to },
      // Only tasks that had a due date can be scored on-time.
      dueAt: { not: null },
      // Spread additional fields/filters.
      ...taskW,
    },
    // Minimal columns for the on-time walk.
    select: { dueAt: true, completedAt: true },
  });
  // Accumulators for prior-period on-time rate.
  let prevWithDue = 0;
  // Counter prevOnTime starts at 0.
  let prevOnTime = 0;
  // Iterate items for aggregation or writes.
  for (const task of prevTasksWithDue) {
    // Guard incomplete rows (should not happen given the where clause).
    if (!task.dueAt || !task.completedAt) continue;
    // Assign prevWithDue +.
    prevWithDue += 1;
    // Completed at or before dueAt counts as on-time.
    if (task.completedAt <= task.dueAt) prevOnTime += 1;
  }
  // Null when there is no prior on-time sample.
  const prevOnTimePct =
    // Assign prevWithDue.
    prevWithDue === 0 ? null : round1((prevOnTime / prevWithDue) * 100);

  // Partition completed sessions into valid vs anomalous duration buckets.
  let anomalousSessions = 0;
  // Counter totalValidSessionMs starts at 0.
  let totalValidSessionMs = 0;
  // Counter totalExcludedSessionMs starts at 0.
  let totalExcludedSessionMs = 0;
  // Accumulator list validSessionMinutes.
  const validSessionMinutes: number[] = [];
  // Iterate items for aggregation or writes.
  for (const s of completedSessions) {
    // Skip incomplete rows (should not happen for completed status).
    if (!s.finishedAt) continue;
    // Classify duration via shared cleaningResults helper (flags + threshold).
    const { anomalous, durationMs } = sessionDurationBuckets({
      // Set startedAt.
      startedAt: s.startedAt,
      // Set finishedAt.
      finishedAt: s.finishedAt,
      // Set anomalyFlags.
      anomalyFlags: s.anomalyFlags,
      anomalyThresholdMinutes,
    });
    // Anomalous durations are counted separately and excluded from percentiles.
    if (anomalous) {
      // Assign anomalousSessions +.
      anomalousSessions += 1;
      // Assign totalExcludedSessionMs +.
      totalExcludedSessionMs += durationMs;
      // Continue with next iteration.
      continue;
    }
    // Valid session contributes to totals and percentile samples.
    totalValidSessionMs += durationMs;
    // Derived metric mins.
    const mins = durationMs / 60000;
    // Drop negative / non-finite minutes (clock skew).
    if (mins >= 0 && Number.isFinite(mins)) validSessionMinutes.push(mins);
  }

  // Per-task on-time + valid session time aggregates.
  let withDue = 0;
  // Counter onTime starts at 0.
  let onTime = 0;
  // Counter tasksWithValidTime starts at 0.
  let tasksWithValidTime = 0;
  // Counter totalValidMsForTasks starts at 0.
  let totalValidMsForTasks = 0;
  // Set distinctRooms for dedupe/membership.
  const distinctRooms = new Set<string>();
  // Group the period's completed sessions by task for per-task valid time.
  const sessionsByTask = new Map<string, typeof taskSessions>();
  // Iterate items for aggregation or writes.
  for (const s of taskSessions) {
    // Local list used below.
    const list = sessionsByTask.get(s.taskId);
    // Conditional path for this guard.
    if (list) list.push(s);
    // Support the surrounding control flow.
    else sessionsByTask.set(s.taskId, [s]);
  }
  // Iterate items for aggregation or writes.
  for (const task of completedTasks) {
    // Unique rooms cleaned in the period (for distinctRooms KPI).
    distinctRooms.add(task.locationId);
    // On-time only among tasks that had a dueAt.
    if (task.dueAt && task.completedAt) {
      // Assign withDue +.
      withDue += 1;
      // Same rule as prior period: completedAt <= dueAt.
      if (task.completedAt <= task.dueAt) onTime += 1;
    }
    // Sum valid (non-anomalous) session ms for avg minutes/task.
    const validMs = sumValidSessionMs(
      // Support the surrounding control flow.
      sessionsByTask.get(task.id) ?? [],
      anomalyThresholdMinutes,
    );
    // Only tasks with positive valid time enter the average denominator.
    if (validMs > 0) {
      // Assign tasksWithValidTime +.
      tasksWithValidTime += 1;
      // Assign totalValidMsForTasks +.
      totalValidMsForTasks += validMs;
    }
  }

  // Null when no dueAt sample; else percent on-time rounded to 1 decimal.
  const onTimePct = withDue === 0 ? null : round1((onTime / withDue) * 100);
  // Average minutes per task from aggregated valid session ms.
  const avgMinutesPerTask = avgValidMinutesFromTaskMs(
    totalValidMsForTasks,
    tasksWithValidTime,
  );
  // Convert ms totals to display minutes.
  const totalValidSessionMinutes = round1(totalValidSessionMs / (1000 * 60));
  // Local totalExcludedSessionMinutes used below.
  const totalExcludedSessionMinutes = round1(
    // Support the surrounding control flow.
    totalExcludedSessionMs / (1000 * 60),
  );

  // Active rooms for readiness snapshot (point-in-time, not period-scoped).
  const locations = await prisma.location.findMany({
    // Filter matching rows.
    where: {
      // Ignore archived catalog entries.
      catalogStatus: CatalogStatus.active,
      // Readiness KPI is room-only (not common areas).
      kind: LocationKind.room,
      // Spread additional fields/filters.
      ...locW,
    },
    // Include relations for labels/checks.
    include: {
      // Existence probe: any open room-blocking ticket.
      maintenanceTickets: {
        // Filter matching rows.
        where: {
          // Field status on this type/payload.
          status: { in: [...OPEN_TICKET_STATUSES] },
          // Field blocksRoom on this type/payload.
          blocksRoom: true,
        },
        // Page size limit.
        take: 1,
      },
    },
  });

  // Count rooms currently in "ready" readiness state.
  let readyRooms = 0;
  // Iterate items for aggregation or writes.
  for (const loc of locations) {
    // Shared readiness rules (occupancy + cleaning + blocking tickets).
    const { readiness } = computeReadiness({
      // Set kind.
      kind: loc.kind,
      // Set catalogStatus.
      catalogStatus: loc.catalogStatus,
      // Set occupancy.
      occupancy: loc.occupancy,
      // Set cleaningStatus.
      cleaningStatus: loc.cleaningStatus,
      // Set serviceStatus.
      serviceStatus: loc.serviceStatus,
      // Set hasBlockingTicket.
      hasBlockingTicket: loc.maintenanceTickets.length > 0,
    });
    // Only the "ready" state increments the KPI.
    if (readiness === "ready") readyRooms += 1;
  }

  // Aggregate rejected inspections per location for risk heuristics.
  const rejectByLocation = new Map<string, { count: number; label: string }>();
  // Iterate items for aggregation or writes.
  for (const insp of rejectedInspections) {
    // Local loc used below.
    const loc = insp.task.location;
    // Display label: building code + room number.
    const label = formatLocationLabel(loc);
    // Local cur used below.
    const cur = rejectByLocation.get(loc.id) ?? { count: 0, label };
    // Assign cur.count +.
    cur.count += 1;
    // Support the surrounding control flow.
    rejectByLocation.set(loc.id, cur);
  }

  // Accumulator for rooms that trip risk heuristics (rejects and/or tickets).
  const riskRooms: RiskRoomRow[] = [];

  // Risk heuristic: ≥2 rejected inspections in the period flags the room.
  for (const [locationId, info] of rejectByLocation) {
    // Below threshold — not a risk room from inspection rework alone.
    if (info.count >= 2) {
      // Support the surrounding control flow.
      riskRooms.push({
        locationId,
        // Set label.
        label: info.label,
        // Set factors.
        factors: ["rejected_inspections_gte_2"],
        // Reuse ticketCount field as severity weight (reject count here).
        ticketCount: info.count,
      });
    }
  }

  // Ticket volume per location in the period for the second risk factor.
  const ticketsInPeriod = await prisma.maintenanceTicket.groupBy({
    // Set by.
    by: ["locationId"],
    // Filter matching rows.
    where: {
      // Opened-in-period (not resolved-in-period).
      openedAt: { gte: period.from, lte: period.to },
      // Spread additional fields/filters.
      ...ticketW,
    },
    // Set _count.
    _count: { _all: true },
  });
  // Load labels only for locations that meet the ticket threshold.
  const locMeta = await prisma.location.findMany({
    // Filter matching rows.
    where: {
      // Field AND on this type/payload.
      AND: [{
      // Field id on this type/payload.
      id: {
        // Keep only locations at/above the configured ticket risk threshold.
        in: ticketsInPeriod
          // Filter with predicate.
          .filter((g) => g._count._all >= riskTicketThreshold)
          // Map elements to output shape.
          .map((g) => g.locationId),
      },
      // Support the surrounding control flow.
      }, locW],
    },
    // Building/floor for display labels.
    include: locationWithBuildingInclude,
  });
  // Iterate items for aggregation or writes.
  for (const loc of locMeta) {
    // Local count used below.
    const count =
      // Support the surrounding control flow.
      ticketsInPeriod.find((g) => g.locationId === loc.id)?._count._all ?? 0;
    // Invoke mergeTicketThresholdFactor.
    mergeTicketThresholdFactor(
      riskRooms,
      // Support the surrounding control flow.
      loc.id,
      // Invoke formatLocationLabel.
      formatLocationLabel(loc),
      count,
      riskTicketThreshold,
    );
  }

  // Invoke sortRiskRooms.
  sortRiskRooms(riskRooms);

  // Session-duration percentiles from valid (non-anomalous) samples.
  const sorted = [...validSessionMinutes].sort((a, b) => a - b);
  // Median and 90th percentile (null when sample too small).
  const p50 = round1(percentile(sorted, 0.5));
  // Local p90 used below.
  const p90 = round1(percentile(sorted, 0.9));

  // Naive forecast: trailing 28-day daily rate × remaining UTC days in month.
  const forecastFrom = forecastWindowStart(period.now);
  // Completes in the trailing window (scoped).
  const recentCompleted = await prisma.cleaningTask.count({
    // Filter matching rows.
    where: {
      // Field status on this type/payload.
      status: TaskStatus.completed,
      // Trailing window ends at period.now (not period.to).
      completedAt: { gte: forecastFrom, lte: period.now },
      // Spread additional fields/filters.
      ...taskW,
    },
  });
  // Mean completes per day over the trailing 28 days.
  const forecast = buildMonthlyForecast(
    // Support the surrounding control flow.
    period.now,
    recentCompleted,
    "cleaned tasks",
  );

  // Daily completed-task series for charts.
  const series = buildDailySeries(
    // Support the surrounding control flow.
    period.from,
    // Support the surrounding control flow.
    period.to,
    // Drop null completedAt (should not happen for completed status).
    completedTasks
      // Map elements to output shape.
      .map((t) => t.completedAt)
      // Filter with predicate.
      .filter((d): d is Date => d != null),
  );

  // Assemble the housekeeping analytics payload for the API.
  return {
    // Domain discriminator for the analytics API.
    domain: "housekeeping" as const,
    // ISO bounds for the reporting window.
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    // Headline KPIs for the housekeeping dashboard cards.
    kpis: {
      // Completes in the current period.
      cleanedTasks: completedTasks.length,
      // Session rows finished in the period (may exceed cleanedTasks).
      completedSessions: completedSessions.length,
      acceptedTasks,
      // Rejected inspections double as rework + audit findings.
      reworkEvents: rejectedInspections.length,
      // Sessions excluded from duration percentiles.
      anomalousSessions,
      // Unique location ids among completed tasks.
      distinctRooms: distinctRooms.size,
      // Point-in-time ready rooms (not period-scoped).
      readyRooms,
      onTimePct,
      // Denominator for onTimePct (tasks with dueAt).
      onTimeSampleCount: withDue,
      // Alias of reworkEvents for the audit findings card.
      auditFindings: rejectedInspections.length,
      // Field riskRooms on this type/payload.
      riskRooms: riskRooms.length,
      avgMinutesPerTask,
      // Minutes from non-anomalous sessions only.
      totalValidSessionMinutes,
      // Minutes excluded as anomalous (for transparency).
      totalExcludedSessionMinutes,
      // Field p50SessionMinutes on this type/payload.
      p50SessionMinutes: p50,
      // Field p90SessionMinutes on this type/payload.
      p90SessionMinutes: p90,
      // UI disclaimer when percentile samples are too thin.
      insufficientDurationData: sorted.length < MIN_PERCENTILE_SAMPLES,
      // Field durationSampleCount on this type/payload.
      durationSampleCount: sorted.length,
    },
    // Period-over-period deltas (null previous → null deltaPct).
    comparison: {
      // Field cleanedTasks on this type/payload.
      cleanedTasks: compareMetric(completedTasks.length, prevCompleted),
      // Field onTimePct on this type/payload.
      onTimePct: compareMetric(onTimePct, prevOnTimePct),
      // Field auditFindings on this type/payload.
      auditFindings: compareMetric(rejectedInspections.length, prevRejected),
      // Field acceptedTasks on this type/payload.
      acceptedTasks: compareMetric(acceptedTasks, prevAccepted),
      // Same underlying series as auditFindings.
      reworkEvents: compareMetric(rejectedInspections.length, prevRejected),
    },
    // Dense daily completes for the trend chart.
    series,
    // Frequency histograms for charts.
    breakdowns: {
      // Field byPriority on this type/payload.
      byPriority: bucketCounts(completedTasks.map((t) => t.priority)),
      // Field byServiceType on this type/payload.
      byServiceType: bucketCounts(completedTasks.map((t) => t.serviceType)),
    },
    // Full risk-room rows (not just the count KPI).
    riskRooms,
    // End-of-month extrapolation from the trailing daily rate.
    forecast: { ...forecast, unit: "cleaned_tasks" as const },
  };
}
