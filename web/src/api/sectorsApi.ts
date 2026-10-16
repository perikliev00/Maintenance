/** Housekeeping/maintenance sector CRUD and "my sectors" for supervisors. */
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

export type SectorRow = {
  id: string;
  propertyId: string;
  code: string;
  nameBg: string;
  nameEn: string;
  isActive: boolean;
  primarySupervisor: {
    id: string;
    fullName: string;
    employeeNumber: string;
  } | null;
  locationCount: number;
  locationIds: string[];
  locations: Array<{
    id: string;
    number: string;
    kind: string;
    floor: number;
    buildingCode: string;
    building: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type MySectorsResponse = {
  count: number;
  sectors: Array<{
    id: string;
    code: string;
    nameBg: string;
    nameEn: string;
    locationCount: number;
  }>;
};

/** List sectors; pass `includeInactive` to show archived ones in admin UI. */
export async function fetchSectors(
  includeInactive = false,
): Promise<SectorRow[]> {
  // Optional query suffix.
  const qs = includeInactive ? "?includeInactive=true" : "";
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/sectors${qs}`, {
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Sectors the current user supervises (for scoped housekeeping views). */
export async function fetchMySectors(): Promise<MySectorsResponse> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/sectors/mine`, {
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Create a sector; optional initial location membership and supervisor. */
export async function createSector(input: {
  code: string;
  nameBg: string;
  nameEn: string;
  primarySupervisorEmployeeId?: string | null;
  locationIds?: string[];
  isActive?: boolean;
}): Promise<SectorRow> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/sectors`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(input),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Patch sector metadata (not location membership — use setSectorLocations). */
export async function updateSector(
  id: string,
  input: {
    code?: string;
    nameBg?: string;
    nameEn?: string;
    primarySupervisorEmployeeId?: string | null;
    isActive?: boolean;
  },
): Promise<SectorRow> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/sectors/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(input),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Replace the full location membership set for a sector (PUT, not patch). */
export async function setSectorLocations(
  id: string,
  locationIds: string[],
): Promise<SectorRow> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/sectors/${id}/locations`, {
    method: "PUT",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify({ locationIds }),
  });
  // Return value / early exit.
  return parseJson(res);
}
