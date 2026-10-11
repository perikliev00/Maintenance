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

export async function fetchSectors(
  includeInactive = false,
): Promise<SectorRow[]> {
  const qs = includeInactive ? "?includeInactive=true" : "";
  const res = await apiFetch(`${API_BASE}/sectors${qs}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function fetchMySectors(): Promise<MySectorsResponse> {
  const res = await apiFetch(`${API_BASE}/sectors/mine`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function createSector(input: {
  code: string;
  nameBg: string;
  nameEn: string;
  primarySupervisorEmployeeId?: string | null;
  locationIds?: string[];
  isActive?: boolean;
}): Promise<SectorRow> {
  const res = await apiFetch(`${API_BASE}/sectors`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

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
  const res = await apiFetch(`${API_BASE}/sectors/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function setSectorLocations(
  id: string,
  locationIds: string[],
): Promise<SectorRow> {
  const res = await apiFetch(`${API_BASE}/sectors/${id}/locations`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ locationIds }),
  });
  return parseJson(res);
}
