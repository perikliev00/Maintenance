/** Housekeeping/maintenance sector CRUD and "my sectors" for supervisors. */
import { apiGet, apiPatch, apiPost, buildQuery } from "./http";

// Export type alias for consumers.
export type SectorLocationRef = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  number: string;
  // Field/property in this shape.
  kind: string;
  // Field/property in this shape.
  catalogStatus?: string;
  // Field/property in this shape.
  floor: number;
  // Field/property in this shape.
  buildingCode: string;
  // Field/property in this shape.
  building: string;
};

// Export type alias for consumers.
export type SectorRow = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  propertyId: string;
  // Field/property in this shape.
  code: string;
  // Field/property in this shape.
  nameBg: string;
  // Field/property in this shape.
  nameEn: string;
  // Field/property in this shape.
  isActive: boolean;
  // Field/property in this shape.
  version: number;
  // Field/property in this shape.
  primarySupervisor: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    fullName: string;
    // Field/property in this shape.
    employeeNumber: string;
  // Close multi-line construct with trailing syntax.
  } | null;
  // Field/property in this shape.
  locationCount: number;
  // Field/property in this shape.
  locationIds: string[];
  // Field/property in this shape.
  locations: SectorLocationRef[];
  // Field/property in this shape.
  createdAt: string;
  // Field/property in this shape.
  updatedAt: string;
};

// Export type alias for consumers.
export type MySectorsResponse = {
  // Field/property in this shape.
  count: number;
  // Field/property in this shape.
  sectors: Array<{
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    code: string;
    // Field/property in this shape.
    nameBg: string;
    // Field/property in this shape.
    nameEn: string;
    // Field/property in this shape.
    locationCount: number;
  // Close multi-line construct with trailing syntax.
  }>;
};

// Export type alias for consumers.
export type SectorSaveInput = {
  // Field/property in this shape.
  code?: string;
  // Field/property in this shape.
  nameBg?: string;
  // Field/property in this shape.
  nameEn?: string;
  // Field/property in this shape.
  primarySupervisorEmployeeId?: string | null;
  // Field/property in this shape.
  isActive?: boolean;
  // Field/property in this shape.
  locationIds?: string[];
  // Field/property in this shape.
  expectedVersion?: number;
};

/** List sectors; pass `includeInactive` to show archived ones in admin UI. */
export async function fetchSectors(
  // Assign value for subsequent use.
  includeInactive = false,
// Open multi-line construct.
): Promise<SectorRow[]> {
  // Return computed result to caller.
  return apiGet(`/sectors${buildQuery({ includeInactive: includeInactive || undefined })}`);
}

/** Sectors the current user supervises (for scoped housekeeping views). */
export async function fetchMySectors(): Promise<MySectorsResponse> {
  // Return computed result to caller.
  return apiGet("/sectors/mine");
}

/** Create a sector; optional initial location membership and supervisor. */
export async function createSector(input: {
  // Field/property in this shape.
  code: string;
  // Field/property in this shape.
  nameBg: string;
  // Field/property in this shape.
  nameEn: string;
  // Field/property in this shape.
  primarySupervisorEmployeeId?: string | null;
  // Field/property in this shape.
  locationIds?: string[];
  // Field/property in this shape.
  isActive?: boolean;
// Open multi-line construct.
}): Promise<SectorRow> {
  // Return computed result to caller.
  return apiPost("/sectors", input);
}

/**
 * Atomic sector save: metadata and optional membership in one request.
 * Pass `expectedVersion` from the loaded row for optimistic concurrency.
 */
export async function updateSector(
  // Field/property in this shape.
  id: string,
  // Field/property in this shape.
  input: SectorSaveInput,
// Open multi-line construct.
): Promise<SectorRow> {
  // Return computed result to caller.
  return apiPatch(`/sectors/${id}`, input);
}
