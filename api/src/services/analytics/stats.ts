export const MIN_PERCENTILE_SAMPLES = 5;

export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length < MIN_PERCENTILE_SAMPLES) return null;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

export function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function round1(n: number | null): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

export function compareMetric(
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

export type CountBucket = { key: string; count: number };

export function bucketCounts(items: string[]): CountBucket[] {
  const map = new Map<string, number>();
  for (const k of items) {
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
