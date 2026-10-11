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

export async function fetchPublicSettings(): Promise<PublicSettings> {
  const res = await apiFetch(`${API_BASE}/settings/public`, {
    headers: authHeaders(),
  });
  const settings = await parseJson<PublicSettings>(res);
  const tz = settings?.operations?.hotelTimezone;
  if (typeof tz === "string" && tz.length > 0) {
    setCachedHotelTimezone(tz);
  }
  return settings;
}

export async function fetchAllSettings(): Promise<SettingsBundle> {
  const res = await apiFetch(`${API_BASE}/settings`, { headers: authHeaders() });
  return parseJson(res);
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const res = await apiFetch(`${API_BASE}/settings/system`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function fetchSettingsHistory(params?: {
  key?: string;
  limit?: number;
}): Promise<SettingHistoryRow[]> {
  const search = new URLSearchParams();
  if (params?.key) search.set("key", params.key);
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  const res = await apiFetch(
    `${API_BASE}/settings/history${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

export async function patchSetting(
  key: string,
  value: unknown,
  reason?: string,
) {
  const res = await apiFetch(`${API_BASE}/settings/${key}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ value, reason }),
  });
  return parseJson(res);
}
