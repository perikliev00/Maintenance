/** Shared trailing-window forecast used by analytics domain summaries. */
import { DAY_MS, daysRemainingInMonth, startOfDay } from "./period";
import { round1 } from "./stats";

/** The fixed lookback window used by the analytics forecast. */
export const FORECAST_LOOKBACK_DAYS = 28;

/** Start of the UTC day at the beginning of the forecast's lookback window. */
export function forecastWindowStart(now: Date): Date {
  return startOfDay(
    new Date(now.getTime() - FORECAST_LOOKBACK_DAYS * DAY_MS),
  );
}

/**
 * Turn a trailing-window count into the response shape shared by the two
 * analytics domains. `metricLabel` is deliberately presentation-only: it
 * preserves each domain's existing formula text without coupling their data
 * queries or scopes.
 */
export function buildMonthlyForecast(
  now: Date,
  recentCount: number,
  metricLabel: string,
) {
  const dailyRate = recentCount / FORECAST_LOOKBACK_DAYS;
  const remainingDaysInMonth = daysRemainingInMonth(now);

  return {
    remainingDaysInMonth,
    dailyRate: round1(dailyRate),
    predicted: round1(dailyRate * remainingDaysInMonth),
    formula: `mean(${recentCount} ${metricLabel} / ${FORECAST_LOOKBACK_DAYS} days) × ${remainingDaysInMonth} remaining days in month`,
  };
}
