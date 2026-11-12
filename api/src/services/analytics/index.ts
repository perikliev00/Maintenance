/**
 * Analytics entrypoint: resolves the reporting period from ops settings,
 * then dispatches to maintenance or housekeeping summary builders.
 */
import { getOperations } from "../settings";
// Type-only import from ./types (erased at runtime).
import type { AnalyticsDomain, AnalyticsScopeFilters } from "./types";
// Runtime import from ./period.
import { resolvePeriod } from "./period";
// Runtime import from ./maintenanceSummary.
import { getMaintenanceSummary } from "./maintenanceSummary";
// Runtime import from ./housekeepingSummary.
import { getHousekeepingSummary } from "./housekeepingSummary";

// Re-export types from this barrel.
export type { AnalyticsDomain, AnalyticsScopeFilters } from "./types";

/**
 * Build a domain-scoped analytics summary for an optional date range.
 * Defaults the window to `ops.riskWindowDays` ending today when `from`/`to` are omitted.
 */
export async function getAnalyticsSummary(input: {
  // Param domain required by this function.
  domain: AnalyticsDomain;
  // Param from required by this function.
  from?: Date;
  // Param to required by this function.
  to?: Date;
  // Param scope required by this function.
  scope?: AnalyticsScopeFilters;
// Support the surrounding control flow.
}) {
  // riskWindowDays / riskTicketThreshold come from operations settings.
  const ops = await getOperations();
  // Normalize optional from/to into an inclusive UTC day window.
  const period = resolvePeriod(input.from, input.to, ops.riskWindowDays);
  // Local scope used below.
  const scope = input.scope ?? {};

  // Dispatch to the domain-specific summary builder.
  if (input.domain === "maintenance") {
    // Return computed result.
    return getMaintenanceSummary(period, ops.riskTicketThreshold, scope);
  }
  // Return computed result.
  return getHousekeepingSummary(period, ops.riskTicketThreshold, scope);
}
