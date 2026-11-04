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
} from "@prisma/client";
import { prisma } from "../../db";
import { OPEN_TICKET_STATUSES } from "../../constants";
import { computeReadiness } from "../readiness";
import { getOperations } from "../settings";
import {
  avgValidMinutesFromTaskMs,
  sessionDurationBuckets,
  sumValidSessionMs,
} from "../cleaningResults";
import type { AnalyticsScopeFilters } from "./types";
import { buildDailySeries, previousPeriod } from "./period";
import { buildMonthlyForecast, forecastWindowStart } from "./forecast";
import {
  MIN_PERCENTILE_SAMPLES,
  bucketCounts,
  compareMetric,
  percentile,
  round1,
} from "./stats";
import {
  formatLocationLabel,
  locationWithBuildingInclude,
} from "./locationLabel";
import {
  mergeTicketThresholdFactor,
  sortRiskRooms,
  type RiskRoomRow,
} from "./riskRooms";

/**
 * Aggregate housekeeping metrics for `period`, applying optional scope filters.
 * Anomalous sessions (flags or duration ≥ 2× overdue threshold) are excluded
 * from valid duration stats but still counted separately.
 */
export async function getHousekeepingSummary(
  period: { from: Date; to: Date; now: Date },
  riskTicketThreshold: number,
  scope: AnalyticsScopeFilters,
) {
  // Matching prior window for period-over-period deltas.
  const prev = previousPeriod(period);
  // Optional data-scope fragments applied to each entity query.
  const taskW = scope.taskWhere ?? {};
  const sessionW = scope.sessionWhere ?? {};
  const locW = scope.locationWhere ?? {};
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
  ] = await Promise.all([
    // Completed tasks in period: only the columns the aggregation reads.
    // Sessions, approvals and locations are NOT included per task: a nested
    // include becomes `taskId IN (<every task id>)`, which fails once a window
    // holds ~32k tasks (bind-variable limit) and hydrates unused rows.
    prisma.cleaningTask.findMany({
      where: completedTaskWhere,
      select: {
        id: true,
        locationId: true,
        dueAt: true,
        completedAt: true,
        priority: true,
        serviceType: true,
      },
    }),
    // Rejected inspections (rework events) in the period.
    prisma.inspection.findMany({
      where: {
        // Inspection timestamp in the current window.
        inspectedAt: { gte: period.from, lte: period.to },
        result: InspectionResult.rejected,
        // Scope via task relation when taskWhere is non-empty.
        ...(Object.keys(taskW).length ? { task: taskW } : {}),
      },
      include: {
        // Need room label for reject-by-location risk map.
        task: {
          include: {
            location: {
              include: locationWithBuildingInclude,
            },
          },
        },
      },
    }),
    // Approved inspection count for accepted-tasks KPI.
    prisma.inspection.count({
      where: {
        inspectedAt: { gte: period.from, lte: period.to },
        result: InspectionResult.approved,
        // Same task-scope pattern as rejected inspections.
        ...(Object.keys(taskW).length ? { task: taskW } : {}),
      },
    }),
    // Completed sessions for duration / anomaly stats.
    prisma.cleaningSession.findMany({
      where: {
        status: SessionStatus.completed,
        // Use finishedAt (not startedAt) for period membership.
        finishedAt: { gte: period.from, lte: period.to },
        ...sessionW,
      },
      select: { startedAt: true, finishedAt: true, anomalyFlags: true },
    }),
    // Prior-period completed task count.
    prisma.cleaningTask.count({
      where: {
        status: TaskStatus.completed,
        completedAt: { gte: prev.from, lte: prev.to },
        ...taskW,
      },
    }),
    // Prior-period rejected inspection count.
    prisma.inspection.count({
      where: {
        inspectedAt: { gte: prev.from, lte: prev.to },
        result: InspectionResult.rejected,
        ...(Object.keys(taskW).length ? { task: taskW } : {}),
      },
    }),
    // Prior-period approved inspection count.
    prisma.inspection.count({
      where: {
        inspectedAt: { gte: prev.from, lte: prev.to },
        result: InspectionResult.approved,
        ...(Object.keys(taskW).length ? { task: taskW } : {}),
      },
    }),
    // Completed sessions of the period's completed tasks (per-task valid time),
    // joined through the task relation rather than an id list.
    prisma.cleaningSession.findMany({
      where: { status: SessionStatus.completed, task: completedTaskWhere },
      select: {
        taskId: true,
        startedAt: true,
        finishedAt: true,
        anomalyFlags: true,
      },
    }),
    // Completed with no approved inspection counts as auto-accepted (skip inspection).
    prisma.cleaningTask.count({
      where: {
        AND: [
          completedTaskWhere,
          { inspections: { none: { result: InspectionResult.approved } } },
        ],
      },
    }),
  ]);

  // Accepted = inspector-approved + auto-accepted (skip-inspection) completes.
  const acceptedTasks = approvedInspections + autoAccepted;

  // Prior-period auto-accepted (completed with no approved inspection).
  const prevAutoAccepted = await prisma.cleaningTask.count({
    where: {
      status: TaskStatus.completed,
      completedAt: { gte: prev.from, lte: prev.to },
      inspections: { none: { result: InspectionResult.approved } },
      ...taskW,
    },
  });
  // Mirror acceptedTasks for the comparison KPI.
  const prevAccepted = prevApproved + prevAutoAccepted;

  // Prior-period on-time sample for comparison KPI.
  const prevTasksWithDue = await prisma.cleaningTask.findMany({
    where: {
      status: TaskStatus.completed,
      completedAt: { gte: prev.from, lte: prev.to },
      // Only tasks that had a due date can be scored on-time.
      dueAt: { not: null },
      ...taskW,
    },
    // Minimal columns for the on-time walk.
    select: { dueAt: true, completedAt: true },
  });
  // Accumulators for prior-period on-time rate.
  let prevWithDue = 0;
  let prevOnTime = 0;
  for (const task of prevTasksWithDue) {
    // Guard incomplete rows (should not happen given the where clause).
    if (!task.dueAt || !task.completedAt) continue;
    prevWithDue += 1;
    // Completed at or before dueAt counts as on-time.
    if (task.completedAt <= task.dueAt) prevOnTime += 1;
  }
  // Null when there is no prior on-time sample.
  const prevOnTimePct =
    prevWithDue === 0 ? null : round1((prevOnTime / prevWithDue) * 100);

  // Partition completed sessions into valid vs anomalous duration buckets.
  let anomalousSessions = 0;
  let totalValidSessionMs = 0;
  let totalExcludedSessionMs = 0;
  const validSessionMinutes: number[] = [];
  for (const s of completedSessions) {
    // Skip incomplete rows (should not happen for completed status).
    if (!s.finishedAt) continue;
    // Classify duration via shared cleaningResults helper (flags + threshold).
    const { anomalous, durationMs } = sessionDurationBuckets({
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      anomalyFlags: s.anomalyFlags,
      anomalyThresholdMinutes,
    });
    // Anomalous durations are counted separately and excluded from percentiles.
    if (anomalous) {
      anomalousSessions += 1;
      totalExcludedSessionMs += durationMs;
      continue;
    }
    // Valid session contributes to totals and percentile samples.
    totalValidSessionMs += durationMs;
    const mins = durationMs / 60000;
    // Drop negative / non-finite minutes (clock skew).
    if (mins >= 0 && Number.isFinite(mins)) validSessionMinutes.push(mins);
  }

  // Per-task on-time + valid session time aggregates.
  let withDue = 0;
  let onTime = 0;
  let tasksWithValidTime = 0;
  let totalValidMsForTasks = 0;
  const distinctRooms = new Set<string>();
  // Group the period's completed sessions by task for per-task valid time.
  const sessionsByTask = new Map<string, typeof taskSessions>();
  for (const s of taskSessions) {
    const list = sessionsByTask.get(s.taskId);
    if (list) list.push(s);
    else sessionsByTask.set(s.taskId, [s]);
  }
  for (const task of completedTasks) {
    // Unique rooms cleaned in the period (for distinctRooms KPI).
    distinctRooms.add(task.locationId);
    // On-time only among tasks that had a dueAt.
    if (task.dueAt && task.completedAt) {
      withDue += 1;
      // Same rule as prior period: completedAt <= dueAt.
      if (task.completedAt <= task.dueAt) onTime += 1;
    }
    // Sum valid (non-anomalous) session ms for avg minutes/task.
    const validMs = sumValidSessionMs(
      sessionsByTask.get(task.id) ?? [],
      anomalyThresholdMinutes,
    );
    // Only tasks with positive valid time enter the average denominator.
    if (validMs > 0) {
      tasksWithValidTime += 1;
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
  const totalExcludedSessionMinutes = round1(
    totalExcludedSessionMs / (1000 * 60),
  );

  // Active rooms for readiness snapshot (point-in-time, not period-scoped).
  const locations = await prisma.location.findMany({
    where: {
      // Ignore archived catalog entries.
      catalogStatus: CatalogStatus.active,
      // Readiness KPI is room-only (not common areas).
      kind: LocationKind.room,
      ...locW,
    },
    include: {
      // Existence probe: any open room-blocking ticket.
      maintenanceTickets: {
        where: {
          status: { in: [...OPEN_TICKET_STATUSES] },
          blocksRoom: true,
        },
        take: 1,
      },
    },
  });

  // Count rooms currently in "ready" readiness state.
  let readyRooms = 0;
  for (const loc of locations) {
    // Shared readiness rules (occupancy + cleaning + blocking tickets).
    const { readiness } = computeReadiness({
      kind: loc.kind,
      catalogStatus: loc.catalogStatus,
      occupancy: loc.occupancy,
      cleaningStatus: loc.cleaningStatus,
      serviceStatus: loc.serviceStatus,
      hasBlockingTicket: loc.maintenanceTickets.length > 0,
    });
    // Only the "ready" state increments the KPI.
    if (readiness === "ready") readyRooms += 1;
  }

  // Aggregate rejected inspections per location for risk heuristics.
  const rejectByLocation = new Map<string, { count: number; label: string }>();
  for (const insp of rejectedInspections) {
    const loc = insp.task.location;
    // Display label: building code + room number.
    const label = formatLocationLabel(loc);
    const cur = rejectByLocation.get(loc.id) ?? { count: 0, label };
    cur.count += 1;
    rejectByLocation.set(loc.id, cur);
  }

  // Accumulator for rooms that trip risk heuristics (rejects and/or tickets).
  const riskRooms: RiskRoomRow[] = [];

  // Risk heuristic: ≥2 rejected inspections in the period flags the room.
  for (const [locationId, info] of rejectByLocation) {
    // Below threshold — not a risk room from inspection rework alone.
    if (info.count >= 2) {
      riskRooms.push({
        locationId,
        label: info.label,
        factors: ["rejected_inspections_gte_2"],
        // Reuse ticketCount field as severity weight (reject count here).
        ticketCount: info.count,
      });
    }
  }

  // Ticket volume per location in the period for the second risk factor.
  const ticketsInPeriod = await prisma.maintenanceTicket.groupBy({
    by: ["locationId"],
    where: {
      // Opened-in-period (not resolved-in-period).
      openedAt: { gte: period.from, lte: period.to },
      ...ticketW,
    },
    _count: { _all: true },
  });
  // Load labels only for locations that meet the ticket threshold.
  const locMeta = await prisma.location.findMany({
    where: {
      AND: [{
      id: {
        // Keep only locations at/above the configured ticket risk threshold.
        in: ticketsInPeriod
          .filter((g) => g._count._all >= riskTicketThreshold)
          .map((g) => g.locationId),
      },
      }, locW],
    },
    // Building/floor for display labels.
    include: locationWithBuildingInclude,
  });
  for (const loc of locMeta) {
    const count =
      ticketsInPeriod.find((g) => g.locationId === loc.id)?._count._all ?? 0;
    mergeTicketThresholdFactor(
      riskRooms,
      loc.id,
      formatLocationLabel(loc),
      count,
      riskTicketThreshold,
    );
  }

  sortRiskRooms(riskRooms);

  // Session-duration percentiles from valid (non-anomalous) samples.
  const sorted = [...validSessionMinutes].sort((a, b) => a - b);
  // Median and 90th percentile (null when sample too small).
  const p50 = round1(percentile(sorted, 0.5));
  const p90 = round1(percentile(sorted, 0.9));

  // Naive forecast: trailing 28-day daily rate × remaining UTC days in month.
  const forecastFrom = forecastWindowStart(period.now);
  // Completes in the trailing window (scoped).
  const recentCompleted = await prisma.cleaningTask.count({
    where: {
      status: TaskStatus.completed,
      // Trailing window ends at period.now (not period.to).
      completedAt: { gte: forecastFrom, lte: period.now },
      ...taskW,
    },
  });
  // Mean completes per day over the trailing 28 days.
  const forecast = buildMonthlyForecast(
    period.now,
    recentCompleted,
    "cleaned tasks",
  );

  // Daily completed-task series for charts.
  const series = buildDailySeries(
    period.from,
    period.to,
    // Drop null completedAt (should not happen for completed status).
    completedTasks
      .map((t) => t.completedAt)
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
      riskRooms: riskRooms.length,
      avgMinutesPerTask,
      // Minutes from non-anomalous sessions only.
      totalValidSessionMinutes,
      // Minutes excluded as anomalous (for transparency).
      totalExcludedSessionMinutes,
      p50SessionMinutes: p50,
      p90SessionMinutes: p90,
      // UI disclaimer when percentile samples are too thin.
      insufficientDurationData: sorted.length < MIN_PERCENTILE_SAMPLES,
      durationSampleCount: sorted.length,
    },
    // Period-over-period deltas (null previous → null deltaPct).
    comparison: {
      cleanedTasks: compareMetric(completedTasks.length, prevCompleted),
      onTimePct: compareMetric(onTimePct, prevOnTimePct),
      auditFindings: compareMetric(rejectedInspections.length, prevRejected),
      acceptedTasks: compareMetric(acceptedTasks, prevAccepted),
      // Same underlying series as auditFindings.
      reworkEvents: compareMetric(rejectedInspections.length, prevRejected),
    },
    // Dense daily completes for the trend chart.
    series,
    // Frequency histograms for charts.
    breakdowns: {
      byPriority: bucketCounts(completedTasks.map((t) => t.priority)),
      byServiceType: bucketCounts(completedTasks.map((t) => t.serviceType)),
    },
    // Full risk-room rows (not just the count KPI).
    riskRooms,
    // End-of-month extrapolation from the trailing daily rate.
    forecast: { ...forecast, unit: "cleaned_tasks" as const },
  };
}
