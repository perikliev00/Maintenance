import type { Panel } from "./capabilities";
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  locationId: string | null;
  payload: {
    panel?: Panel;
    ticketId?: string;
    taskId?: string;
    locationId?: string;
    locationNumber?: string;
    adjustmentId?: string;
    sessionId?: string;
  } | null;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
  actorEmployeeId: string | null;
  unread: boolean;
  deliveries: Array<{
    channel: "in_app" | "email" | "device_push";
    status: string;
    attemptedAt: string;
    deliveredAt: string | null;
    error: string | null;
  }>;
};

export async function listNotifications(params?: {
  unread?: boolean;
  cursor?: string;
  limit?: number;
}): Promise<{ items: AppNotification[]; nextCursor: string | null }> {
  const search = new URLSearchParams();
  if (params?.unread) search.set("unread", "1");
  if (params?.cursor) search.set("cursor", params.cursor);
  if (params?.limit != null) search.set("limit", String(params.limit));
  const qs = search.toString();
  const res = await apiFetch(
    `${API_BASE}/notifications${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

export async function fetchNotificationUnreadCount(): Promise<{
  count: number;
}> {
  const res = await apiFetch(`${API_BASE}/notifications/unread-count`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function markNotificationRead(
  id: string,
): Promise<AppNotification> {
  const res = await apiFetch(`${API_BASE}/notifications/${id}/read`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function markAllNotificationsRead(): Promise<{
  updated: number;
}> {
  const res = await apiFetch(`${API_BASE}/notifications/read-all`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function dismissNotification(
  id: string,
): Promise<AppNotification> {
  const res = await apiFetch(`${API_BASE}/notifications/${id}/dismiss`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}
