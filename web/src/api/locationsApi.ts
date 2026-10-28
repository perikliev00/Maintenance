/**
 * Rooms, common areas, and location catalog REST helpers.
 */
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

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
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/rooms/${roomId}/mark-dirty`, {
    method: "POST",
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Mark a common area dirty (parallel endpoint to rooms). */
export async function markCommonAreaDirty(locationId: string): Promise<Room> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/common-areas/${locationId}/mark-dirty`, {
    method: "POST",
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Building → floor tree for location create/edit pickers. */
export async function fetchLocationHierarchy(): Promise<
  LocationHierarchyBuilding[]
> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/locations/hierarchy`, {
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Flat location catalog; optional kind filter and archived include. */
export async function fetchLocationsCatalog(params?: {
  kind?: LocationKind;
  includeArchived?: boolean;
}): Promise<Room[]> {
  const search = new URLSearchParams();
  // Branch: conditional gate.
  if (params?.kind) search.set("kind", params.kind);
  // Branch: conditional gate.
  if (params?.includeArchived) search.set("includeArchived", "true");
  // Optional query suffix.
  const qs = search.toString();
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/locations${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Create a location on a floor (room or common area). */
export async function createLocation(input: {
  floorId: string;
  number: string;
  kind?: LocationKind;
  occupancy?: LocationOccupancy;
  serviceStatus?: LocationServiceStatus;
}): Promise<Room> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/locations`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    // Serialize request body.
    body: JSON.stringify(input),
  });
  // Return value / early exit.
  return parseJson(res);
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
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/locations/${id}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    // Serialize request body.
    body: JSON.stringify(input),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Soft-archive a location so it leaves operational boards. */
export async function archiveLocation(id: string): Promise<Room> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/locations/${id}/archive`, {
    method: "POST",
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Restore a previously archived location. */
export async function restoreLocation(id: string): Promise<Room> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/locations/${id}/restore`, {
    method: "POST",
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Set occupancy (vacant / occupied / unknown) with audit on the server. */
export async function setLocationOccupancy(
  id: string,
  occupancy: LocationOccupancy,
): Promise<Room> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/locations/${id}/occupancy`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    // Serialize request body.
    body: JSON.stringify({ occupancy }),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Set in-service / out-of-service / unknown. */
export async function setLocationServiceStatus(
  id: string,
  serviceStatus: LocationServiceStatus,
): Promise<Room> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/locations/${id}/service-status`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    // Serialize request body.
    body: JSON.stringify({ serviceStatus }),
  });
  // Return value / early exit.
  return parseJson(res);
}
