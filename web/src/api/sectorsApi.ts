/** Housekeeping/maintenance sector CRUD and "my sectors" for supervisors. */
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

export type SectorLocationRef = {
  id: string;
  number: string;
  kind: string;
  catalogStatus?: string;
  floor: number;
  buildingCode: string;
  building: string;
};

export type SectorRow = {
  id: string;
  propertyId: string;
  code: string;
  nameBg: string;
  nameEn: string;
  isActive: boolean;
  version: number;
  primarySupervisor: {
    id: string;
    fullName: string;
    employeeNumber: string;
  } | null;
  locationCount: number;
  locationIds: string[];
  locations: SectorLocationRef[];
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

export type SectorSaveInput = {
  code?: string;
  nameBg?: string;
  nameEn?: string;
  primarySupervisorEmployeeId?: string | null;
  isActive?: boolean;
  locationIds?: string[];
  expectedVersion?: number;
};

/** List sectors; pass `includeInactive` to show archived ones in admin UI. */
export async function fetchSectors(
  includeInactive = false,
): Promise<SectorRow[]> {
  const qs = includeInactive ? "?includeInactive=true" : "";
  const res = await apiFetch(`${API_BASE}/sectors${qs}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

/** Sectors the current user supervises (for scoped housekeeping views). */
export async function fetchMySectors(): Promise<MySectorsResponse> {
  const res = await apiFetch(`${API_BASE}/sectors/mine`, {
    headers: authHeaders(),
  });
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
  const res = await apiFetch(`${API_BASE}/sectors`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

/**
 * Atomic sector save: metadata and optional membership in one request.
 * Pass `expectedVersion` from the loaded row for optimistic concurrency.
 */
export async function updateSector(
  id: string,
  input: SectorSaveInput,
): Promise<SectorRow> {
  const res = await apiFetch(`${API_BASE}/sectors/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}
