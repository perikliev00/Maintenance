/**
 * Daily plan CRUD/import and hotel-local calendar date helpers.
 * Timezone cache is updated from public settings so "today" matches the property.
 */
import { apiDelete, apiGet, apiPost, buildQuery } from "./http";

// Local constant binding.
const DEFAULT_HOTEL_TIMEZONE = "Europe/Sofia";
// Mutable local binding.
let cachedHotelTimezone = DEFAULT_HOTEL_TIMEZONE;

/** Used by settings fetch to keep hotel-date helpers in sync with server timezone. */
export function setCachedHotelTimezone(tz: string) {
  // Conditional branch for this case.
  if (tz.length > 0) {
    // Assign value for subsequent use.
    cachedHotelTimezone = tz;
  }
}

/** `YYYY-MM-DD` in the hotel timezone (en-CA yields ISO-like dates). */
export function todayHotelDate(timeZone?: string, instant: Date = new Date()): string {
  // Return computed result to caller.
  return new Intl.DateTimeFormat("en-CA", {
    // Field/property in this shape.
    timeZone: timeZone ?? cachedHotelTimezone,
    // Field/property in this shape.
    year: "numeric",
    // Field/property in this shape.
    month: "2-digit",
    // Field/property in this shape.
    day: "2-digit",
  // Invoke helper or pass arguments.
  }).format(instant);
}

// Export type alias for consumers.
export type DailyPlanCategory = "departure" | "arrival" | "priority";
// Export type alias for consumers.
export type DailyPlanSource = "manual" | "import";

// Export type alias for consumers.
export type DailyPlanImportBatch = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  hotelDate: string;
  // Field/property in this shape.
  sourceLabel: string;
  // Field/property in this shape.
  status: "completed" | "partial" | "failed";
  // Field/property in this shape.
  totalCount: number;
  // Field/property in this shape.
  createdCount: number;
  // Field/property in this shape.
  skippedCount: number;
  // Field/property in this shape.
  errorCount: number;
  // Field/property in this shape.
  errors: Array<{ index: number; room?: string; reason: string }>;
  // Field/property in this shape.
  createdByEmployeeId: string;
  // Field/property in this shape.
  createdAt: string;
};

// Export type alias for consumers.
export type DailyPlanEntry = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  hotelDate: string;
  // Field/property in this shape.
  category: DailyPlanCategory;
  // Field/property in this shape.
  notes: string | null;
  // Field/property in this shape.
  source: DailyPlanSource | string;
  // Field/property in this shape.
  externalId?: string | null;
  // Field/property in this shape.
  createdAt: string;
  // Field/property in this shape.
  createdBy: { id: string; fullName: string; employeeNumber: string };
  // Field/property in this shape.
  room: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    number: string;
    // Field/property in this shape.
    buildingCode: string;
    // Field/property in this shape.
    buildingName: string;
    // Field/property in this shape.
    floor: number;
    // Field/property in this shape.
    occupancy: string;
    // Field/property in this shape.
    cleaningStatus: string;
  };
  // Field/property in this shape.
  task: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    status: string;
    // Field/property in this shape.
    priority: string;
    // Field/property in this shape.
    sector?: {
      // Field/property in this shape.
      id: string;
      // Field/property in this shape.
      code: string;
      // Field/property in this shape.
      nameBg: string;
      // Field/property in this shape.
      nameEn: string;
    // Close multi-line construct with trailing syntax.
    } | null;
    // Field/property in this shape.
    sectorSupervisor?: {
      // Field/property in this shape.
      id: string;
      // Field/property in this shape.
      fullName: string;
      // Field/property in this shape.
      employeeNumber: string;
    // Close multi-line construct with trailing syntax.
    } | null;
    // Field/property in this shape.
    assignedEmployee: {
      // Field/property in this shape.
      id: string;
      // Field/property in this shape.
      fullName: string;
      // Field/property in this shape.
      employeeNumber: string;
    // Close multi-line construct with trailing syntax.
    } | null;
    // Field/property in this shape.
    shift?: {
      // Field/property in this shape.
      id: string;
      // Field/property in this shape.
      code: string;
      // Field/property in this shape.
      nameBg: string;
      // Field/property in this shape.
      nameEn: string;
      // Field/property in this shape.
      startTime: string;
      // Field/property in this shape.
      endTime: string;
    // Close multi-line construct with trailing syntax.
    } | null;
  // Close multi-line construct with trailing syntax.
  } | null;
};

