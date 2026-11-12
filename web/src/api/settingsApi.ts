/**
 * Public + admin settings, system status, and settings history.
 * `fetchPublicSettings` also syncs the hotel timezone cache used by plan dates.
 */
import type { ModuleToggles } from "./capabilities";
import { apiGet, apiPatch, buildQuery } from "./http";
import { setCachedHotelTimezone } from "./planApi";

export type PublicSettings = {
  modules: ModuleToggles;
  interface: {
    defaultTheme: "dark" | "light";
    locale: "bg" | "en";
    density: "comfortable" | "compact";
  };
  operations: {
    overdueSessionMinutes: number;
    defaultTaskDueHours: number;
    defaultTicketSlaHours: number;
    riskTicketThreshold: number;
    riskWindowDays: number;
    hotelTimezone: string;
  };
  flags: {
    show_overdue_banner: boolean;
    require_inspection: boolean;
    allow_reception_reassign?: boolean;
  };
};

export type SettingsBundle = Record<
  string,
  {
    key: string;
    value: unknown;
    version: number;
    updatedAt: string;
    updatedByEmployeeId: string | null;
    /** False when the server fell back to defaults due to corrupt stored JSON. */
    valueValid?: boolean;
  }
>;

export type SettingHistoryRow = {
  id: string;
  key: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
  actor: { id: string; fullName: string; employeeNumber: string };
};

export type SystemStatus = {
  api: { ok: boolean };
  database: { ok: boolean; pingMs: number };
  counts: {
    rooms: number | null;
    commonAreas: number | null;
    openTickets: number | null;
    runningSessions: number | null;
  };
  serverTime: string;
  fetchedAt?: string;
  version: string;
};

/**
 * Settings safe for any authenticated client (modules, UI, ops thresholds).
 * Side effect: refreshes the hotel timezone cache used by plan date helpers.
 */
export async function fetchPublicSettings(): Promise<PublicSettings> {
  const settings = await apiGet<PublicSettings>("/settings/public");
  const tz = settings?.operations?.hotelTimezone;
  if (typeof tz === "string" && tz.length > 0) {
    setCachedHotelTimezone(tz);
  }
  return settings;
}

/** Full admin settings bundle keyed by setting key (includes sensitive keys). */
export async function fetchAllSettings(): Promise<SettingsBundle> {
  return apiGet("/settings");
}

/** API/DB health plus coarse entity counts for the System Status section. */
export async function fetchSystemStatus(): Promise<SystemStatus> {
  return apiGet("/settings/system");
}

/** Audit trail of setting changes; optional key filter and row limit. */
export async function fetchSettingsHistory(params?: {
  key?: string;
  limit?: number;
}): Promise<SettingHistoryRow[]> {
  return apiGet(
    `/settings/history${buildQuery({
      key: params?.key,
      limit: params?.limit,
    })}`,
  );
}

/**
 * Patch one setting by key; optional reason is stored on history.
 * Pass `expectedVersion` from the loaded bundle to enforce optimistic concurrency.
 */
export async function patchSetting(
  key: string,
  value: unknown,
  reason?: string,
  expectedVersion?: number,
) {
  return apiPatch<{
    key: string;
    value: unknown;
    version: number;
    updatedAt: string;
    updatedByEmployeeId: string | null;
  }>(`/settings/${key}`, {
    value,
    reason,
    // Spread remaining fields/props.
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  });
}
