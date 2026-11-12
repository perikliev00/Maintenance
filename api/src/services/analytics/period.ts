/** UTC calendar-day helpers and period windows for analytics summaries. */

import { formatHotelDate } from "../hotelTime";

// Exported constant DAY_MS.
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Truncate to UTC midnight (inclusive start of a reporting day). */
export function startOfDay(d: Date): Date {
  // Date x for window math.
  const x = new Date(d);
  // Zero UTC time fields — inclusive start of reporting day.
  x.setUTCHours(0, 0, 0, 0);
  // Return computed result.
  return x;
}

/** Truncate to end of UTC calendar day (inclusive upper bound). */
export function endOfDay(d: Date): Date {
  // Date x for window math.
  const x = new Date(d);
  // Support the surrounding control flow.
  x.setUTCHours(23, 59, 59, 999);
  // Return computed result.
  return x;
}

/** YYYY-MM-DD from a Date via ISO string (UTC day key). */
export function isoDay(d: Date): string {
  // ISO is always UTC — matches startOfDay/endOfDay conventions.
  return formatHotelDate(d);
}

/** Remaining UTC calendar days in the month containing `now` (not including today). */
export function daysRemainingInMonth(now: Date): number {
  // Local year used below.
  const year = now.getUTCFullYear();
  // Local month used below.
  const month = now.getUTCMonth();
  // Day 0 of next month = last day of current month.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // Local today used below.
  const today = now.getUTCDate();
  // Return computed result.
  return Math.max(0, lastDay - today);
}

/**
 * Resolve an inclusive reporting window. Omitting `from` uses `riskWindowDays`
 * before `to` (or now); both bounds are normalized to UTC day edges.
 */
export function resolvePeriod(from?: Date, to?: Date, riskWindowDays = 30) {
  // Wall-clock "now" for live SLA / forecast anchors.
  const now = new Date();
  // Default upper bound is end of today (UTC).
  const toDate = to ? endOfDay(to) : endOfDay(now);
  // Default lower bound walks back riskWindowDays from `to`.
  const fromDate = from
    // Support the surrounding control flow.
    ? startOfDay(from)
    // Support the surrounding control flow.
    : startOfDay(new Date(toDate.getTime() - riskWindowDays * DAY_MS));
  // Bundle now with bounds so summaries share one clock.
  return { from: fromDate, to: toDate, now };
}

/**
 * Adjacent prior window of the same length ending the day before `period.from`.
 * Used for period-over-period KPI deltas.
 */
export function previousPeriod(period: { from: Date; to: Date }) {
  // At least one day long so a same-day window still has a prior day.
  const lengthMs = Math.max(DAY_MS, period.to.getTime() - period.from.getTime());
  // Prior window ends the UTC day before `period.from`.
  const prevTo = endOfDay(new Date(period.from.getTime() - DAY_MS));
  // Walk back lengthMs from prevTo (inclusive bounds via +1 ms).
  const prevFrom = startOfDay(new Date(prevTo.getTime() - lengthMs + 1));
  // Return response object.
  return { from: prevFrom, to: prevTo };
}

/**
 * Dense daily count series from `from`..`to` (UTC days), filling zeros for days
 * with no events so charts have a continuous x-axis.
 */
export function buildDailySeries(
  // Param from required by this function.
  from: Date,
  // Param to required by this function.
  to: Date,
  // Param events required by this function.
  events: Date[],
// Support the surrounding control flow.
): Array<{ date: string; count: number }> {
  // Bucket event timestamps by UTC day key.
  const counts = new Map<string, number>();
  // Iterate items for aggregation or writes.
  for (const e of events) {
    // Local key used below.
    const key = isoDay(e);
    // Support the surrounding control flow.
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Walk every calendar day in the window, filling missing days with 0.
  const series: Array<{ date: string; count: number }> = [];
  // Local cursor used below.
  const cursor = startOfDay(from);
  // Local end used below.
  const end = startOfDay(to);
  // Loop until stop condition.
  while (cursor.getTime() <= end.getTime()) {
    // Local key used below.
    const key = isoDay(cursor);
    // Support the surrounding control flow.
    series.push({ date: key, count: counts.get(key) ?? 0 });
    // Support the surrounding control flow.
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  // Return computed result.
  return series;
}
