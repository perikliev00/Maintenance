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

export async function fetchShifts(includeInactive = false): Promise<ShiftRow[]> {
  const qs = includeInactive ? "?includeInactive=true" : "";
  const res = await apiFetch(`${API_BASE}/shifts${qs}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function createShift(input: {
  code: string;
  nameBg: string;
  nameEn: string;
  startTime: string;
  endTime: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<ShiftRow> {
  const res = await apiFetch(`${API_BASE}/shifts`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

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
  const res = await apiFetch(`${API_BASE}/shifts/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function fetchShiftRoster(hotelDate: string): Promise<ShiftRoster> {
  const res = await apiFetch(
    `${API_BASE}/shifts/roster?hotelDate=${encodeURIComponent(hotelDate)}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

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
