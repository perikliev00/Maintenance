/** Analytics summary KPIs and series for maintenance / housekeeping dashboards. */
import { apiGet, buildQuery } from "./http";

// Module export.
export type AnalyticsDomain = "maintenance" | "housekeeping";

// Module export.
export type AnalyticsMetricCompare = {
  // Field/property in this shape.
  current: number | null;
  // Field/property in this shape.
  previous: number | null;
  // Field/property in this shape.
  deltaPct: number | null;
};

// Module export.
export type AnalyticsSeriesPoint = { date: string; count: number };

// Module export.
export type MaintenanceAnalyticsKpis = {
  // Field/property in this shape.
  signals: number;
  // Field/property in this shape.
  slaBreaches: { active: number; closed: number };
  // Field/property in this shape.
  reopened: number;
  // Field/property in this shape.
  riskRooms: number;
  // Field/property in this shape.
  avgResolveMinutes: number | null;
  // Field/property in this shape.
  p50ResolveMinutes: number | null;
  // Field/property in this shape.
  p90ResolveMinutes: number | null;
  // Field/property in this shape.
  insufficientDurationData: boolean;
  // Field/property in this shape.
  durationSampleCount: number;
};

// Module export.
export type HousekeepingAnalyticsKpis = {
  // Field/property in this shape.
  cleanedTasks: number;
  // Field/property in this shape.
  completedSessions: number;
  // Field/property in this shape.
  acceptedTasks: number;
  // Field/property in this shape.
  reworkEvents: number;
  // Field/property in this shape.
  anomalousSessions: number;
  // Field/property in this shape.
  distinctRooms: number;
  // Field/property in this shape.
  readyRooms: number;
  // Field/property in this shape.
  onTimePct: number | null;
  // Field/property in this shape.
  onTimeSampleCount: number;
  // Field/property in this shape.
  auditFindings: number;
  // Field/property in this shape.
  riskRooms: number;
  // Field/property in this shape.
  avgMinutesPerTask: number | null;
  // Field/property in this shape.
  totalValidSessionMinutes: number;
  // Field/property in this shape.
  totalExcludedSessionMinutes: number;
  // Field/property in this shape.
  p50SessionMinutes: number | null;
  // Field/property in this shape.
  p90SessionMinutes: number | null;
  // Field/property in this shape.
  insufficientDurationData: boolean;
  // Field/property in this shape.
  durationSampleCount: number;
};

// Module export.
export type AnalyticsSummary =
  // Union/intersection type member.
  | {
      // Field/property in this shape.
      domain: "maintenance";
      // Field/property in this shape.
      period: { from: string; to: string };
      // Field/property in this shape.
      kpis: MaintenanceAnalyticsKpis;
      // Field/property in this shape.
      comparison: {
        // Field/property in this shape.
        signals: AnalyticsMetricCompare;
        // Field/property in this shape.
        reopened: AnalyticsMetricCompare;
        // Field/property in this shape.
        slaActive: AnalyticsMetricCompare;
      };
      // Field/property in this shape.
      series: AnalyticsSeriesPoint[];
      // Field/property in this shape.
      breakdowns: {
        // Field/property in this shape.
        byCategory?: Array<{ key: string; count: number }>;
        // Field/property in this shape.
        byPriority?: Array<{ key: string; count: number }>;
      };
      // Field/property in this shape.
      riskRooms: Array<{
        // Field/property in this shape.
        locationId: string;
        // Field/property in this shape.
        label: string;
        // Field/property in this shape.
        factors: string[];
        // Field/property in this shape.
        ticketCount: number;
      // Close multi-line construct with trailing syntax.
      }>;
      // Field/property in this shape.
      forecast: {
        // Field/property in this shape.
        remainingDaysInMonth: number;
        // Field/property in this shape.
        dailyRate: number | null;
        // Field/property in this shape.
        predicted: number | null;
        // Field/property in this shape.
        formula: string;
        // Field/property in this shape.
        unit: "tickets" | "cleaned_tasks";
      };
    }
  // Union/intersection type member.
  | {
      // Field/property in this shape.
      domain: "housekeeping";
      // Field/property in this shape.
      period: { from: string; to: string };
      // Field/property in this shape.
      kpis: HousekeepingAnalyticsKpis;
      // Field/property in this shape.
      comparison: {
        // Field/property in this shape.
        cleanedTasks: AnalyticsMetricCompare;
        // Field/property in this shape.
        onTimePct: AnalyticsMetricCompare;
        // Field/property in this shape.
        auditFindings: AnalyticsMetricCompare;
        // Field/property in this shape.
        acceptedTasks: AnalyticsMetricCompare;
        // Field/property in this shape.
        reworkEvents: AnalyticsMetricCompare;
      };
      // Field/property in this shape.
      series: AnalyticsSeriesPoint[];
      // Field/property in this shape.
      breakdowns: {
        // Field/property in this shape.
        byCategory?: Array<{ key: string; count: number }>;
        // Field/property in this shape.
        byPriority?: Array<{ key: string; count: number }>;
        // Field/property in this shape.
        byServiceType?: Array<{ key: string; count: number }>;
      };
      // Field/property in this shape.
      riskRooms: Array<{
        // Field/property in this shape.
        locationId: string;
        // Field/property in this shape.
        label: string;
        // Field/property in this shape.
        factors: string[];
        // Field/property in this shape.
        ticketCount: number;
      // Close multi-line construct with trailing syntax.
      }>;
      // Field/property in this shape.
      forecast: {
        // Field/property in this shape.
        remainingDaysInMonth: number;
        // Field/property in this shape.
        dailyRate: number | null;
        // Field/property in this shape.
        predicted: number | null;
        // Field/property in this shape.
        formula: string;
        // Field/property in this shape.
        unit: "tickets" | "cleaned_tasks";
      };
    };

/**
 * Load domain KPIs, comparison deltas, series, and risk rooms for a period.
 * `from`/`to` are optional hotel-date bounds; omit for the server default window.
 */
export async function fetchAnalyticsSummary(params: {
  // Field/property in this shape.
  domain: AnalyticsDomain;
  // Field/property in this shape.
  from?: string;
  // Field/property in this shape.
  to?: string;
// Open multi-line construct.
}): Promise<AnalyticsSummary> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/analytics/summary${buildQuery({
      // Field/property in this shape.
      domain: params.domain,
      // Field/property in this shape.
      from: params.from,
      // Field/property in this shape.
      to: params.to,
    // Continue multi-line list/arguments.
    })}`,
  );
}
