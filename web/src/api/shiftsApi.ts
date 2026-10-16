/** Shift definitions and per-day employee roster assignment. */
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

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
  // Optional query suffix.
  const qs = includeInactive ? "?includeInactive=true" : "";
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/shifts${qs}`, {
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
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
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/shifts`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(input),
  });
  // Return value / early exit.
  return parseJson(res);
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
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/shifts/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(input),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Employee→shift assignments for one hotel calendar date. */
export async function fetchShiftRoster(hotelDate: string): Promise<ShiftRoster> {
  // Authenticated HTTP request.
  const res = await apiFetch(
    // Encode path/query segment.
    `${API_BASE}/shifts/roster?hotelDate=${encodeURIComponent(hotelDate)}`,
    { headers: authHeaders() },
  );
  // Return value / early exit.
  return parseJson(res);
}

/** Replace the full roster for a hotel date (PUT — not incremental). */
export async function saveShiftRoster(input: {
  hotelDate: string;
  entries: Array<{ employeeId: string; shiftId: string }>;
}): Promise<ShiftRoster> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/shifts/roster`, {
    method: "PUT",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(input),
  });
  // Return value / early exit.
  return parseJson(res);
}
