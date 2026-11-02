/** Housekeeping/maintenance sector CRUD and "my sectors" for supervisors. */
import { apiGet, apiPatch, apiPost, buildQuery } from "./http";

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
  return apiGet(`/sectors${buildQuery({ includeInactive: includeInactive || undefined })}`);
}

/** Sectors the current user supervises (for scoped housekeeping views). */
export async function fetchMySectors(): Promise<MySectorsResponse> {
  return apiGet("/sectors/mine");
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
  return apiPost("/sectors", input);
}

/**
 * Atomic sector save: metadata and optional membership in one request.
 * Pass `expectedVersion` from the loaded row for optimistic concurrency.
 */
export async function updateSector(
  id: string,
  input: SectorSaveInput,
): Promise<SectorRow> {
  return apiPatch(`/sectors/${id}`, input);
}
