import { getOperations } from "../settings";
import type { AnalyticsDomain, AnalyticsScopeFilters } from "./types";
import { resolvePeriod } from "./period";
import { getMaintenanceSummary } from "./maintenanceSummary";
import { getHousekeepingSummary } from "./housekeepingSummary";

export type { AnalyticsDomain, AnalyticsScopeFilters } from "./types";

export async function getAnalyticsSummary(input: {
  domain: AnalyticsDomain;
  from?: Date;
  to?: Date;
  scope?: AnalyticsScopeFilters;
}) {
  const ops = await getOperations();
  const period = resolvePeriod(input.from, input.to, ops.riskWindowDays);
  const scope = input.scope ?? {};

  if (input.domain === "maintenance") {
    return getMaintenanceSummary(period, ops.riskTicketThreshold, scope);
  }
  return getHousekeepingSummary(period, ops.riskTicketThreshold, scope);
}
