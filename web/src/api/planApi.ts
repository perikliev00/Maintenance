import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

const DEFAULT_HOTEL_TIMEZONE = "Europe/Sofia";
let cachedHotelTimezone = DEFAULT_HOTEL_TIMEZONE;

/** Used by settings fetch to keep hotel-date helpers in sync with server timezone. */
export function setCachedHotelTimezone(tz: string) {
  if (tz.length > 0) {
    cachedHotelTimezone = tz;
  }
}

export function todayHotelDate(timeZone?: string, instant: Date = new Date()): string {
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

export async function fetchDailyPlan(hotelDate: string): Promise<DailyPlan> {
  const search = new URLSearchParams({ hotelDate });
  const res = await apiFetch(`${API_BASE}/daily-plan?${search}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function applyDepartureRoomEffects(
  hotelDate: string,
  options?: { confirmEntryIds?: string[] },
): Promise<DepartureRoomEffectsResult> {
  const res = await apiFetch(`${API_BASE}/daily-plan/apply-departure-effects`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      hotelDate,
      confirmEntryIds: options?.confirmEntryIds,
    }),
  });
  return parseJson(res);
}

export async function createDailyPlanEntry(input: {
  hotelDate: string;
  locationId: string;
  category: DailyPlanCategory;
  notes?: string;
  assignedEmployeeId?: string;
  shiftId?: string | null;
}): Promise<{ entry: DailyPlanEntry; effects: Record<string, unknown> }> {
  const res = await apiFetch(`${API_BASE}/daily-plan`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function importDailyPlan(
  payload: DailyPlanImportPayload,
): Promise<{ batch: DailyPlanImportBatch; plan: DailyPlan }> {
  const res = await apiFetch(`${API_BASE}/daily-plan/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function deleteDailyPlanEntry(id: string): Promise<{ id: string; deleted: boolean }> {
  const res = await apiFetch(`${API_BASE}/daily-plan/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return parseJson(res);
}
