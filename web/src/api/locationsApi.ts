/**
 * Rooms, common areas, and location catalog REST helpers.
 */
import { API_BASE, apiFetch, apiGet, apiPatch, apiPost, authHeaders, buildQuery, parseJson } from "./http";

/** Location row as returned by room/common-area boards (includes readiness). */
export type Room = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  floorId?: string;
  // Field/property in this shape.
  number: string;
  // Field/property in this shape.
  kind?: "room" | "common_area";
  // Field/property in this shape.
  floor: number;
  // Field/property in this shape.
  floorName: string;
  // Field/property in this shape.
  building: string;
  // Field/property in this shape.
  buildingCode: string;
  // Field/property in this shape.
  catalogStatus: string;
  // Field/property in this shape.
  occupancy: string;
  // Field/property in this shape.
  cleaningStatus: string;
  // Field/property in this shape.
  serviceStatus: string;
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
  readiness: "ready" | "not_ready" | "needs_check";
  // Field/property in this shape.
  readinessReasons: string[];
  // Field/property in this shape.
  blockingIssues: Array<{
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    title: string;
    // Field/property in this shape.
    category: string;
    // Field/property in this shape.
    priority: string;
    // Field/property in this shape.
    status: string;
  // Close multi-line construct with trailing syntax.
  }>;
  /** Authoritative open blocking ticket total (preview may be truncated). */
  blockingIssueCount?: number;
  /** Authoritative open non-blocking ticket total. */
  nonBlockingIssueCount?: number;
  // Field/property in this shape.
  activeTask: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    status: string;
    // Field/property in this shape.
    priority: string;
    // Field/property in this shape.
    dueAt: string | null;
    // Field/property in this shape.
    version: number;
    // Field/property in this shape.
    reassignReason: string | null;
    // Field/property in this shape.
    assignee: { id: string; fullName: string; employeeNumber: string } | null;
    // Field/property in this shape.
    runningSession: {
      // Field/property in this shape.
      id: string;
      // Field/property in this shape.
      startedAt: string;
      // Field/property in this shape.
      employeeId: string;
    // Close multi-line construct with trailing syntax.
    } | null;
    // Field/property in this shape.
    lastCompletedSession: {
      // Field/property in this shape.
      id: string;
      // Field/property in this shape.
      finishedAt: string | null;
      // Field/property in this shape.
      notes: string | null;
      // Field/property in this shape.
      employee: { id: string; fullName: string; employeeNumber: string };
    // Close multi-line construct with trailing syntax.
    } | null;
    // Field/property in this shape.
    lastInspection: {
      // Field/property in this shape.
      id: string;
      // Field/property in this shape.
      result: string;
      // Field/property in this shape.
      findings: string | null;
      // Field/property in this shape.
      inspectedAt: string;
      // Field/property in this shape.
      inspector: { id: string; fullName: string; employeeNumber: string };
    // Close multi-line construct with trailing syntax.
    } | null;
  // Close multi-line construct with trailing syntax.
  } | null;
};

// Export type alias for consumers.
export type LocationHierarchyBuilding = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  name: string;
  // Field/property in this shape.
  code: string;
  // Field/property in this shape.
  floors: Array<{ id: string; number: number; name: string }>;
};

// Export type alias for consumers.
export type LocationOccupancy = "vacant" | "occupied" | "unknown";
// Export type alias for consumers.
export type LocationServiceStatus =
  // Union/intersection type member.
  | "in_service"
  // Union/intersection type member.
  | "out_of_service"
  // Union/intersection type member.
  | "unknown";
// Export type alias for consumers.
export type LocationKind = "room" | "common_area";

/** Load the whole scoped board so client filters/selectors never hide later pages. */
async function fetchActiveLocations(path: string, init?: { signal?: AbortSignal }): Promise<Room[]> {
  // Local constant binding.
  const rows = new Map<string, Room>();
  // Local constant binding.
  const seenCursors = new Set<string>();
  // Mutable local binding.
  let cursor: string | null = null;
  // Open multi-line construct.
  do {
    // Invoke helper or pass arguments.
    init?.signal?.throwIfAborted();
    // Local constant binding.
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    // Local constant binding.
    const res = await apiFetch(`${API_BASE}${path}${query}`, {
      // Field/property in this shape.
      headers: authHeaders(), signal: init?.signal,
    });
    // Local constant binding.
    const page = await parseJson<Room[]>(res);
    // Iterate collection / range.
    for (const row of page) rows.set(row.id, row);
    // Assign value for subsequent use.
    cursor = res.headers.get("X-Next-Cursor");
    // Conditional branch for this case.
    if (res.headers.get("X-Result-Truncated") === "1" && !cursor) {
      // Abort with an error for the caller.
      throw new Error("Location list is incomplete; refresh after updating the server");
    }
    // Conditional branch for this case.
    if (cursor && seenCursors.has(cursor)) throw new Error("Location pagination did not advance");
    // Conditional branch for this case.
    if (cursor) seenCursors.add(cursor);
  // Invoke helper or pass arguments.
  } while (cursor);
  // Return computed result to caller.
  return [...rows.values()];
}

