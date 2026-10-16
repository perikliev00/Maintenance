/**
 * Rooms, common areas, and location catalog REST helpers.
 * QR helpers build client-side scan URLs / image links for printed labels.
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
  qrToken?: string;
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

export type LocationQrPayload = {
  locationId: string;
  qrToken: string;
  scanUrl: string;
  label: string;
  kind: string;
  buildingCode: string;
  floor: number;
  number: string;
};

/** Guest-room board rows (readiness + active cleaning task). Abortable. */
export async function fetchRooms(init?: { signal?: AbortSignal }): Promise<Room[]> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/rooms`, {
    headers: authHeaders(),
    signal: init?.signal,
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Common-area board rows (same shape as rooms). Abortable. */
export async function fetchCommonAreas(init?: {
  signal?: AbortSignal;
}): Promise<Room[]> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/common-areas`, {
    headers: authHeaders(),
    signal: init?.signal,
  });
  // Return value / early exit.
  return parseJson(res);
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

/** Resolve a printed QR token to a location (authenticated). */
export async function resolveLocationByQr(
  token: string,
): Promise<{ location: Room; qr: LocationQrPayload }> {
  // Authenticated HTTP request.
  const res = await apiFetch(
    // Encode path/query segment.
    `${API_BASE}/locations/by-qr/${encodeURIComponent(token)}`,
    { headers: authHeaders() },
  );
  // Return value / early exit.
  return parseJson(res);
}

/** External QR image URL for print/preview (encodes the scan deep-link). */
export function roomQrImageUrl(scanUrl: string, size = 200): string {
  // Third-party image service — scanUrl must already be the deep-link staff open.
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(scanUrl)}`;
}

/** In-app hash route staff open when scanning a room QR. */
export function roomQrScanUrl(qrToken: string): string {
  // SSR-safe: empty origin when `window` is missing.
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  // Return value / early exit.
  return `${origin}/#/room-qr/${qrToken}`;
}
