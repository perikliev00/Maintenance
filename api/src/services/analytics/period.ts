export const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysRemainingInMonth(now: Date): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = now.getUTCDate();
  return Math.max(0, lastDay - today);
}

export function resolvePeriod(from?: Date, to?: Date, riskWindowDays = 30) {
  const now = new Date();
  const toDate = to ? endOfDay(to) : endOfDay(now);
  const fromDate = from
    ? startOfDay(from)
    : startOfDay(new Date(toDate.getTime() - riskWindowDays * DAY_MS));
  return { from: fromDate, to: toDate, now };
}

export function previousPeriod(period: { from: Date; to: Date }) {
  const lengthMs = Math.max(DAY_MS, period.to.getTime() - period.from.getTime());
  const prevTo = endOfDay(new Date(period.from.getTime() - DAY_MS));
  const prevFrom = startOfDay(new Date(prevTo.getTime() - lengthMs + 1));
  return { from: prevFrom, to: prevTo };
}

export function buildDailySeries(
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