/** Guest-room board rows (readiness + active cleaning task). Abortable. */
export async function fetchRooms(init?: { signal?: AbortSignal }): Promise<Room[]> {
  // Return computed result to caller.
  return fetchActiveLocations("/rooms", init);
}

/** Common-area board rows (same shape as rooms). Abortable. */
export async function fetchCommonAreas(init?: {
  // Field/property in this shape.
  signal?: AbortSignal;
// Open multi-line construct.
}): Promise<Room[]> {
  // Return computed result to caller.
  return fetchActiveLocations("/common-areas", init);
}

/** Mark a guest room dirty and rebind active cleaning work server-side. */
export async function markRoomDirty(roomId: string): Promise<Room> {
  // Return computed result to caller.
  return apiPost(`/rooms/${roomId}/mark-dirty`);
}

/** Mark a common area dirty (parallel endpoint to rooms). */
export async function markCommonAreaDirty(locationId: string): Promise<Room> {
  // Return computed result to caller.
  return apiPost(`/common-areas/${locationId}/mark-dirty`);
}

/** Building → floor tree for location create/edit pickers. */
export async function fetchLocationHierarchy(): Promise<
  // Continue module logic.
  LocationHierarchyBuilding[]
// Open multi-line construct.
> {
  // Return computed result to caller.
  return apiGet("/locations/hierarchy");
}

// Export type alias for consumers.
export type LocationsCatalogPage = {
  // Field/property in this shape.
  items: Room[];
  // Field/property in this shape.
  page: number;
  // Field/property in this shape.
  pageSize: number;
  // Field/property in this shape.
  total: number;
  // Field/property in this shape.
  totalPages: number;
};

/**
 * Server-paginated catalog for admin UI (rooms / common areas / picker).
 * Does not drain all pages — one PostgreSQL page per call.
 */
export async function fetchLocationsCatalogPage(params?: {
  // Field/property in this shape.
  kind?: LocationKind;
  // Field/property in this shape.
  includeArchived?: boolean;
  // Field/property in this shape.
  q?: string;
  // Field/property in this shape.
  page?: number;
  // Field/property in this shape.
  pageSize?: number;
  // Field/property in this shape.
  signal?: AbortSignal;
// Open multi-line construct.
}): Promise<LocationsCatalogPage> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/locations${buildQuery({
      // Field/property in this shape.
      paged: true,
      // Field/property in this shape.
      kind: params?.kind,
      // Field/property in this shape.
      includeArchived: params?.includeArchived || undefined,
      // Field/property in this shape.
      q: params?.q?.trim() || undefined,
      // Field/property in this shape.
      page: params?.page,
      // Field/property in this shape.
      pageSize: params?.pageSize,
    // Continue multi-line list/arguments.
    })}`,
    // Continue multi-line list/arguments.
    { signal: params?.signal },
  );
}

/** Create a location on a floor (room or common area). */
export async function createLocation(input: {
  // Field/property in this shape.
  floorId: string;
  // Field/property in this shape.
  number: string;
  // Field/property in this shape.
  kind?: LocationKind;
  // Field/property in this shape.
  occupancy?: LocationOccupancy;
  // Field/property in this shape.
  serviceStatus?: LocationServiceStatus;
// Open multi-line construct.
}): Promise<Room> {
  // Return computed result to caller.
  return apiPost("/locations", input);
}

/** Patch location identity fields (floor / number / kind). */
export async function updateLocation(
  // Field/property in this shape.
  id: string,
  // Field/property in this shape.
  input: {
    // Field/property in this shape.
    floorId?: string;
    // Field/property in this shape.
    number?: string;
    // Field/property in this shape.
    kind?: LocationKind;
  },
// Open multi-line construct.
): Promise<Room> {
  // Return computed result to caller.
  return apiPatch(`/locations/${id}`, input);
}

/** Soft-archive a location so it leaves operational boards. */
export async function archiveLocation(id: string): Promise<Room> {
  // Return computed result to caller.
  return apiPost(`/locations/${id}/archive`);
}

/** Restore a previously archived location. */
export async function restoreLocation(id: string): Promise<Room> {
  // Return computed result to caller.
  return apiPost(`/locations/${id}/restore`);
}

/** Set occupancy (vacant / occupied / unknown) with audit on the server. */
export async function setLocationOccupancy(
  // Field/property in this shape.
  id: string,
  // Field/property in this shape.
  occupancy: LocationOccupancy,
// Open multi-line construct.
): Promise<Room> {
  // Return computed result to caller.
  return apiPatch(`/locations/${id}/occupancy`, { occupancy });
}

/** Set in-service / out-of-service / unknown. */
export async function setLocationServiceStatus(
  // Field/property in this shape.
  id: string,
  // Field/property in this shape.
  serviceStatus: LocationServiceStatus,
// Open multi-line construct.
): Promise<Room> {
  // Return computed result to caller.
  return apiPatch(`/locations/${id}/service-status`, { serviceStatus });
}
