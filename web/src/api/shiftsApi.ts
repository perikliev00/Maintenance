/** Shift definitions and per-day employee roster assignment. */
import { API_BASE, apiFetch, apiGet, apiPatch, apiPost, authHeaders, buildQuery, parseJson } from "./http";

// Export type alias for consumers.
export type ShiftRow = {
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
  // Field/property in this shape.
  sortOrder: number;
  // Field/property in this shape.
  isActive: boolean;
  // Field/property in this shape.
  createdAt: string;
  // Field/property in this shape.
  updatedAt: string;
};

// Export type alias for consumers.
export type ShiftRosterEntry = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  hotelDate: string;
  // Field/property in this shape.
  employee: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    fullName: string;
    // Field/property in this shape.
    employeeNumber: string;
  };
  // Field/property in this shape.
  shift: {
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
  };
  // Field/property in this shape.
  createdAt: string;
  // Field/property in this shape.
  updatedAt: string;
};

// Export type alias for consumers.
export type ShiftRoster = {
  // Field/property in this shape.
  hotelDate: string;
  // Field/property in this shape.
  entries: ShiftRosterEntry[];
};

/** List shift definitions; pass `includeInactive` for admin editing. */
export async function fetchShifts(includeInactive = false): Promise<ShiftRow[]> {
  // Return computed result to caller.
  return apiGet(`/shifts${buildQuery({ includeInactive: includeInactive || undefined })}`);
}

/** Create a named shift window (`startTime`/`endTime` as HH:mm strings). */
export async function createShift(input: {
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
  // Field/property in this shape.
  sortOrder?: number;
  // Field/property in this shape.
  isActive?: boolean;
// Open multi-line construct.
}): Promise<ShiftRow> {
  // Return computed result to caller.
  return apiPost("/shifts", input);
}

/** Patch shift metadata / active flag. */
export async function updateShift(
  // Field/property in this shape.
  id: string,
  // Field/property in this shape.
  input: {
    // Field/property in this shape.
    code?: string;
    // Field/property in this shape.
    nameBg?: string;
    // Field/property in this shape.
    nameEn?: string;
    // Field/property in this shape.
    startTime?: string;
    // Field/property in this shape.
    endTime?: string;
    // Field/property in this shape.
    sortOrder?: number;
    // Field/property in this shape.
    isActive?: boolean;
  },
// Open multi-line construct.
): Promise<ShiftRow> {
  // Return computed result to caller.
  return apiPatch(`/shifts/${id}`, input);
}

/** Employee→shift assignments for one hotel calendar date. */
export async function fetchShiftRoster(hotelDate: string): Promise<ShiftRoster> {
  // Return computed result to caller.
  return apiGet(`/shifts/roster${buildQuery({ hotelDate })}`);
}

/** Replace the full roster for a hotel date (PUT — not incremental). */
export async function saveShiftRoster(input: {
  // Field/property in this shape.
  hotelDate: string;
  // Field/property in this shape.
  entries: Array<{ employeeId: string; shiftId: string }>;
// Open multi-line construct.
}): Promise<ShiftRoster> {
  // Local constant binding.
  const res = await apiFetch(`${API_BASE}/shifts/roster`, {
    // Field/property in this shape.
    method: "PUT",
    // Field/property in this shape.
    headers: authHeaders(),
    // Field/property in this shape.
    body: JSON.stringify(input),
  });
  // Return computed result to caller.
  return parseJson(res);
}
