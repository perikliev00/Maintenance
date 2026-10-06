import {
  CatalogStatus,
  InspectionResult,
  LocationKind,
  Prisma,
  SessionStatus,
  TaskStatus,
  TicketStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { OPEN_TICKET_STATUSES } from "../constants";
import { computeReadiness } from "./readiness";
import { getOperations } from "./settings";
import { isAnomalousSession } from "./cleaningResults";

export type AnalyticsDomain = "maintenance" | "housekeeping";

export type AnalyticsScopeFilters = {
  taskWhere?: Prisma.CleaningTaskWhereInput;
  ticketWhere?: Prisma.MaintenanceTicketWhereInput;
  locationWhere?: Prisma.LocationWhereInput;
  sessionWhere?: Prisma.CleaningSessionWhereInput;
};

const MIN_PERCENTILE_SAMPLES = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysRemainingInMonth(now: Date): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = now.getUTCDate();
  return Math.max(0, lastDay - today);
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length < MIN_PERCENTILE_SAMPLES) return null;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round1(n: number | null): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function resolvePeriod(from?: Date, to?: Date, riskWindowDays = 30) {
  const now = new Date();
  const toDate = to ? endOfDay(to) : endOfDay(now);
  const fromDate = from
    ? startOfDay(from)
    : startOfDay(new Date(toDate.getTime() - riskWindowDays * DAY_MS));
  return { from: fromDate, to: toDate, now };
}

function previousPeriod(period: { from: Date; to: Date }) {
  const lengthMs = Math.max(DAY_MS, period.to.getTime() - period.from.getTime());
  const prevTo = endOfDay(new Date(period.from.getTime() - DAY_MS));
  const prevFrom = startOfDay(new Date(prevTo.getTime() - lengthMs + 1));
  return { from: prevFrom, to: prevTo };
}