// Export type alias for consumers.
export type DailyPlan = {
  // Field/property in this shape.
  date: string;
  // Field/property in this shape.
  departures: DailyPlanEntry[];
  // Field/property in this shape.
  arrivals: DailyPlanEntry[];
  // Field/property in this shape.
  priority: DailyPlanEntry[];
  // Field/property in this shape.
  lastImport?: DailyPlanImportBatch | null;
};

// Export type alias for consumers.
export type DailyPlanImportPayload = {
  // Field/property in this shape.
  hotelDate: string;
  // Field/property in this shape.
  sourceLabel?: string;
  // Field/property in this shape.
  entries: Array<{
    // Field/property in this shape.
    buildingCode: string;
    // Field/property in this shape.
    roomNumber: string;
    // Field/property in this shape.
    category: DailyPlanCategory;
    // Field/property in this shape.
    notes?: string;
    // Field/property in this shape.
    externalId?: string;
  // Close multi-line construct with trailing syntax.
  }>;
};

// Export type alias for consumers.
export type DepartureRoomEffectsResult = {
  // Field/property in this shape.
  hotelDate: string;
  // Field/property in this shape.
  applied: number;
  // Field/property in this shape.
  skipped: number;
  // Field/property in this shape.
  deferred: number;
  // Field/property in this shape.
  deferredEntryIds: string[];
  // Field/property in this shape.
  total: number;
};

/** Load departure / arrival / priority buckets for one hotel calendar date. */
export async function fetchDailyPlan(hotelDate: string): Promise<DailyPlan> {
  // Return computed result to caller.
  return apiGet(`/daily-plan${buildQuery({ hotelDate })}`);
}

/**
 * Apply departure-plan side effects (e.g. mark dirty). Optional `confirmEntryIds`
 * covers deferred entries that need an explicit confirmation pass.
 */
export async function applyDepartureRoomEffects(
  // Field/property in this shape.
  hotelDate: string,
  // Field/property in this shape.
  options?: { confirmEntryIds?: string[] },
// Open multi-line construct.
): Promise<DepartureRoomEffectsResult> {
  // Return computed result to caller.
  return apiPost("/daily-plan/apply-departure-effects", {
    // List item in import/export/params.
    hotelDate,
    // Field/property in this shape.
    confirmEntryIds: options?.confirmEntryIds,
  });
}

/**
 * Create one plan entry; server may return side-effect metadata in `effects`
 * (e.g. occupancy / cleaning task linkage).
 */
export async function createDailyPlanEntry(input: {
  // Field/property in this shape.
  hotelDate: string;
  // Field/property in this shape.
  locationId: string;
  // Field/property in this shape.
  category: DailyPlanCategory;
  // Field/property in this shape.
  notes?: string;
  // Field/property in this shape.
  assignedEmployeeId?: string;
  // Field/property in this shape.
  shiftId?: string | null;
// Open multi-line construct.
}): Promise<{ entry: DailyPlanEntry; effects: Record<string, unknown> }> {
  // Return computed result to caller.
  return apiPost("/daily-plan", input);
}

/** Bulk import plan rows; returns the import batch summary plus refreshed plan. */
export async function importDailyPlan(
  // Field/property in this shape.
  payload: DailyPlanImportPayload,
// Open multi-line construct.
): Promise<{ batch: DailyPlanImportBatch; plan: DailyPlan }> {
  // Return computed result to caller.
  return apiPost("/daily-plan/import", payload);
}

/** Delete one plan entry by id. */
export async function deleteDailyPlanEntry(id: string): Promise<{ id: string; deleted: boolean }> {
  // Return computed result to caller.
  return apiDelete(`/daily-plan/${id}`);
}
