/** In-app notification inbox, unread count, read/dismiss mutations. */
import type { Panel } from "./capabilities";
import { apiGet, apiPost, buildQuery } from "./http";

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
  return apiGet(
    `/notifications${buildQuery({
      unread: params?.unread ? "1" : undefined,
      cursor: params?.cursor,
      limit: params?.limit,
    })}`,
  );
}

/** Lightweight badge count (avoids fetching the full inbox). */
export async function fetchNotificationUnreadCount(): Promise<{
  count: number;
}> {
  return apiGet("/notifications/unread-count");
}

/** Mark one notification read; returns the updated row. */
export async function markNotificationRead(
  id: string,
): Promise<AppNotification> {
  return apiPost(`/notifications/${id}/read`);
}

/** Mark every visible notification read; returns how many rows changed. */
export async function markAllNotificationsRead(): Promise<{
  updated: number;
}> {
  return apiPost("/notifications/read-all");
}

/** Soft-dismiss one notification from the inbox (still stored server-side). */
export async function dismissNotification(
  id: string,
): Promise<AppNotification> {
  return apiPost(`/notifications/${id}/dismiss`);
}
