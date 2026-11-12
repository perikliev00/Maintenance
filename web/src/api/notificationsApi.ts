/** In-app notification inbox, unread count, read/dismiss mutations. */
import type { Panel } from "./capabilities";
// Import dependency used by this module.
import { apiGet, apiPost, buildQuery } from "./http";

// Export type alias for consumers.
export type AppNotification = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  type: string;
  // Field/property in this shape.
  title: string;
  // Field/property in this shape.
  body: string;
  // Field/property in this shape.
  entityType: string;
  // Field/property in this shape.
  entityId: string;
  // Field/property in this shape.
  locationId: string | null;
  // Field/property in this shape.
  payload: {
    // Field/property in this shape.
    panel?: Panel;
    // Field/property in this shape.
    ticketId?: string;
    // Field/property in this shape.
    taskId?: string;
    // Field/property in this shape.
    locationId?: string;
    // Field/property in this shape.
    locationNumber?: string;
    // Field/property in this shape.
    adjustmentId?: string;
    // Field/property in this shape.
    sessionId?: string;
  // Close multi-line construct with trailing syntax.
  } | null;
  // Field/property in this shape.
  createdAt: string;
  // Field/property in this shape.
  readAt: string | null;
  // Field/property in this shape.
  dismissedAt: string | null;
  // Field/property in this shape.
  actorEmployeeId: string | null;
  // Field/property in this shape.
  unread: boolean;
  // Field/property in this shape.
  deliveries: Array<{
    // Field/property in this shape.
    channel: "in_app" | "email" | "device_push";
    // Field/property in this shape.
    status: string;
    // Field/property in this shape.
    attemptedAt: string;
    // Field/property in this shape.
    deliveredAt: string | null;
    // Field/property in this shape.
    error: string | null;
  // Close multi-line construct with trailing syntax.
  }>;
};

/**
 * Paginated inbox list; pass `unread: true` to filter to unread only.
 * Use `nextCursor` from the prior page for infinite scroll.
 */
export async function listNotifications(params?: {
  // Field/property in this shape.
  unread?: boolean;
  // Field/property in this shape.
  cursor?: string;
  // Field/property in this shape.
  limit?: number;
// Open multi-line construct.
}): Promise<{ items: AppNotification[]; nextCursor: string | null }> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/notifications${buildQuery({
      // Field/property in this shape.
      unread: params?.unread ? "1" : undefined,
      // Field/property in this shape.
      cursor: params?.cursor,
      // Field/property in this shape.
      limit: params?.limit,
    // Continue multi-line list/arguments.
    })}`,
  );
}

/** Lightweight badge count (avoids fetching the full inbox). */
export async function fetchNotificationUnreadCount(): Promise<{
  // Field/property in this shape.
  count: number;
// Open multi-line construct.
}> {
  // Return computed result to caller.
  return apiGet("/notifications/unread-count");
}

/** Mark one notification read; returns the updated row. */
export async function markNotificationRead(
  // Field/property in this shape.
  id: string,
// Open multi-line construct.
): Promise<AppNotification> {
  // Return computed result to caller.
  return apiPost(`/notifications/${id}/read`);
}

/** Mark every visible notification read; returns how many rows changed. */
export async function markAllNotificationsRead(): Promise<{
  // Field/property in this shape.
  updated: number;
// Open multi-line construct.
}> {
  // Return computed result to caller.
  return apiPost("/notifications/read-all");
}

/** Soft-dismiss one notification from the inbox (still stored server-side). */
export async function dismissNotification(
  // Field/property in this shape.
  id: string,
// Open multi-line construct.
): Promise<AppNotification> {
  // Return computed result to caller.
  return apiPost(`/notifications/${id}/dismiss`);
}
