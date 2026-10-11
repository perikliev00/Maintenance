import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

export type AnalyticsDomain = "maintenance" | "housekeeping";

export type AnalyticsMetricCompare = {
  current: number | null;
  previous: number | null;
  deltaPct: number | null;
};

export type AnalyticsSeriesPoint = { date: string; count: number };

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

export async function fetchAnalyticsSummary(params: {
  domain: AnalyticsDomain;
  from?: string;
  to?: string;
}): Promise<AnalyticsSummary> {
  const q = new URLSearchParams({ domain: params.domain });
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  const res = await apiFetch(`${API_BASE}/analytics/summary?${q}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}
