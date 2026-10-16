/** Analytics summary KPIs and series for maintenance / housekeeping dashboards. */
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

// Module export.
export type AnalyticsDomain = "maintenance" | "housekeeping";

// Module export.
export type AnalyticsMetricCompare = {
  current: number | null;
  previous: number | null;
  deltaPct: number | null;
};

// Module export.
export type AnalyticsSeriesPoint = { date: string; count: number };

// Module export.
export type MaintenanceAnalyticsKpis = {
  signals: number;
  slaBreaches: { active: number; closed: number };
  reopened: number;
  riskRooms: number;
  avgResolveMinutes: number | null;
  p50ResolveMinutes: number | null;
  p90ResolveMinutes: number | null;
  insufficientDurationData: boolean;
  durationSampleCount: number;
};

// Module export.
export type HousekeepingAnalyticsKpis = {
  cleanedTasks: number;
  completedSessions: number;
  acceptedTasks: number;
  reworkEvents: number;
  anomalousSessions: number;
  distinctRooms: number;
  readyRooms: number;
  onTimePct: number | null;
  onTimeSampleCount: number;
  auditFindings: number;
  riskRooms: number;
  avgMinutesPerTask: number | null;
  totalValidSessionMinutes: number;
  totalExcludedSessionMinutes: number;
  p50SessionMinutes: number | null;
  p90SessionMinutes: number | null;
  insufficientDurationData: boolean;
  durationSampleCount: number;
};

// Module export.
export type AnalyticsSummary =
  | {
      domain: "maintenance";
      period: { from: string; to: string };
      kpis: MaintenanceAnalyticsKpis;
      comparison: {
        signals: AnalyticsMetricCompare;
        reopened: AnalyticsMetricCompare;
        slaActive: AnalyticsMetricCompare;
      };
      series: AnalyticsSeriesPoint[];
      breakdowns: {
        byCategory?: Array<{ key: string; count: number }>;
        byPriority?: Array<{ key: string; count: number }>;
      };
      riskRooms: Array<{
        locationId: string;
        label: string;
        factors: string[];
        ticketCount: number;
      }>;
      forecast: {
        remainingDaysInMonth: number;
        dailyRate: number | null;
        predicted: number | null;
        formula: string;
        unit: "tickets" | "cleaned_tasks";
      };
    }
  | {
      domain: "housekeeping";
      period: { from: string; to: string };
      kpis: HousekeepingAnalyticsKpis;
      comparison: {
        cleanedTasks: AnalyticsMetricCompare;
        onTimePct: AnalyticsMetricCompare;
        auditFindings: AnalyticsMetricCompare;
        acceptedTasks: AnalyticsMetricCompare;
        reworkEvents: AnalyticsMetricCompare;
      };
      series: AnalyticsSeriesPoint[];
      breakdowns: {
        byCategory?: Array<{ key: string; count: number }>;
        byPriority?: Array<{ key: string; count: number }>;
        byServiceType?: Array<{ key: string; count: number }>;
      };
      riskRooms: Array<{
        locationId: string;
        label: string;
        factors: string[];
        ticketCount: number;
      }>;
      forecast: {
        remainingDaysInMonth: number;
        dailyRate: number | null;
        predicted: number | null;
        formula: string;
        unit: "tickets" | "cleaned_tasks";
      };
    };

/**
 * Load domain KPIs, comparison deltas, series, and risk rooms for a period.
 * `from`/`to` are optional hotel-date bounds; omit for the server default window.
 */
export async function fetchAnalyticsSummary(params: {
  domain: AnalyticsDomain;
  from?: string;
  to?: string;
}): Promise<AnalyticsSummary> {
  // Domain is required; date bounds are optional query filters.
  const q = new URLSearchParams({ domain: params.domain });
  // Optional hotel-date lower bound.
  if (params.from) q.set("from", params.from);
  // Optional hotel-date upper bound.
  if (params.to) q.set("to", params.to);
  // Authenticated GET of the analytics summary payload.
  const res = await apiFetch(`${API_BASE}/analytics/summary?${q}`, {
    headers: authHeaders(),
  });
  // Decode typed summary (maintenance | housekeeping union).
  return parseJson(res);
}
