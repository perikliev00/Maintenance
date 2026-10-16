/** UTC calendar-day helpers and period windows for analytics summaries. */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Truncate to UTC midnight (inclusive start of a reporting day). */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  // Zero UTC time fields — inclusive start of reporting day.
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/** Truncate to end of UTC calendar day (inclusive upper bound). */
export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}

/** YYYY-MM-DD from a Date via ISO string (UTC day key). */
export function isoDay(d: Date): string {
  // ISO is always UTC — matches startOfDay/endOfDay conventions.
  return d.toISOString().slice(0, 10);
}

/** Remaining UTC calendar days in the month containing `now` (not including today). */
export function daysRemainingInMonth(now: Date): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  // Day 0 of next month = last day of current month.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = now.getUTCDate();
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
    ? startOfDay(from)
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
  return { from: prevFrom, to: prevTo };
}

/**
 * Dense daily count series from `from`..`to` (UTC days), filling zeros for days
 * with no events so charts have a continuous x-axis.
 */
export function buildDailySeries(
  from: Date,
  to: Date,
  events: Date[],
): Array<{ date: string; count: number }> {
  // Bucket event timestamps by UTC day key.
  const counts = new Map<string, number>();
  for (const e of events) {
    const key = isoDay(e);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Walk every calendar day in the window, filling missing days with 0.
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
