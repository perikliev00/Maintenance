/**
 * Public + admin settings, system status, and settings history.
 * `fetchPublicSettings` also syncs the hotel timezone cache used by plan dates.
 */
import type { ModuleToggles } from "./capabilities";
// Import dependency used by this module.
import { apiGet, apiPatch, buildQuery } from "./http";
// Import dependency used by this module.
import { setCachedHotelTimezone } from "./planApi";

// Export type alias for consumers.
export type PublicSettings = {
  // Field/property in this shape.
  modules: ModuleToggles;
  // Field/property in this shape.
  interface: {
    // Field/property in this shape.
    defaultTheme: "dark" | "light";
    // Field/property in this shape.
    locale: "bg" | "en";
    // Field/property in this shape.
    density: "comfortable" | "compact";
  };
  // Field/property in this shape.
  operations: {
    // Field/property in this shape.
    overdueSessionMinutes: number;
    // Field/property in this shape.
    defaultTaskDueHours: number;
    // Field/property in this shape.
    defaultTicketSlaHours: number;
    // Field/property in this shape.
    riskTicketThreshold: number;
    // Field/property in this shape.
    riskWindowDays: number;
    // Field/property in this shape.
    hotelTimezone: string;
  };
  // Field/property in this shape.
  flags: {
    // Field/property in this shape.
    show_overdue_banner: boolean;
    // Field/property in this shape.
    require_inspection: boolean;
    // Field/property in this shape.
    allow_reception_reassign?: boolean;
  };
};

// Export type alias for consumers.
export type SettingsBundle = Record<
  // List item in import/export/params.
  string,
  {
    // Field/property in this shape.
    key: string;
    // Field/property in this shape.
    value: unknown;
    // Field/property in this shape.
    version: number;
    // Field/property in this shape.
    updatedAt: string;
    // Field/property in this shape.
    updatedByEmployeeId: string | null;
    /** False when the server fell back to defaults due to corrupt stored JSON. */
    valueValid?: boolean;
  }
>;

// Export type alias for consumers.
export type SettingHistoryRow = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  key: string;
  // Field/property in this shape.
  before: unknown;
  // Field/property in this shape.
  after: unknown;
  // Field/property in this shape.
  reason: string | null;
  // Field/property in this shape.
  createdAt: string;
  // Field/property in this shape.
  actor: { id: string; fullName: string; employeeNumber: string };
};

// Export type alias for consumers.
export type SystemStatus = {
  // Field/property in this shape.
  api: { ok: boolean };
  // Field/property in this shape.
  database: { ok: boolean; pingMs: number };
  // Field/property in this shape.
  counts: {
    // Field/property in this shape.
    rooms: number | null;
    // Field/property in this shape.
    commonAreas: number | null;
    // Field/property in this shape.
    openTickets: number | null;
    // Field/property in this shape.
    runningSessions: number | null;
  };
  // Field/property in this shape.
  serverTime: string;
  // Field/property in this shape.
  fetchedAt?: string;
  // Field/property in this shape.
  version: string;
};

/**
 * Settings safe for any authenticated client (modules, UI, ops thresholds).
 * Side effect: refreshes the hotel timezone cache used by plan date helpers.
 */
export async function fetchPublicSettings(): Promise<PublicSettings> {
  // Local constant binding.
  const settings = await apiGet<PublicSettings>("/settings/public");
  // Local constant binding.
  const tz = settings?.operations?.hotelTimezone;
  // Conditional branch for this case.
  if (typeof tz === "string" && tz.length > 0) {
    // Invoke helper or pass arguments.
    setCachedHotelTimezone(tz);
  }
  // Return computed result to caller.
  return settings;
}

/** Full admin settings bundle keyed by setting key (includes sensitive keys). */
export async function fetchAllSettings(): Promise<SettingsBundle> {
  // Return computed result to caller.
  return apiGet("/settings");
}

/** API/DB health plus coarse entity counts for the System Status section. */
export async function fetchSystemStatus(): Promise<SystemStatus> {
  // Return computed result to caller.
  return apiGet("/settings/system");
}

/** Audit trail of setting changes; optional key filter and row limit. */
export async function fetchSettingsHistory(params?: {
  // Field/property in this shape.
  key?: string;
  // Field/property in this shape.
  limit?: number;
// Open multi-line construct.
}): Promise<SettingHistoryRow[]> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/settings/history${buildQuery({
      // Field/property in this shape.
      key: params?.key,
      // Field/property in this shape.
      limit: params?.limit,
    // Continue multi-line list/arguments.
    })}`,
  );
}

/**
 * Patch one setting by key; optional reason is stored on history.
 * Pass `expectedVersion` from the loaded bundle to enforce optimistic concurrency.
 */
export async function patchSetting(
  // Field/property in this shape.
  key: string,
  // Field/property in this shape.
  value: unknown,
  // Field/property in this shape.
  reason?: string,
  // Field/property in this shape.
  expectedVersion?: number,
// Open multi-line construct.
) {
  // Return computed result to caller.
  return apiPatch<{
    // Field/property in this shape.
    key: string;
    // Field/property in this shape.
    value: unknown;
    // Field/property in this shape.
    version: number;
    // Field/property in this shape.
    updatedAt: string;
    // Field/property in this shape.
    updatedByEmployeeId: string | null;
  // Open multi-line construct.
  }>(`/settings/${key}`, {
    // List item in import/export/params.
    value,
    // List item in import/export/params.
    reason,
    // Spread remaining fields/props.
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  });
}
