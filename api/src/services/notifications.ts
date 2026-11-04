/**
 * In-app notification create/list/read/dismiss plus recipient resolution by role grant.
 * Email/push channels are stubbed until adapters exist; device_push stays not_configured.
 */
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { z } from "zod/v3";
import { prisma } from "../db";
import { AppError } from "../errors";
import { publish } from "../events/bus";
import type { Action } from "../permissions";
import { isP2002 } from "./db/prismaErrors";
import { sectorSnapshotForLocation } from "./dataScope";
import { canPerform } from "./roleGrants";
import { getSetting } from "./settings";

export type NotificationPanel =
  | "repairs"
  | "mywork"
  | "attendance"
  | "live"
  | "rooms"
  | "common"
  | "cleaning"
  | "home";

const notificationPanelSchema = z.enum([
  "repairs",
  "mywork",
  "attendance",
  "live",
  "rooms",
  "common",
  "cleaning",
  "home",
]);

/** Soft decoder for persisted notification JSON (malformed → null, never cast). */
const storedNotificationPayloadSchema = z
  .object({
    panel: notificationPanelSchema.optional(),
    ticketId: z.string().optional(),
    taskId: z.string().optional(),
    locationId: z.string().optional(),
    locationNumber: z.string().optional(),
    adjustmentId: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .passthrough();

export type NotificationPayload = z.infer<typeof storedNotificationPayloadSchema>;

export function decodeStoredNotificationPayload(
  raw: unknown,
): NotificationPayload | null {
  if (raw == null) return null;
  const parsed = storedNotificationPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type CreateNotificationInput = {
  type: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  locationId?: string | null;
  actorEmployeeId?: string | null;
  recipientEmployeeIds: string[];
  /** Stable key fragment; combined with type+entityId per recipient. */
  dedupeKey: string;
  payload?: NotificationPayload;
};

/**
 * Map a Prisma notification (+ optional deliveries) to the API DTO.
 * Derives `unread` from readAt/dismissedAt for the inbox badge.
 */
function formatNotification(row: {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  locationId: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
  readAt: Date | null;
  dismissedAt: Date | null;
  actorEmployeeId: string | null;
  deliveries?: Array<{
    channel: NotificationChannel;
    status: NotificationDeliveryStatus;
    attemptedAt: Date;
    deliveredAt: Date | null;
    error: string | null;
  }>;
}) {
  // ISO timestamps + derived unread flag for the inbox UI.
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    entityType: row.entityType,
    entityId: row.entityId,
    locationId: row.locationId,
    payload: decodeStoredNotificationPayload(row.payload),
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    actorEmployeeId: row.actorEmployeeId,
    // Unread means never read and not soft-dismissed.
    unread: !row.readAt && !row.dismissedAt,
    deliveries: (row.deliveries ?? []).map((d) => ({
      channel: d.channel,
      status: d.status,
      attemptedAt: d.attemptedAt.toISOString(),
      deliveredAt: d.deliveredAt?.toISOString() ?? null,
      error: d.error,
    })),
  };
}

export type FormattedNotification = ReturnType<typeof formatNotification>;

/**
 * Active users whose role grants include `action`. When locationId is set,
 * supervisors are limited to those whose sector covers that location.
 */
async function employeesWithAction(
  action: Action,
  opts: { locationId?: string | null } = {},
): Promise<string[]> {
  // All active users — role grants are checked in memory per role.
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { employeeId: true, role: true },
  });

  // When location-scoped, resolve which supervisors own active sectors for it.
  let sectorSupervisorIds: Set<string> | null = null;
  if (opts.locationId) {
    const memberships = await prisma.sectorLocation.findMany({
      where: {
        locationId: opts.locationId,
        sector: { isActive: true },
      },
      select: {
        sector: { select: { primarySupervisorEmployeeId: true } },
      },
    });
    sectorSupervisorIds = new Set(
      memberships
        .map((m) => m.sector.primarySupervisorEmployeeId)
        .filter((id): id is string => Boolean(id)),
    );
  }

  const allowed: string[] = [];
  for (const user of users) {
    // Skip roles that cannot perform the action.
    if (!(await canPerform(user.role, action))) continue;

    // Supervisors only receive location-scoped ops alerts for their sectors.
    if (
      opts.locationId &&
      user.role === Role.supervisor &&
      sectorSupervisorIds &&
      !sectorSupervisorIds.has(user.employeeId)
    ) {
      continue;
    }

    allowed.push(user.employeeId);
  }
  return allowed;
}

