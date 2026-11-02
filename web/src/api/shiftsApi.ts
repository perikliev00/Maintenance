/** Shift definitions and per-day employee roster assignment. */
import { API_BASE, apiFetch, apiGet, apiPatch, apiPost, authHeaders, buildQuery, parseJson } from "./http";

export type ShiftRow = {
  id: string;
  code: string;
  nameBg: string;
  nameEn: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ShiftRosterEntry = {
  id: string;
  hotelDate: string;
  employee: {
    id: string;
    fullName: string;
    employeeNumber: string;
  };
  shift: {
    id: string;
    code: string;
    nameBg: string;
    nameEn: string;
    startTime: string;
    endTime: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type ShiftRoster = {
  hotelDate: string;
  entries: ShiftRosterEntry[];
};

/** List shift definitions; pass `includeInactive` for admin editing. */
export async function fetchShifts(includeInactive = false): Promise<ShiftRow[]> {
  return apiGet(`/shifts${buildQuery({ includeInactive: includeInactive || undefined })}`);
}

/** Create a named shift window (`startTime`/`endTime` as HH:mm strings). */
export async function createShift(input: {
  code: string;
  nameBg: string;
  nameEn: string;
  startTime: string;
  endTime: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<ShiftRow> {
  return apiPost("/shifts", input);
}

/** Patch shift metadata / active flag. */
export async function updateShift(
  id: string,
  input: {
    code?: string;
    nameBg?: string;
    nameEn?: string;
    startTime?: string;
    endTime?: string;
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<ShiftRow> {
  return apiPatch(`/shifts/${id}`, input);
}

/** Employee→shift assignments for one hotel calendar date. */
export async function fetchShiftRoster(hotelDate: string): Promise<ShiftRoster> {
  return apiGet(`/shifts/roster${buildQuery({ hotelDate })}`);
}

/** Replace the full roster for a hotel date (PUT — not incremental). */
export async function saveShiftRoster(input: {
  hotelDate: string;
  entries: Array<{ employeeId: string; shiftId: string }>;
}): Promise<ShiftRoster> {
  const res = await apiFetch(`${API_BASE}/shifts/roster`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}
