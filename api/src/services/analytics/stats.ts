/** Small numeric helpers shared by analytics summary builders. */

/** Prefer null percentiles over noisy estimates on tiny samples. */
export const MIN_PERCENTILE_SAMPLES = 5;

/**
 * Linear-interpolation percentile on a pre-sorted ascending array.
 * Returns null when below {@link MIN_PERCENTILE_SAMPLES}.
 */
export function percentile(sortedAsc: number[], p: number): number | null {
  // Tiny samples produce unstable percentiles — prefer null.
  if (sortedAsc.length < MIN_PERCENTILE_SAMPLES) return null;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  // Exact index — no interpolation needed.
  if (lo === hi) return sortedAsc[lo];
  // Linear interpolate between neighboring sorted values.
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/** Arithmetic mean, or null for an empty list. */
export function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  // Single pass sum then divide by length.
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Round to one decimal for display-stable KPI / delta values. */
export function round1(n: number | null): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

/**
 * Period-over-period comparison. `deltaPct` is null when either side is missing
 * or when previous is 0 and current is non-zero (undefined % change).
 */
export function compareMetric(
  current: number | null,
  previous: number | null,
): { current: number | null; previous: number | null; deltaPct: number | null } {
  // Missing either side → no delta.
  if (current === null || previous === null) {
    return { current, previous, deltaPct: null };
  }
  // Division by zero: 0→0 is 0%; 0→nonzero is undefined (null).
  if (previous === 0) {
    return {
      current,
      previous,
      // Set deltaPct.
      deltaPct: current === 0 ? 0 : null,
    };
  }
  return {
    current,
    previous,
    // Compute deltaPct for the payload.
    deltaPct: round1(((current - previous) / previous) * 100),
  };
}

export type CountBucket = { key: string; count: number };

/** Frequency histogram sorted by count desc, then key asc. */
export function bucketCounts(items: string[]): CountBucket[] {
  const map = new Map<string, number>();
  for (const k of items) {
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  // Highest count first; ties broken alphabetically by key.
  return [...map.entries()]
    // Map elements to output shape.
    .map(([key, count]) => ({ key, count }))
    // Sort for stable order.
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
