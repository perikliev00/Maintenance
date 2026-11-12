/** Inclusive range start: UTC midnight of `isoDate` (YYYY-MM-DD). */
export function dayStartUtc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** Exclusive end: midnight of the day after `to`. */
export function dayEndExclusiveUtc(isoDate: string): Date {
  // Advance one calendar day so `finishedAt < toEnd` includes all of `to`.
  const d = dayStartUtc(isoDate);
  // Execute: d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
