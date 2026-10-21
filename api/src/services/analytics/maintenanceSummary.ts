/**
 * Maintenance analytics: ticket volume, SLA breaches, reopen events,
 * resolve-time percentiles, risk rooms, and a simple end-of-month forecast.
 */
// Prisma status enum for resolved/closed SLA breach checks.
import { TicketStatus } from "@prisma/client";
import { prisma } from "../../db";
// Open-ticket status list reused for live past-due SLA queries.
import { OPEN_TICKET_STATUSES } from "../../constants";
// Optional sector/location scope merged into every ticket where clause.
import type { AnalyticsScopeFilters } from "./types";
// UTC day windows, prior period, and daily chart series builders.
import { buildDailySeries, previousPeriod } from "./period";
import { buildMonthlyForecast, forecastWindowStart } from "./forecast";
// Percentiles, averages, histograms, and period-over-period deltas.
import {
  MIN_PERCENTILE_SAMPLES,
  avg,
  bucketCounts,
  compareMetric,
  percentile,
  round1,
} from "./stats";

/**
 * Aggregate maintenance ticket metrics for `period`.
 * Active SLA breaches ignore tickets with SLA paused; closed breaches are
 * tickets resolved/closed after their dueAt within the opened-in-period set.
 *
 * @param period - Inclusive UTC window plus `now` for live SLA comparisons.
 * @param riskTicketThreshold - Min opened tickets in-period to flag a risk room.
 * @param scope - Optional Prisma `ticketWhere` fragment from data scope.
 */