/**
 * Prefer sector primary supervisor; fall back to action holders in scope.
 * Deduplicates via Set so supervisor + grant overlap is returned once.
 */
export async function recipientsForLocationOps(
  locationId: string | null | undefined,
  action: Action,
): Promise<string[]> {
  const ids = new Set<string>();
  // Prefer the snapshotted primary supervisor for this location's sector.
  if (locationId) {
    const snap = await sectorSnapshotForLocation(locationId);
    // Only add when a primary supervisor is configured.
    if (snap.sectorSupervisorEmployeeId) {
      ids.add(snap.sectorSupervisorEmployeeId);
    }
  }
  // Union with everyone whose role grant allows the action (scoped).
  for (const id of await employeesWithAction(action, { locationId })) {
    ids.add(id);
  }
  return [...ids];
}

/**
 * All active employees whose role can perform `action` (no location filter).
 * Thin wrapper over {@link employeesWithAction} for hotel-wide alerts.
 */
export async function recipientsWithAction(action: Action): Promise<string[]> {
  // No locationId → supervisors are not sector-filtered.
  return employeesWithAction(action);
}

/**
 * Create in-app notifications for recipients. Email/push get delivery stubs only.
 * Dedupes on (recipientEmployeeId, dedupeKey). Never notifies the actor.
 */
export async function createNotifications(
  input: CreateNotificationInput,
): Promise<{ created: number; skipped: number }> {
  // Feature flag: in-app channel must be enabled in settings.
  const settings = await getSetting("notifications");
  if (!settings.in_app.enabled) {
    return { created: 0, skipped: input.recipientEmployeeIds.length };
  }

  // Never notify the actor; dedupe recipient list.
  const actorId = input.actorEmployeeId ?? null;
  const uniqueRecipients = [
    ...new Set(
      input.recipientEmployeeIds.filter(
        (id) => id && id !== actorId,
      ),
    ),
  ];
  // Nothing left after filtering actor / empties.
  if (uniqueRecipients.length === 0) {
    return { created: 0, skipped: 0 };
  }

  // Email adapter not wired yet — stub status when the channel is "enabled".
  const emailStatus = settings.email.enabled
    ? NotificationDeliveryStatus.not_configured
    : NotificationDeliveryStatus.skipped;
  // Push is always clamped not_configured in settings.
  const pushStatus = NotificationDeliveryStatus.not_configured;

  let created = 0;
  let skipped = 0;
  const notifiedRecipients: string[] = [];

  // One notification (+ delivery stubs) per recipient.
  for (const recipientEmployeeId of uniqueRecipients) {
    try {
      // Unique on (recipientEmployeeId, dedupeKey) for idempotent creates.
      const row = await prisma.notification.create({
        data: {
          recipientEmployeeId,
          actorEmployeeId: actorId,
          type: input.type,
          title: input.title,
          body: input.body,
          entityType: input.entityType,
          entityId: input.entityId,
          locationId: input.locationId ?? null,
          // Prisma.JsonNull when payload omitted (distinct from JSON null value).
          payload:
            input.payload === undefined
              ? Prisma.JsonNull
              : (input.payload as Prisma.InputJsonValue),
          dedupeKey: input.dedupeKey,
          // Three delivery rows: in-app delivered now; email/push stubbed.
          deliveries: {
            create: [
              {
                channel: NotificationChannel.in_app,
                status: NotificationDeliveryStatus.delivered,
                deliveredAt: new Date(),
              },
              {
                channel: NotificationChannel.email,
                status: emailStatus,
              },
              {
                channel: NotificationChannel.device_push,
                status: pushStatus,
              },
            ],
          },
        },
      });
      // Count a successful create for this recipient.
      created += 1;
      notifiedRecipients.push(row.recipientEmployeeId);
    } catch (err) {
      // Duplicate dedupeKey for this recipient — count as skipped, continue.
      if (isP2002(err)) {
        skipped += 1;
        continue;
      }
      // Non-unique errors propagate to the caller.
      throw err;
    }
  }

  // Live inbox refresh per newly created recipient.
  for (const recipientEmployeeId of notifiedRecipients) {
    publish("notification.changed", { recipientEmployeeId });
  }

  // Aggregate create/skip counts for the caller.
  return { created, skipped };
}

