import {
  CatalogStatus,
  InspectionResult,
  LocationKind,
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
import {
  DAY_MS,
  buildDailySeries,
  daysRemainingInMonth,
  previousPeriod,
  startOfDay,
} from "./period";
import {
  MIN_PERCENTILE_SAMPLES,
  bucketCounts,
  compareMetric,
  percentile,
  round1,
} from "./stats";

export async function getHousekeepingSummary(
  period: { from: Date; to: Date; now: Date },
  riskTicketThreshold: number,
  scope: AnalyticsScopeFilters,
) {
  const prev = previousPeriod(period);
  const taskW = scope.taskWhere ?? {};
  const sessionW = scope.sessionWhere ?? {};
  const locW = scope.locationWhere ?? {};
  const ticketW = scope.ticketWhere ?? {};
  const ops = await getOperations();
  const anomalyThresholdMinutes = ops.overdueSessionMinutes * 2;

  const [
    completedTasks,
    rejectedInspections,
    approvedInspections,
    completedSessions,
    prevCompleted,
    prevRejected,
    prevApproved,
  ] = await Promise.all([
    prisma.cleaningTask.findMany({
      where: {
        status: TaskStatus.completed,
        completedAt: { gte: period.from, lte: period.to },
        ...taskW,
      },
      include: {
        sessions: {
          where: { status: SessionStatus.completed },
          orderBy: { finishedAt: "desc" },
        },
        inspections: {
          where: { result: InspectionResult.approved },
          select: { id: true },
          take: 1,
        },
        location: {
          include: { floor: { include: { building: true } } },
        },
      },
    }),
    prisma.inspection.findMany({
      where: {
        inspectedAt: { gte: period.from, lte: period.to },
        result: InspectionResult.rejected,
        ...(Object.keys(taskW).length ? { task: taskW } : {}),
      },
      include: {
        task: {
          include: {
            location: {
              include: { floor: { include: { building: true } } },
            },
          },
        },
      },
    }),
    prisma.inspection.count({
      where: {
        inspectedAt: { gte: period.from, lte: period.to },
        result: InspectionResult.approved,
        ...(Object.keys(taskW).length ? { task: taskW } : {}),
      },
    }),
    prisma.cleaningSession.findMany({
      where: {
        status: SessionStatus.completed,
        finishedAt: { gte: period.from, lte: period.to },
        ...sessionW,
      },
    }),
    prisma.cleaningTask.count({
      where: {
        status: TaskStatus.completed,
        completedAt: { gte: prev.from, lte: prev.to },
        ...taskW,
      },
    }),
    prisma.inspection.count({
      where: {
        inspectedAt: { gte: prev.from, lte: prev.to },
        result: InspectionResult.rejected,
        ...(Object.keys(taskW).length ? { task: taskW } : {}),
      },
    }),
    prisma.inspection.count({
      where: {
        inspectedAt: { gte: prev.from, lte: prev.to },
        result: InspectionResult.approved,
        ...(Object.keys(taskW).length ? { task: taskW } : {}),
      },
    }),
  ]);

  const autoAccepted = completedTasks.filter((t) => t.inspections.length === 0)
    .length;
  const acceptedTasks = approvedInspections + autoAccepted;

  const prevAutoAccepted = await prisma.cleaningTask.count({
    where: {
      status: TaskStatus.completed,
      completedAt: { gte: prev.from, lte: prev.to },
      inspections: { none: { result: InspectionResult.approved } },
      ...taskW,
    },
  });
  const prevAccepted = prevApproved + prevAutoAccepted;

  const prevTasksWithDue = await prisma.cleaningTask.findMany({
    where: {
      status: TaskStatus.completed,
      completedAt: { gte: prev.from, lte: prev.to },
      dueAt: { not: null },
      ...taskW,
    },
    select: { dueAt: true, completedAt: true },
  });
  let prevWithDue = 0;
  let prevOnTime = 0;
  for (const task of prevTasksWithDue) {
    if (!task.dueAt || !task.completedAt) continue;
    prevWithDue += 1;
    if (task.completedAt <= task.dueAt) prevOnTime += 1;
  }
  const prevOnTimePct =
    prevWithDue === 0 ? null : round1((prevOnTime / prevWithDue) * 100);

  let anomalousSessions = 0;
  let totalValidSessionMs = 0;
  let totalExcludedSessionMs = 0;
  const validSessionMinutes: number[] = [];
  for (const s of completedSessions) {
    if (!s.finishedAt) continue;
    const { anomalous, durationMs } = sessionDurationBuckets({
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      anomalyFlags: s.anomalyFlags,
      anomalyThresholdMinutes,
    });
    if (anomalous) {
      anomalousSessions += 1;
      totalExcludedSessionMs += durationMs;
      continue;
    }
    totalValidSessionMs += durationMs;
    const mins = durationMs / 60000;
    if (mins >= 0 && Number.isFinite(mins)) validSessionMinutes.push(mins);
  }

  let withDue = 0;
  let onTime = 0;
  let tasksWithValidTime = 0;
  let totalValidMsForTasks = 0;
  const distinctRooms = new Set<string>();
  for (const task of completedTasks) {
    distinctRooms.add(task.locationId);
    if (task.dueAt && task.completedAt) {
      withDue += 1;
      if (task.completedAt <= task.dueAt) onTime += 1;
    }
    const validMs = sumValidSessionMs(task.sessions, anomalyThresholdMinutes);
    if (validMs > 0) {
      tasksWithValidTime += 1;
      totalValidMsForTasks += validMs;
    }
  }

  const onTimePct = withDue === 0 ? null : round1((onTime / withDue) * 100);
  const avgMinutesPerTask = avgValidMinutesFromTaskMs(
    totalValidMsForTasks,
    tasksWithValidTime,
  );
  const totalValidSessionMinutes = round1(totalValidSessionMs / (1000 * 60));
  const totalExcludedSessionMinutes = round1(
    totalExcludedSessionMs / (1000 * 60),
  );

  const locations = await prisma.location.findMany({
    where: {
      catalogStatus: CatalogStatus.active,
      kind: LocationKind.room,
      ...locW,
    },
    include: {
      maintenanceTickets: {
        where: {
          status: { in: [...OPEN_TICKET_STATUSES] },
          blocksRoom: true,
        },
        take: 1,
      },
    },
  });

  let readyRooms = 0;
  for (const loc of locations) {
    const { readiness } = computeReadiness({
      kind: loc.kind,
      catalogStatus: loc.catalogStatus,
      occupancy: loc.occupancy,
      cleaningStatus: loc.cleaningStatus,
      serviceStatus: loc.serviceStatus,
      hasBlockingTicket: loc.maintenanceTickets.length > 0,
    });
    if (readiness === "ready") readyRooms += 1;
  }

  const rejectByLocation = new Map<string, { count: number; label: string }>();
  for (const insp of rejectedInspections) {
    const loc = insp.task.location;
    const label = `${loc.floor.building.code} ${loc.number}`;
    const cur = rejectByLocation.get(loc.id) ?? { count: 0, label };
    cur.count += 1;
    rejectByLocation.set(loc.id, cur);
  }

  const riskRooms: Array<{
    locationId: string;
    label: string;
    factors: string[];
    ticketCount: number;
  }> = [];

  for (const [locationId, info] of rejectByLocation) {
    if (info.count >= 2) {
      riskRooms.push({
        locationId,
        label: info.label,
        factors: ["rejected_inspections_gte_2"],
        ticketCount: info.count,
      });
    }
  }

  const ticketsInPeriod = await prisma.maintenanceTicket.groupBy({
    by: ["locationId"],
    where: {
      openedAt: { gte: period.from, lte: period.to },
      ...ticketW,
    },
    _count: { _all: true },
  });
  const locMeta = await prisma.location.findMany({
    where: {
      id: {
        in: ticketsInPeriod
          .filter((g) => g._count._all >= riskTicketThreshold)
          .map((g) => g.locationId),
      },
      ...locW,
    },
    include: { floor: { include: { building: true } } },
  });
  for (const loc of locMeta) {
    const count =
      ticketsInPeriod.find((g) => g.locationId === loc.id)?._count._all ?? 0;
    const label = `${loc.floor.building.code} ${loc.number}`;
    const existing = riskRooms.find((r) => r.locationId === loc.id);
    if (existing) {
      existing.factors.push(`tickets_gte_${riskTicketThreshold}`);
      existing.ticketCount = Math.max(existing.ticketCount, count);
    } else {
      riskRooms.push({
        locationId: loc.id,
        label,
        factors: [`tickets_gte_${riskTicketThreshold}`],
        ticketCount: count,
      });
    }
  }

  riskRooms.sort(
    (a, b) => b.ticketCount - a.ticketCount || a.label.localeCompare(b.label),
  );

  const sorted = [...validSessionMinutes].sort((a, b) => a - b);
  const p50 = round1(percentile(sorted, 0.5));
  const p90 = round1(percentile(sorted, 0.9));

  const forecastFrom = startOfDay(new Date(period.now.getTime() - 28 * DAY_MS));
  const recentCompleted = await prisma.cleaningTask.count({
    where: {
      status: TaskStatus.completed,
      completedAt: { gte: forecastFrom, lte: period.now },
      ...taskW,
    },
  });
  const dailyRate = recentCompleted / 28;
  const remaining = daysRemainingInMonth(period.now);
  const forecastValue = round1(dailyRate * remaining);
  const formula = `mean(${recentCompleted} cleaned tasks / 28 days) × ${remaining} remaining days in month`;

  const series = buildDailySeries(
    period.from,
    period.to,
    completedTasks
      .map((t) => t.completedAt)
      .filter((d): d is Date => d != null),
  );

  return {
    domain: "housekeeping" as const,
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    kpis: {
      cleanedTasks: completedTasks.length,
      completedSessions: completedSessions.length,
      acceptedTasks,
      reworkEvents: rejectedInspections.length,
      anomalousSessions,
      distinctRooms: distinctRooms.size,
      readyRooms,
      onTimePct,
      onTimeSampleCount: withDue,
      auditFindings: rejectedInspections.length,
      riskRooms: riskRooms.length,
      avgMinutesPerTask,
      totalValidSessionMinutes,
      totalExcludedSessionMinutes,
      p50SessionMinutes: p50,
      p90SessionMinutes: p90,
      insufficientDurationData: sorted.length < MIN_PERCENTILE_SAMPLES,
      durationSampleCount: sorted.length,
    },
    comparison: {
      cleanedTasks: compareMetric(completedTasks.length, prevCompleted),
      onTimePct: compareMetric(onTimePct, prevOnTimePct),
      auditFindings: compareMetric(rejectedInspections.length, prevRejected),
      acceptedTasks: compareMetric(acceptedTasks, prevAccepted),
      reworkEvents: compareMetric(rejectedInspections.length, prevRejected),
    },
    series,
    breakdowns: {
      byPriority: bucketCounts(completedTasks.map((t) => t.priority)),
      byServiceType: bucketCounts(completedTasks.map((t) => t.serviceType)),
    },
    riskRooms,
    forecast: {
      remainingDaysInMonth: remaining,
      dailyRate: round1(dailyRate),
      predicted: forecastValue,
      formula,
      unit: "cleaned_tasks" as const,
    },
  };
}