export async function getMaintenanceSummary(
  period: { from: Date; to: Date; now: Date },
  riskTicketThreshold: number,
  scope: AnalyticsScopeFilters,
) {
  // Matching prior window for period-over-period deltas.
  const prev = previousPeriod(period);
  // Optional data-scope filter applied to all ticket queries.
  const tw = scope.ticketWhere ?? {};

  // Fan-out period tickets, reopens, prev counts, and live SLA breaches.
  const [tickets, reopenEvents, prevTickets, prevReopens, openPastSlaAll, openBlockingPastSla] =
    await Promise.all([
      // Tickets opened in the current period (with location for risk labels).
      prisma.maintenanceTicket.findMany({
        where: { openedAt: { gte: period.from, lte: period.to }, ...tw },
        include: {
          location: {
            include: { floor: { include: { building: true } } },
          },
        },
      }),
      // Reopen events that occurred in the current period.
      prisma.ticketReopenEvent.findMany({
        where: {
          reopenedAt: { gte: period.from, lte: period.to },
          ...(Object.keys(tw).length ? { ticket: tw } : {}),
        },
      }),
      // Prior-period ticket volume for comparison.
      prisma.maintenanceTicket.count({
        where: { openedAt: { gte: prev.from, lte: prev.to }, ...tw },
      }),
      // Prior-period reopen count for comparison.
      prisma.ticketReopenEvent.count({
        where: {
          reopenedAt: { gte: prev.from, lte: prev.to },
          ...(Object.keys(tw).length ? { ticket: tw } : {}),
        },
      }),
      // Active SLA breaches: open, past due, SLA not paused.
      prisma.maintenanceTicket.count({
        where: {
          status: { in: [...OPEN_TICKET_STATUSES] },
          dueAt: { lt: period.now },
          slaPausedAt: null,
          ...tw,
        },
      }),
      // Same as above but blocksRoom — feeds risk-room factors.
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

  // Counters derived in a single pass over period-opened tickets.
  let slaClosed = 0;
  const resolveMinutes: number[] = [];

  // Walk period tickets for closed SLA breaches and resolve-time samples.
  for (const t of tickets) {
    // Closed SLA breach: finished after dueAt (opened during the period).
    if (t.dueAt) {
      // Only terminal resolved/closed states count toward closed breaches.
      if (
        (t.status === TicketStatus.resolved || t.status === TicketStatus.closed) &&
        t.resolvedAt &&
        // Resolved timestamp must be strictly after the SLA due moment.
        t.resolvedAt > t.dueAt
      ) {
        slaClosed += 1;
      }
    }
    // Collect resolve duration for percentile / avg KPIs.
    if (
      (t.status === TicketStatus.resolved || t.status === TicketStatus.closed) &&
      t.resolvedAt
    ) {
      const mins = (t.resolvedAt.getTime() - t.openedAt.getTime()) / 60000;
      // Drop negative / non-finite durations (clock skew).
      if (mins >= 0 && Number.isFinite(mins)) resolveMinutes.push(mins);
    }
  }

  // Alias for KPI naming (active open past-SLA count).
  const slaActive = openPastSlaAll;

  // Count tickets per location for the risk threshold.
  const byLocation = new Map<string, { count: number; label: string }>();
  for (const t of tickets) {
    // Display label: building code + room number from nested location graph.
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

  // Rooms that opened ≥ riskTicketThreshold tickets in the period.
  for (const [locationId, info] of byLocation) {
    // Below threshold — not surfaced as a risk room for this window.
    if (info.count >= riskTicketThreshold) {
      riskRooms.push({
        locationId,
        label: info.label,
        factors: [`tickets_gte_${riskTicketThreshold}`],
        ticketCount: info.count,
      });
    }
  }

  // Merge blocking past-SLA open tickets into risk rooms.
  for (const t of openBlockingPastSla) {
    const label = `${t.location.floor.building.code} ${t.location.number}`;
    const existing = riskRooms.find((r) => r.locationId === t.locationId);
    // Room already flagged — append blocking factor when missing.
    if (existing) {
      // Avoid duplicate factor strings on the same room.
      if (!existing.factors.includes("blocking_past_sla")) {
        existing.factors.push("blocking_past_sla");
      }
    } else {
      // First risk signal for this location is live blocking past SLA.
      riskRooms.push({
        locationId: t.locationId,
        label,
        factors: ["blocking_past_sla"],
        ticketCount: byLocation.get(t.locationId)?.count ?? 0,
      });
    }
  }

  // Highest ticket count first; ties broken by label.
  riskRooms.sort(
    (a, b) => b.ticketCount - a.ticketCount || a.label.localeCompare(b.label),
  );

  // Resolve-time percentiles require a sorted ascending sample.
  const sorted = [...resolveMinutes].sort((a, b) => a - b);
  // Median and tail resolve durations (null when sample too small).
  const p50 = round1(percentile(sorted, 0.5));
  const p90 = round1(percentile(sorted, 0.9));
  const avgMinutes = round1(avg(sorted));

  // Naive forecast: trailing 28-day daily open rate × remaining days in month.
  // Trailing 28 UTC days ending at `period.now` for the open-rate estimate.
  const forecastFrom = forecastWindowStart(period.now);
  const recentCount = await prisma.maintenanceTicket.count({
    where: { openedAt: { gte: forecastFrom, lte: period.now }, ...tw },
  });
  const forecast = buildMonthlyForecast(period.now, recentCount, "tickets");

  // Daily opened-ticket series for charts.
  const series = buildDailySeries(
    period.from,
    period.to,
    tickets.map((t) => t.openedAt),
  );

  // Stable response shape for maintenance analytics endpoints and charts.
  return {
    domain: "maintenance" as const,
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    // Headline counters and resolve-time distribution for the window.
    kpis: {
      signals: tickets.length,
      slaBreaches: { active: slaActive, closed: slaClosed },
      reopened: reopenEvents.length,
      riskRooms: riskRooms.length,
      avgResolveMinutes: avgMinutes,
      p50ResolveMinutes: p50,
      p90ResolveMinutes: p90,
      insufficientDurationData: sorted.length < MIN_PERCENTILE_SAMPLES,
      // Raw sample size helps UI explain null p50/p90 on sparse data.
      durationSampleCount: sorted.length,
    },
    // Period-over-period deltas vs the adjacent prior window.
    comparison: {
      signals: compareMetric(tickets.length, prevTickets),
      reopened: compareMetric(reopenEvents.length, prevReopens),
      // No prior snapshot for live active SLA — previous is null.
      slaActive: compareMetric(slaActive, null),
      // Closed SLA breaches are period-scoped — no comparison block here.
    },
    // Daily opened-ticket counts for time-series charts.
    series,
    // Category and priority histograms for the opened-in-period set.
    breakdowns: {
      byCategory: bucketCounts(tickets.map((t) => t.categoryKey)),
      // Priority histogram uses the same bucket helper as category.
      byPriority: bucketCounts(tickets.map((t) => t.priority)),
    },
    // Ranked rooms combining volume threshold and blocking SLA factors.
    riskRooms,
    // End-of-month ticket volume projection from trailing daily rate.
    forecast: { ...forecast, unit: "tickets" as const },
  };
}