/** Cursor page ordered by createdAt, then id, for one recipient. */
export async function listNotificationsForEmployee(input: {
  employeeId: string;
  unreadOnly?: boolean;
  includeDismissed?: boolean;
  cursor?: string;
  limit?: number;
}) {
  // Clamp page size to [1, 100]; default 30.
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const where: Prisma.NotificationWhereInput = {
    recipientEmployeeId: input.employeeId,
  };
  // Default inbox hides dismissed rows.
  if (!input.includeDismissed) {
    where.dismissedAt = null;
  }
  // Unread filter also excludes dismissed.
  if (input.unreadOnly) {
    where.readAt = null;
    where.dismissedAt = null;
  }
  // Opaque cursor is the previous page's last notification id.
  if (input.cursor) {
    const cursor = await prisma.notification.findFirst({
      where: { id: input.cursor, recipientEmployeeId: input.employeeId },
      select: { id: true, createdAt: true },
    });
    if (!cursor) throw new AppError(400, "validation", "Invalid notification cursor");
    where.OR = [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ];
  }

  // Fetch one extra row to detect hasMore without a separate count.
  const rows = await prisma.notification.findMany({
    where,
    include: { deliveries: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map(formatNotification),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}

/** Count of unread, non-dismissed notifications for badge UIs. */
export async function unreadNotificationCount(employeeId: string) {
  // Match the unread filter used by listNotificationsForEmployee.
  const count = await prisma.notification.count({
    where: {
      recipientEmployeeId: employeeId,
      readAt: null,
      dismissedAt: null,
    },
  });
  return { count };
}

/** Idempotent mark-read for a single notification owned by the employee. */
export async function markNotificationRead(input: {
  employeeId: string;
  notificationId: string;
}) {
  // Ownership check: only the recipient may mark read.
  const existing = await prisma.notification.findFirst({
    where: {
      id: input.notificationId,
      recipientEmployeeId: input.employeeId,
    },
    include: { deliveries: true },
  });
  if (!existing) {
    throw new AppError(404, "not_found", "Notification not found");
  }
  // Already read — idempotent no-op return.
  if (existing.readAt) {
    return formatNotification(existing);
  }
  // Stamp readAt and reload with deliveries.
  const updated = await prisma.notification.update({
    where: { id: existing.id },
    data: { readAt: new Date() },
    include: { deliveries: true },
  });
  publish("notification.changed", {
    recipientEmployeeId: input.employeeId,
  });
  return formatNotification(updated);
}

/** Bulk mark-read for all unread, non-dismissed notifications. */
export async function markAllNotificationsRead(employeeId: string) {
  // Stamp readAt on every unread, non-dismissed row for this recipient.
  const result = await prisma.notification.updateMany({
    where: {
      recipientEmployeeId: employeeId,
      readAt: null,
      dismissedAt: null,
    },
    data: { readAt: new Date() },
  });
  // Only publish when something actually changed.
  if (result.count > 0) {
    publish("notification.changed", { recipientEmployeeId: employeeId });
  }
  return { updated: result.count };
}

/**
 * Soft-hide a notification. Also sets readAt if still unread so dismiss
 * does not leave a phantom unread count.
 */
export async function dismissNotification(input: {
  employeeId: string;
  notificationId: string;
}) {
  // Ownership check: only the recipient may dismiss.
  const existing = await prisma.notification.findFirst({
    where: {
      id: input.notificationId,
      recipientEmployeeId: input.employeeId,
    },
    include: { deliveries: true },
  });
  if (!existing) {
    throw new AppError(404, "not_found", "Notification not found");
  }
  // Already dismissed — idempotent no-op return.
  if (existing.dismissedAt) {
    return formatNotification(existing);
  }
  // Soft-hide; keep existing readAt or set it now to clear unread badges.
  const updated = await prisma.notification.update({
    where: { id: existing.id },
    data: {
      dismissedAt: new Date(),
      readAt: existing.readAt ?? new Date(),
    },
    include: { deliveries: true },
  });
  publish("notification.changed", {
    recipientEmployeeId: input.employeeId,
  });
  return formatNotification(updated);
}
