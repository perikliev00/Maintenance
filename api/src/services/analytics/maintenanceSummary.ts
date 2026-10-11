import { TicketStatus } from "@prisma/client";
import { prisma } from "../../db";
import { OPEN_TICKET_STATUSES } from "../../constants";
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
  avg,
  bucketCounts,
  compareMetric,
  percentile,
  round1,
} from "./stats";

export async function getMaintenanceSummary(
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
    where: { openedAt: { gte: forecastFrom, lte: period.now }, ...tw },
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
