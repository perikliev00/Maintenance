/** In-app notification inbox, unread count, read/dismiss mutations. */
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

/**
 * Paginated inbox list; pass `unread: true` to filter to unread only.
 * Use `nextCursor` from the prior page for infinite scroll.
 */
export async function listNotifications(params?: {
  unread?: boolean;
  cursor?: string;
  limit?: number;
}): Promise<{ items: AppNotification[]; nextCursor: string | null }> {
  // Optional filters; empty query returns the default page.
  const search = new URLSearchParams();
  // Branch: conditional gate.
  if (params?.unread) search.set("unread", "1");
  // Branch: conditional gate.
  if (params?.cursor) search.set("cursor", params.cursor);
  // Branch: conditional gate.
  if (params?.limit != null) search.set("limit", String(params.limit));
  // Optional query suffix.
  const qs = search.toString();
  // Authenticated HTTP request.
  const res = await apiFetch(
    `${API_BASE}/notifications${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  // Return value / early exit.
  return parseJson(res);
}

/** Lightweight badge count (avoids fetching the full inbox). */
export async function fetchNotificationUnreadCount(): Promise<{
  count: number;
}> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/notifications/unread-count`, {
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Mark one notification read; returns the updated row. */
export async function markNotificationRead(
  id: string,
): Promise<AppNotification> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/notifications/${id}/read`, {
    method: "POST",
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Mark every visible notification read; returns how many rows changed. */
export async function markAllNotificationsRead(): Promise<{
  updated: number;
}> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/notifications/read-all`, {
    method: "POST",
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Soft-dismiss one notification from the inbox (still stored server-side). */
export async function dismissNotification(
  id: string,
): Promise<AppNotification> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/notifications/${id}/dismiss`, {
    method: "POST",
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}