function buildDailySeries(
  from: Date,
  to: Date,
  events: Date[],
): Array<{ date: string; count: number }> {
  const counts = new Map<string, number>();
  for (const e of events) {
    const key = isoDay(e);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const series: Array<{ date: string; count: number }> = [];
  const cursor = startOfDay(from);
  const end = startOfDay(to);
  while (cursor.getTime() <= end.getTime()) {
    const key = isoDay(cursor);
    series.push({ date: key, count: counts.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}

function compareMetric(
  current: number | null,
  previous: number | null,
): { current: number | null; previous: number | null; deltaPct: number | null } {
  if (current === null || previous === null) {
    return { current, previous, deltaPct: null };
  }
  if (previous === 0) {
    return {
      current,
      previous,
      deltaPct: current === 0 ? 0 : null,
    };
  }
  return {
    current,
    previous,
    deltaPct: round1(((current - previous) / previous) * 100),
  };
}

type CountBucket = { key: string; count: number };

function bucketCounts(items: string[]): CountBucket[] {
  const map = new Map<string, number>();
  for (const k of items) {
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export async function getAnalyticsSummary(input: {
  domain: AnalyticsDomain;
  from?: Date;
  to?: Date;
  scope?: AnalyticsScopeFilters;
}) {
  const ops = await getOperations();
  const period = resolvePeriod(input.from, input.to, ops.riskWindowDays);
  const scope = input.scope ?? {};

  if (input.domain === "maintenance") {
    return getMaintenanceSummary(period, ops.riskTicketThreshold, scope);
  }
  return getHousekeepingSummary(period, ops.riskTicketThreshold, scope);
}

async function getMaintenanceSummary(
  period: { from: Date; to: Date; now: Date },
  riskTicketThreshold: number,
  scope: AnalyticsScopeFilters,
) {
  const prev = previousPeriod(period);
  const tw = scope.ticketWhere ?? {};

  const [tickets, reopenEvents, prevTickets, prevReopens, openPastSlaAll, openBlockingPastSla] =
    await Promise.all([
      prisma.maintenanceTicket.findMany({
        where: { openedAt: { gte: period.from, lte: period.to }, ...tw },
        include: {
          location: {
            include: { floor: { include: { building: true } } },
          },
        },
      }),
      prisma.ticketReopenEvent.findMany({
        where: {
          reopenedAt: { gte: period.from, lte: period.to },
          ...(Object.keys(tw).length ? { ticket: tw } : {}),
        },
      }),
      prisma.maintenanceTicket.count({
        where: { openedAt: { gte: prev.from, lte: prev.to }, ...tw },
      }),
      prisma.ticketReopenEvent.count({
        where: {
          reopenedAt: { gte: prev.from, lte: prev.to },
          ...(Object.keys(tw).length ? { ticket: tw } : {}),
        },
      }),
      prisma.maintenanceTicket.count({
        where: {
          status: { in: [...OPEN_TICKET_STATUSES] },
          dueAt: { lt: period.now },
          slaPausedAt: null,
          ...tw,
        },
      }),
      prisma.maintenanceTicket.findMany({
        where: {
          status: { in: [...OPEN_TICKET_STATUSES] },
          blocksRoom: true,
          dueAt: { lt: period.now },
          slaPausedAt: null,
          ...tw,
        },
        include: {
          location: {
            include: { floor: { include: { building: true } } },
          },
        },
      }),
    ]);

  let slaClosed = 0;
  const resolveMinutes: number[] = [];

  for (const t of tickets) {
    if (t.dueAt) {
      if (
        (t.status === TicketStatus.resolved || t.status === TicketStatus.closed) &&
        t.resolvedAt &&
        t.resolvedAt > t.dueAt
      ) {
        slaClosed += 1;
      }
    }
    if (
      (t.status === TicketStatus.resolved || t.status === TicketStatus.closed) &&
      t.resolvedAt
    ) {
      const mins = (t.resolvedAt.getTime() - t.openedAt.getTime()) / 60000;
      if (mins >= 0 && Number.isFinite(mins)) resolveMinutes.push(mins);
    }
  }

  const slaActive = openPastSlaAll;

  const byLocation = new Map<string, { count: number; label: string }>();
  for (const t of tickets) {
    const label = `${t.location.floor.building.code} ${t.location.number}`;
    const cur = byLocation.get(t.locationId) ?? { count: 0, label };
    cur.count += 1;
    byLocation.set(t.locationId, cur);
  }

  const riskRooms: Array<{
    locationId: string;
    label: string;
    factors: string[];
    ticketCount: number;
  }> = [];

  for (const [locationId, info] of byLocation) {
    if (info.count >= riskTicketThreshold) {
      riskRooms.push({
        locationId,
        label: info.label,
        factors: [`tickets_gte_${riskTicketThreshold}`],
        ticketCount: info.count,
      });
    }
  }

  for (const t of openBlockingPastSla) {
    const label = `${t.location.floor.building.code} ${t.location.number}`;
    const existing = riskRooms.find((r) => r.locationId === t.locationId);
    if (existing) {
      if (!existing.factors.includes("blocking_past_sla")) {
        existing.factors.push("blocking_past_sla");
      }
    } else {
      riskRooms.push({
        locationId: t.locationId,
        label,
        factors: ["blocking_past_sla"],
        ticketCount: byLocation.get(t.locationId)?.count ?? 0,
      });
    }
  }

  riskRooms.sort(
    (a, b) => b.ticketCount - a.ticketCount || a.label.localeCompare(b.label),
  );

  const sorted = [...resolveMinutes].sort((a, b) => a - b);
  const p50 = round1(percentile(sorted, 0.5));
  const p90 = round1(percentile(sorted, 0.9));
  const avgMinutes = round1(avg(sorted));

  const forecastFrom = startOfDay(new Date(period.now.getTime() - 28 * DAY_MS));
  const recentCount = await prisma.maintenanceTicket.count({
    where: { openedAt: { gte: forecastFrom, lte: period.now } },
  });
  const dailyRate = recentCount / 28;
  const remaining = daysRemainingInMonth(period.now);
  const forecastValue = round1(dailyRate * remaining);
  const formula = `mean(${recentCount} tickets / 28 days) × ${remaining} remaining days in month`;

  const series = buildDailySeries(
    period.from,
    period.to,
    tickets.map((t) => t.openedAt),
  );

  return {
    domain: "maintenance" as const,
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    kpis: {
      signals: tickets.length,
      slaBreaches: { active: slaActive, closed: slaClosed },
      reopened: reopenEvents.length,
      riskRooms: riskRooms.length,
      avgResolveMinutes: avgMinutes,
      p50ResolveMinutes: p50,
      p90ResolveMinutes: p90,
      insufficientDurationData: sorted.length < MIN_PERCENTILE_SAMPLES,
      durationSampleCount: sorted.length,
    },
    comparison: {
      signals: compareMetric(tickets.length, prevTickets),
      reopened: compareMetric(reopenEvents.length, prevReopens),
      slaActive: compareMetric(slaActive, null),
    },
    series,
    breakdowns: {
      byCategory: bucketCounts(tickets.map((t) => t.categoryKey)),
      byPriority: bucketCounts(tickets.map((t) => t.priority)),
    },
    riskRooms,
    forecast: {
      remainingDaysInMonth: remaining,
      dailyRate: round1(dailyRate),
      predicted: forecastValue,
      formula,
      unit: "tickets" as const,
    },
  };
}

async function getHousekeepingSummary(
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
  const validSessionMinutes: number[] = [];
  for (const s of completedSessions) {
    if (!s.finishedAt) continue;
    const anomalous = isAnomalousSession({
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      anomalyFlags: s.anomalyFlags,
      anomalyThresholdMinutes,
    });
    if (anomalous) {
      anomalousSessions += 1;
      continue;
    }
    const mins = (s.finishedAt.getTime() - s.startedAt.getTime()) / 60000;
    if (mins >= 0 && Number.isFinite(mins)) validSessionMinutes.push(mins);
  }

  let withDue = 0;
  let onTime = 0;
  let tasksWithValidTime = 0;
  let totalValidMsForTasks = 0;
  for (const task of completedTasks) {
    if (task.dueAt && task.completedAt) {
      withDue += 1;
      if (task.completedAt <= task.dueAt) onTime += 1;
    }
    const validMs = task.sessions.reduce((sum, s) => {
      if (!s.finishedAt) return sum;
      if (
        isAnomalousSession({
          startedAt: s.startedAt,
          finishedAt: s.finishedAt,
          anomalyFlags: s.anomalyFlags,
          anomalyThresholdMinutes,
        })
      ) {
        return sum;
      }
      return (
        sum + Math.max(0, s.finishedAt.getTime() - s.startedAt.getTime())
      );
    }, 0);
    if (validMs > 0) {
      tasksWithValidTime += 1;
      totalValidMsForTasks += validMs;
    }
  }

  const onTimePct = withDue === 0 ? null : round1((onTime / withDue) * 100);
  const avgMinutesPerTask =
    tasksWithValidTime > 0
      ? round1(totalValidMsForTasks / (1000 * 60) / tasksWithValidTime)
      : null;

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
      readyRooms,
      onTimePct,
      onTimeSampleCount: withDue,
      auditFindings: rejectedInspections.length,
      riskRooms: riskRooms.length,
      avgMinutesPerTask,
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
