import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

export async function syncPush(commands: Array<{
  commandId: string;
  type: string;
  payload: Record<string, unknown>;
  clientTime?: string;
}>, deviceId?: string) {
  const res = await apiFetch(`${API_BASE}/sync/push`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ commands, deviceId }),
  });
  return parseJson(res);
}

export async function syncPull(params?: {
  since?: string;
  hotelDate?: string;
  deviceId?: string;
}) {
  const search = new URLSearchParams();
  if (params?.since) search.set("since", params.since);
  if (params?.hotelDate) search.set("hotelDate", params.hotelDate);
  if (params?.deviceId) search.set("deviceId", params.deviceId);
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/sync/pull${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}
