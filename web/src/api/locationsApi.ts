import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

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

export async function fetchRooms(init?: { signal?: AbortSignal }): Promise<Room[]> {
  const res = await apiFetch(`${API_BASE}/rooms`, {
    headers: authHeaders(),
    signal: init?.signal,
  });
  return parseJson(res);
}

export async function fetchCommonAreas(init?: {
  signal?: AbortSignal;
}): Promise<Room[]> {
  const res = await apiFetch(`${API_BASE}/common-areas`, {
    headers: authHeaders(),
    signal: init?.signal,
  });
  return parseJson(res);
}

export async function markRoomDirty(roomId: string): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/rooms/${roomId}/mark-dirty`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function markCommonAreaDirty(locationId: string): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/common-areas/${locationId}/mark-dirty`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function fetchLocationHierarchy(): Promise<
  LocationHierarchyBuilding[]
> {
  const res = await apiFetch(`${API_BASE}/locations/hierarchy`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function fetchLocationsCatalog(params?: {
  kind?: LocationKind;
  includeArchived?: boolean;
}): Promise<Room[]> {
  const search = new URLSearchParams();
  if (params?.kind) search.set("kind", params.kind);
  if (params?.includeArchived) search.set("includeArchived", "true");
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/locations${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function createLocation(input: {
  floorId: string;
  number: string;
  kind?: LocationKind;
  occupancy?: LocationOccupancy;
  serviceStatus?: LocationServiceStatus;
}): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/locations`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function updateLocation(
  id: string,
  input: {
    floorId?: string;
    number?: string;
    kind?: LocationKind;
  },
): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/locations/${id}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function archiveLocation(id: string): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/locations/${id}/archive`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function restoreLocation(id: string): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/locations/${id}/restore`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function setLocationOccupancy(
  id: string,
  occupancy: LocationOccupancy,
): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/locations/${id}/occupancy`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ occupancy }),
  });
  return parseJson(res);
}

export async function setLocationServiceStatus(
  id: string,
  serviceStatus: LocationServiceStatus,
): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/locations/${id}/service-status`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ serviceStatus }),
  });
  return parseJson(res);
}

export async function fetchLocationQr(
  locationId: string,
): Promise<LocationQrPayload> {
  const res = await apiFetch(`${API_BASE}/locations/${locationId}/qr`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function resolveLocationByQr(
  token: string,
): Promise<{ location: Room; qr: LocationQrPayload }> {
  const res = await apiFetch(
    `${API_BASE}/locations/by-qr/${encodeURIComponent(token)}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

export function roomQrImageUrl(scanUrl: string, size = 200): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(scanUrl)}`;
}

export function roomQrScanUrl(qrToken: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/#/room-qr/${qrToken}`;
}
