/**
 * Public + admin settings, system status, and settings history.
 * `fetchPublicSettings` also syncs the hotel timezone cache used by plan dates.
 */
import type { ModuleToggles } from "./capabilities";
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";
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
  };
};

export type SettingsBundle = Record<
  string,
  {
    key: string;
    value: unknown;
    updatedAt: string;
    updatedByEmployeeId: string | null;
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
    rooms: number;
    commonAreas: number;
    openTickets: number;
    runningSessions: number;
  };
  serverTime: string;
  version: string;
};

/**
 * Settings safe for any authenticated client (modules, UI, ops thresholds).
 * Side effect: refreshes the hotel timezone cache used by plan date helpers.
 */
export async function fetchPublicSettings(): Promise<PublicSettings> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/settings/public`, {
    headers: authHeaders(),
  });
  const settings = await parseJson<PublicSettings>(res);
  // Keep `todayHotelDate` aligned with the property timezone from ops settings.
  const tz = settings?.operations?.hotelTimezone;
  // Branch: conditional gate.
  if (typeof tz === "string" && tz.length > 0) {
    // State transition.
    setCachedHotelTimezone(tz);
  }
  // Return value / early exit.
  return settings;
}

/** Full admin settings bundle keyed by setting key (includes sensitive keys). */
export async function fetchAllSettings(): Promise<SettingsBundle> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/settings`, { headers: authHeaders() });
  // Return value / early exit.
  return parseJson(res);
}

/** API/DB health plus coarse entity counts for the System Status section. */
export async function fetchSystemStatus(): Promise<SystemStatus> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/settings/system`, {
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Audit trail of setting changes; optional key filter and row limit. */
export async function fetchSettingsHistory(params?: {
  key?: string;
  limit?: number;
}): Promise<SettingHistoryRow[]> {
  const search = new URLSearchParams();
  // Branch: conditional gate.
  if (params?.key) search.set("key", params.key);
  // Branch: conditional gate.
  if (params?.limit) search.set("limit", String(params.limit));
  // Optional query suffix.
  const qs = search.toString();
  // Authenticated HTTP request.
  const res = await apiFetch(
    `${API_BASE}/settings/history${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  // Return value / early exit.
  return parseJson(res);
}

/** Patch one setting by key; optional reason is stored on history. */
export async function patchSetting(
  key: string,
  value: unknown,
  reason?: string,
) {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/settings/${key}`, {
    method: "PATCH",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify({ value, reason }),
  });
  // Return value / early exit.
  return parseJson(res);
}
