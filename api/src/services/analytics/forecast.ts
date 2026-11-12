/** Shared trailing-window forecast used by analytics domain summaries. */
import { DAY_MS, daysRemainingInMonth, startOfDay } from "./period";
// Runtime import from ./stats.
import { round1 } from "./stats";

/** The fixed lookback window used by the analytics forecast. */
export const FORECAST_LOOKBACK_DAYS = 28;

/** Start of the UTC day at the beginning of the forecast's lookback window. */
export function forecastWindowStart(now: Date): Date {
  // Return normalized/computed value.
  return startOfDay(
    // Construct Date for the lookback/window bound.
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
  // Param now required by this function.
  now: Date,
  // Param recentCount required by this function.
  recentCount: number,
  // Param metricLabel required by this function.
  metricLabel: string,
) {
  // Derived metric dailyRate.
  const dailyRate = recentCount / FORECAST_LOOKBACK_DAYS;
  // Local remainingDaysInMonth used below.
  const remainingDaysInMonth = daysRemainingInMonth(now);

  // Return response object.
  return {
    remainingDaysInMonth,
    // Compute dailyRate for the payload.
    dailyRate: round1(dailyRate),
    // Compute predicted for the payload.
    predicted: round1(dailyRate * remainingDaysInMonth),
    // Set formula.
    formula: `mean(${recentCount} ${metricLabel} / ${FORECAST_LOOKBACK_DAYS} days) × ${remainingDaysInMonth} remaining days in month`,
  };
}
