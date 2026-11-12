/**
 * Analytics entrypoint: resolves the reporting period from ops settings,
 * then dispatches to maintenance or housekeeping summary builders.
 */
import { getOperations } from "../settings";
import type { AnalyticsDomain, AnalyticsScopeFilters } from "./types";
import { resolvePeriod } from "./period";
import { getMaintenanceSummary } from "./maintenanceSummary";
import { getHousekeepingSummary } from "./housekeepingSummary";

export type { AnalyticsDomain, AnalyticsScopeFilters } from "./types";

/**
 * Build a domain-scoped analytics summary for an optional date range.
 * Defaults the window to `ops.riskWindowDays` ending today when `from`/`to` are omitted.
 */
export async function getAnalyticsSummary(input: {
  domain: AnalyticsDomain;
  from?: Date;
  to?: Date;
  scope?: AnalyticsScopeFilters;
}) {
  // riskWindowDays / riskTicketThreshold come from operations settings.
  const ops = await getOperations();
  // Normalize optional from/to into an inclusive UTC day window.
  const period = resolvePeriod(input.from, input.to, ops.riskWindowDays);
  const scope = input.scope ?? {};

  // Dispatch to the domain-specific summary builder.
  if (input.domain === "maintenance") {
    return getMaintenanceSummary(period, ops.riskTicketThreshold, scope);
  }
  return getHousekeepingSummary(period, ops.riskTicketThreshold, scope);
}
