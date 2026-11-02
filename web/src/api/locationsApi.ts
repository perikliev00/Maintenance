/**
 * Rooms, common areas, and location catalog REST helpers.
 */
import { API_BASE, apiFetch, apiGet, apiPatch, apiPost, authHeaders, buildQuery, parseJson } from "./http";

/** Location row as returned by room/common-area boards (includes readiness). */
export type Room = {
  id: string;
  floorId?: string;
  number: string;
  kind?: "room" | "common_area";
  floor: number;
  floorName: string;
  building: string;
  buildingCode: string;
  catalogStatus: string;
  occupancy: string;
  cleaningStatus: string;
  serviceStatus: string;
  sector?: {
    id: string;
    code: string;
    nameBg: string;
    nameEn: string;
  } | null;
  readiness: "ready" | "not_ready" | "needs_check";
  readinessReasons: string[];
  blockingIssues: Array<{
    id: string;
    title: string;
    category: string;
    priority: string;
    status: string;
  }>;
  /** Authoritative open blocking ticket total (preview may be truncated). */
  blockingIssueCount?: number;
  /** Authoritative open non-blocking ticket total. */
  nonBlockingIssueCount?: number;
  activeTask: {
    id: string;
    status: string;
    priority: string;
    dueAt: string | null;
    version: number;
    reassignReason: string | null;
    assignee: { id: string; fullName: string; employeeNumber: string } | null;
    runningSession: {
      id: string;
      startedAt: string;
      employeeId: string;
    } | null;
    lastCompletedSession: {
      id: string;
      finishedAt: string | null;
      notes: string | null;
      employee: { id: string; fullName: string; employeeNumber: string };
    } | null;
    lastInspection: {
      id: string;
      result: string;
      findings: string | null;
      inspectedAt: string;
      inspector: { id: string; fullName: string; employeeNumber: string };
    } | null;
  } | null;
};

export type LocationHierarchyBuilding = {
  id: string;
  name: string;
  code: string;
  floors: Array<{ id: string; number: number; name: string }>;
};

export type LocationOccupancy = "vacant" | "occupied" | "unknown";
export type LocationServiceStatus =
  | "in_service"
  | "out_of_service"
  | "unknown";
export type LocationKind = "room" | "common_area";

/** Load the whole scoped board so client filters/selectors never hide later pages. */
async function fetchActiveLocations(path: string, init?: { signal?: AbortSignal }): Promise<Room[]> {
  const rows = new Map<string, Room>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    init?.signal?.throwIfAborted();
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const res = await apiFetch(`${API_BASE}${path}${query}`, {
      headers: authHeaders(), signal: init?.signal,
    });
    const page = await parseJson<Room[]>(res);
    for (const row of page) rows.set(row.id, row);
    cursor = res.headers.get("X-Next-Cursor");
    if (res.headers.get("X-Result-Truncated") === "1" && !cursor) {
      throw new Error("Location list is incomplete; refresh after updating the server");
    }
    if (cursor && seenCursors.has(cursor)) throw new Error("Location pagination did not advance");
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return [...rows.values()];
}

/** Guest-room board rows (readiness + active cleaning task). Abortable. */
export async function fetchRooms(init?: { signal?: AbortSignal }): Promise<Room[]> {
  return fetchActiveLocations("/rooms", init);
}

/** Common-area board rows (same shape as rooms). Abortable. */
export async function fetchCommonAreas(init?: {
  signal?: AbortSignal;
}): Promise<Room[]> {
  return fetchActiveLocations("/common-areas", init);
}

/** Mark a guest room dirty and rebind active cleaning work server-side. */
export async function markRoomDirty(roomId: string): Promise<Room> {
  return apiPost(`/rooms/${roomId}/mark-dirty`);
}

/** Mark a common area dirty (parallel endpoint to rooms). */
export async function markCommonAreaDirty(locationId: string): Promise<Room> {
  return apiPost(`/common-areas/${locationId}/mark-dirty`);
}

/** Building → floor tree for location create/edit pickers. */
export async function fetchLocationHierarchy(): Promise<
  LocationHierarchyBuilding[]
> {
  return apiGet("/locations/hierarchy");
}

export type LocationsCatalogPage = {
  items: Room[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/**
 * Server-paginated catalog for admin UI (rooms / common areas / picker).
 * Does not drain all pages — one PostgreSQL page per call.
 */
export async function fetchLocationsCatalogPage(params?: {
  kind?: LocationKind;
  includeArchived?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}): Promise<LocationsCatalogPage> {
  return apiGet(
    `/locations${buildQuery({
      paged: true,
      kind: params?.kind,
      includeArchived: params?.includeArchived || undefined,
      q: params?.q?.trim() || undefined,
      page: params?.page,
      pageSize: params?.pageSize,
    })}`,
    { signal: params?.signal },
  );
}

/** Create a location on a floor (room or common area). */
export async function createLocation(input: {
  floorId: string;
  number: string;
  kind?: LocationKind;
  occupancy?: LocationOccupancy;
  serviceStatus?: LocationServiceStatus;
}): Promise<Room> {
  return apiPost("/locations", input);
}

/** Patch location identity fields (floor / number / kind). */
export async function updateLocation(
  id: string,
  input: {
    floorId?: string;
    number?: string;
    kind?: LocationKind;
  },
): Promise<Room> {
  return apiPatch(`/locations/${id}`, input);
}

/** Soft-archive a location so it leaves operational boards. */
export async function archiveLocation(id: string): Promise<Room> {
  return apiPost(`/locations/${id}/archive`);
}

/** Restore a previously archived location. */
export async function restoreLocation(id: string): Promise<Room> {
  return apiPost(`/locations/${id}/restore`);
}

/** Set occupancy (vacant / occupied / unknown) with audit on the server. */
export async function setLocationOccupancy(
  id: string,
  occupancy: LocationOccupancy,
): Promise<Room> {
  return apiPatch(`/locations/${id}/occupancy`, { occupancy });
}

/** Set in-service / out-of-service / unknown. */
export async function setLocationServiceStatus(
  id: string,
  serviceStatus: LocationServiceStatus,
): Promise<Room> {
  return apiPatch(`/locations/${id}/service-status`, { serviceStatus });
}
