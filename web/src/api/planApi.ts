/**
 * Daily plan CRUD/import and hotel-local calendar date helpers.
 * Timezone cache is updated from public settings so "today" matches the property.
 */
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

const DEFAULT_HOTEL_TIMEZONE = "Europe/Sofia";
let cachedHotelTimezone = DEFAULT_HOTEL_TIMEZONE;

/** Used by settings fetch to keep hotel-date helpers in sync with server timezone. */
export function setCachedHotelTimezone(tz: string) {
  // Ignore empty strings so a bad settings payload cannot clear the cache.
  if (tz.length > 0) {
    cachedHotelTimezone = tz;
  }
}

/** `YYYY-MM-DD` in the hotel timezone (en-CA yields ISO-like dates). */
export function todayHotelDate(timeZone?: string, instant: Date = new Date()): string {
  // Prefer explicit tz; fall back to the settings-synced cache.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? cachedHotelTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export type DailyPlanCategory = "departure" | "arrival" | "priority";
export type DailyPlanSource = "manual" | "import";

export type DailyPlanImportBatch = {
  id: string;
  hotelDate: string;
  sourceLabel: string;
  status: "completed" | "partial" | "failed";
  totalCount: number;
  createdCount: number;
  skippedCount: number;
  errorCount: number;
  errors: Array<{ index: number; room?: string; reason: string }>;
  createdByEmployeeId: string;
  createdAt: string;
};

export type DailyPlanEntry = {
  id: string;
  hotelDate: string;
  category: DailyPlanCategory;
  notes: string | null;
  source: DailyPlanSource | string;
  externalId?: string | null;
  createdAt: string;
  createdBy: { id: string; fullName: string; employeeNumber: string };
  room: {
    id: string;
    number: string;
    buildingCode: string;
    buildingName: string;
    floor: number;
    occupancy: string;
    cleaningStatus: string;
  };
  task: {
    id: string;
    status: string;
    priority: string;
    sector?: {
      id: string;
      code: string;
      nameBg: string;
      nameEn: string;
    } | null;
    sectorSupervisor?: {
      id: string;
      fullName: string;
      employeeNumber: string;
    } | null;
    assignedEmployee: {
      id: string;
      fullName: string;
      employeeNumber: string;
    } | null;
    shift?: {
      id: string;
      code: string;
      nameBg: string;
      nameEn: string;
      startTime: string;
      endTime: string;
    } | null;
  } | null;
};

export type DailyPlan = {
  date: string;
  departures: DailyPlanEntry[];
  arrivals: DailyPlanEntry[];
  priority: DailyPlanEntry[];
  lastImport?: DailyPlanImportBatch | null;
};

export type DailyPlanImportPayload = {
  hotelDate: string;
  sourceLabel?: string;
  entries: Array<{
    buildingCode: string;
    roomNumber: string;
    category: DailyPlanCategory;
    notes?: string;
    externalId?: string;
  }>;
};

export type DepartureRoomEffectsResult = {
  hotelDate: string;
  applied: number;
  skipped: number;
  deferred: number;
  deferredEntryIds: string[];
  total: number;
};

/** Load departure / arrival / priority buckets for one hotel calendar date. */
export async function fetchDailyPlan(hotelDate: string): Promise<DailyPlan> {
  const search = new URLSearchParams({ hotelDate });
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/daily-plan?${search}`, {
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/**
 * Apply departure-plan side effects (e.g. mark dirty). Optional `confirmEntryIds`
 * covers deferred entries that need an explicit confirmation pass.
 */
export async function applyDepartureRoomEffects(
  hotelDate: string,
  options?: { confirmEntryIds?: string[] },
): Promise<DepartureRoomEffectsResult> {
  // POST body: hotel date plus optional explicit confirm list for deferred rows.
  const res = await apiFetch(`${API_BASE}/daily-plan/apply-departure-effects`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify({
      hotelDate,
      confirmEntryIds: options?.confirmEntryIds,
    }),
  });
  // Return value / early exit.
  return parseJson(res);
}

/**
 * Create one plan entry; server may return side-effect metadata in `effects`
 * (e.g. occupancy / cleaning task linkage).
 */
export async function createDailyPlanEntry(input: {
  hotelDate: string;
  locationId: string;
  category: DailyPlanCategory;
  notes?: string;
  assignedEmployeeId?: string;
  shiftId?: string | null;
}): Promise<{ entry: DailyPlanEntry; effects: Record<string, unknown> }> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/daily-plan`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(input),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Bulk import plan rows; returns the import batch summary plus refreshed plan. */
export async function importDailyPlan(
  payload: DailyPlanImportPayload,
): Promise<{ batch: DailyPlanImportBatch; plan: DailyPlan }> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/daily-plan/import`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(payload),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Delete one plan entry by id. */
export async function deleteDailyPlanEntry(id: string): Promise<{ id: string; deleted: boolean }> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/daily-plan/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}
