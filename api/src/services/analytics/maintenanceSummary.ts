/**
 * Maintenance analytics: ticket volume, SLA breaches, reopen events,
 * resolve-time percentiles, risk rooms, and a simple end-of-month forecast.
 */
// Prisma status enum for resolved/closed SLA breach checks.
import { TicketStatus } from "@prisma/client";
// Shared Prisma client singleton.
import { prisma } from "../../db";
// Open-ticket status list reused for live past-due SLA queries.
import { OPEN_TICKET_STATUSES } from "../../constants";
// Optional sector/location scope merged into every ticket where clause.
import type { AnalyticsScopeFilters } from "./types";
// UTC day windows, prior period, and daily chart series builders.
import { buildDailySeries, previousPeriod } from "./period";
// Runtime import from ./forecast.
import { buildMonthlyForecast, forecastWindowStart } from "./forecast";
// Percentiles, averages, histograms, and period-over-period deltas.
import {
  MIN_PERCENTILE_SAMPLES,
  avg,
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
  addTicketThresholdRiskRooms,
  mergeBlockingPastSlaRiskRooms,
  sortRiskRooms,
  // Type alias RiskRoomRow.
  type RiskRoomRow,
// Support the surrounding control flow.
} from "./riskRooms";

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
  // Param period required by this function.
  period: { from: Date; to: Date; now: Date },
  // Param riskTicketThreshold required by this function.
  riskTicketThreshold: number,
  // Param scope required by this function.
  scope: AnalyticsScopeFilters,
) {
  // Matching prior window for period-over-period deltas.
  const prev = previousPeriod(period);
  // Optional data-scope filter applied to all ticket queries.
  const tw = scope.ticketWhere ?? {};

  // Fan-out period tickets, reopens, prev counts, and live SLA breaches.
  const [tickets, reopenEvents, prevTickets, prevReopens, openPastSlaAll, openBlockingPastSla] =
    // Await side effect before continuing.
    await Promise.all([
      // Tickets opened in the current period (with location for risk labels).
      prisma.maintenanceTicket.findMany({
        // Filter matching rows.
        where: { openedAt: { gte: period.from, lte: period.to }, ...tw },
        // Include relations for labels/checks.
        include: {
          // Field location on this type/payload.
          location: { include: locationWithBuildingInclude },
        },
      }),
      // Reopen events that occurred in the current period.
      prisma.ticketReopenEvent.findMany({
        // Filter matching rows.
        where: {
          // Time field reopenedAt.
          reopenedAt: { gte: period.from, lte: period.to },
          // Spread additional fields/filters.
          ...(Object.keys(tw).length ? { ticket: tw } : {}),
        },
      }),
      // Prior-period ticket volume for comparison.
      prisma.maintenanceTicket.count({
        // Filter matching rows.
        where: { openedAt: { gte: prev.from, lte: prev.to }, ...tw },
      }),
      // Prior-period reopen count for comparison.
      prisma.ticketReopenEvent.count({
        // Filter matching rows.
        where: {
          // Time field reopenedAt.
          reopenedAt: { gte: prev.from, lte: prev.to },
          // Spread additional fields/filters.
          ...(Object.keys(tw).length ? { ticket: tw } : {}),
        },
      }),
      // Active SLA breaches: open, past due, SLA not paused.
      prisma.maintenanceTicket.count({
        // Filter matching rows.
        where: {
          // Field status on this type/payload.
          status: { in: [...OPEN_TICKET_STATUSES] },
          // Time field dueAt.
          dueAt: { lt: period.now },
          // Time field slaPausedAt.
          slaPausedAt: null,
          // Spread additional fields/filters.
          ...tw,
        },
      }),
      // Same as above but blocksRoom — feeds risk-room factors.
      prisma.maintenanceTicket.findMany({
        // Filter matching rows.
        where: {
          // Field status on this type/payload.
          status: { in: [...OPEN_TICKET_STATUSES] },
          // Field blocksRoom on this type/payload.
          blocksRoom: true,
          // Time field dueAt.
          dueAt: { lt: period.now },
          // Time field slaPausedAt.
          slaPausedAt: null,
          // Spread additional fields/filters.
          ...tw,
        },
        // Include relations for labels/checks.
        include: {
          // Field location on this type/payload.
          location: { include: locationWithBuildingInclude },
        },
      }),
    ]);

  // Counters derived in a single pass over period-opened tickets.
  let slaClosed = 0;
  // Accumulator list resolveMinutes.
  const resolveMinutes: number[] = [];

  // Walk period tickets for closed SLA breaches and resolve-time samples.
  for (const t of tickets) {
    // Closed SLA breach: finished after dueAt (opened during the period).
    if (t.dueAt) {
      // Only terminal resolved/closed states count toward closed breaches.
      if (
        // Additional clause in this boolean decision.
        (t.status === TicketStatus.resolved || t.status === TicketStatus.closed) &&
        // Additional clause in this boolean decision.
        t.resolvedAt &&
        // Resolved timestamp must be strictly after the SLA due moment.
        t.resolvedAt > t.dueAt
      ) {
        // Assign slaClosed +.
        slaClosed += 1;
      }
    }
    // Collect resolve duration for percentile / avg KPIs.
    if (
      // Additional clause in this boolean decision.
      (t.status === TicketStatus.resolved || t.status === TicketStatus.closed) &&
      // Support the surrounding control flow.
      t.resolvedAt
    ) {
      // Derived metric mins.
      const mins = (t.resolvedAt.getTime() - t.openedAt.getTime()) / 60000;
      // Drop negative / non-finite durations (clock skew).
      if (mins >= 0 && Number.isFinite(mins)) resolveMinutes.push(mins);
    }
  }

  // Alias for KPI naming (active open past-SLA count).
  const slaActive = openPastSlaAll;

  // Count tickets per location for the risk threshold.
  const byLocation = new Map<string, { count: number; label: string }>();
  // Iterate items for aggregation or writes.
  for (const t of tickets) {
    // Local label used below.
    const label = formatLocationLabel(t.location);
    // Local cur used below.
    const cur = byLocation.get(t.locationId) ?? { count: 0, label };
    // Assign cur.count +.
    cur.count += 1;
    // Support the surrounding control flow.
    byLocation.set(t.locationId, cur);
  }

  // Accumulator list riskRooms.
  const riskRooms: RiskRoomRow[] = [];
  // Invoke addTicketThresholdRiskRooms.
  addTicketThresholdRiskRooms(riskRooms, byLocation, riskTicketThreshold);
  // Map ticketCountsByLocation for keyed aggregation.
  const ticketCountsByLocation = new Map(
    // Support the surrounding control flow.
    [...byLocation.entries()].map(([id, info]) => [id, info.count]),
  );
  // Invoke mergeBlockingPastSlaRiskRooms.
  mergeBlockingPastSlaRiskRooms(
    riskRooms,
    openBlockingPastSla,
    ticketCountsByLocation,
  );
  // Invoke sortRiskRooms.
  sortRiskRooms(riskRooms);

  // Resolve-time percentiles require a sorted ascending sample.
  const sorted = [...resolveMinutes].sort((a, b) => a - b);
  // Median and tail resolve durations (null when sample too small).
  const p50 = round1(percentile(sorted, 0.5));
  // Local p90 used below.
  const p90 = round1(percentile(sorted, 0.9));
  // Local avgMinutes used below.
  const avgMinutes = round1(avg(sorted));

  // Naive forecast: trailing 28-day daily open rate × remaining days in month.
  // Trailing 28 UTC days ending at `period.now` for the open-rate estimate.
  const forecastFrom = forecastWindowStart(period.now);
  // Count rows into recentCount.
  const recentCount = await prisma.maintenanceTicket.count({
    // Filter matching rows.
    where: { openedAt: { gte: forecastFrom, lte: period.now }, ...tw },
  });
  // Local forecast used below.
  const forecast = buildMonthlyForecast(period.now, recentCount, "tickets");

  // Daily opened-ticket series for charts.
  const series = buildDailySeries(
    // Support the surrounding control flow.
    period.from,
    // Support the surrounding control flow.
    period.to,
    // Support the surrounding control flow.
    tickets.map((t) => t.openedAt),
  );

  // Stable response shape for maintenance analytics endpoints and charts.
  return {
    // Set domain.
    domain: "maintenance" as const,
    // Set period.
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    // Headline counters and resolve-time distribution for the window.
    kpis: {
      // Field signals on this type/payload.
      signals: tickets.length,
      // Field slaBreaches on this type/payload.
      slaBreaches: { active: slaActive, closed: slaClosed },
      // Field reopened on this type/payload.
      reopened: reopenEvents.length,
      // Field riskRooms on this type/payload.
      riskRooms: riskRooms.length,
      // Field avgResolveMinutes on this type/payload.
      avgResolveMinutes: avgMinutes,
      // Field p50ResolveMinutes on this type/payload.
      p50ResolveMinutes: p50,
      // Field p90ResolveMinutes on this type/payload.
      p90ResolveMinutes: p90,
      // Field insufficientDurationData on this type/payload.
      insufficientDurationData: sorted.length < MIN_PERCENTILE_SAMPLES,
      // Raw sample size helps UI explain null p50/p90 on sparse data.
      durationSampleCount: sorted.length,
    },
    // Period-over-period deltas vs the adjacent prior window.
    comparison: {
      // Field signals on this type/payload.
      signals: compareMetric(tickets.length, prevTickets),
      // Field reopened on this type/payload.
      reopened: compareMetric(reopenEvents.length, prevReopens),
      // No prior snapshot for live active SLA — previous is null.
      slaActive: compareMetric(slaActive, null),
      // Closed SLA breaches are period-scoped — no comparison block here.
    },
    // Daily opened-ticket counts for time-series charts.
    series,
    // Category and priority histograms for the opened-in-period set.
    breakdowns: {
      // Field byCategory on this type/payload.
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
