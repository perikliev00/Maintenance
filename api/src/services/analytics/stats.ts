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
  // Local idx used below.
  const idx = (sortedAsc.length - 1) * p;
  // Derived metric lo.
  const lo = Math.floor(idx);
  // Derived metric hi.
  const hi = Math.ceil(idx);
  // Exact index — no interpolation needed.
  if (lo === hi) return sortedAsc[lo];
  // Linear interpolate between neighboring sorted values.
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/** Arithmetic mean, or null for an empty list. */
export function avg(nums: number[]): number | null {
  // Threshold/size gate.
  if (nums.length === 0) return null;
  // Single pass sum then divide by length.
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Round to one decimal for display-stable KPI / delta values. */
export function round1(n: number | null): number | null {
  // Guard missing required data.
  if (n === null || !Number.isFinite(n)) return null;
  // Return computed result.
  return Math.round(n * 10) / 10;
}

/**
 * Period-over-period comparison. `deltaPct` is null when either side is missing
 * or when previous is 0 and current is non-zero (undefined % change).
 */
export function compareMetric(
  // Param current required by this function.
  current: number | null,
  // Param previous required by this function.
  previous: number | null,
// Support the surrounding control flow.
): { current: number | null; previous: number | null; deltaPct: number | null } {
  // Missing either side → no delta.
  if (current === null || previous === null) {
    // Return response object.
    return { current, previous, deltaPct: null };
  }
  // Division by zero: 0→0 is 0%; 0→nonzero is undefined (null).
  if (previous === 0) {
    // Return response object.
    return {
      current,
      previous,
      // Set deltaPct.
      deltaPct: current === 0 ? 0 : null,
    };
  }
  // Return response object.
  return {
    current,
    previous,
    // Compute deltaPct for the payload.
    deltaPct: round1(((current - previous) / previous) * 100),
  };
}

// Public type CountBucket for callers of this service.
export type CountBucket = { key: string; count: number };

/** Frequency histogram sorted by count desc, then key asc. */
export function bucketCounts(items: string[]): CountBucket[] {
  // Map map for keyed aggregation.
  const map = new Map<string, number>();
  // Iterate items for aggregation or writes.
  for (const k of items) {
    // Support the surrounding control flow.
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  // Highest count first; ties broken alphabetically by key.
  return [...map.entries()]
    // Map elements to output shape.
    .map(([key, count]) => ({ key, count }))
    // Sort for stable order.
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
