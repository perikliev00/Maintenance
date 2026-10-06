import {
  NotificationChannel,
  NotificationDeliveryStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { publish } from "../events/bus";
import type { Action } from "../permissions";
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

export type NotificationPayload = {
  panel?: NotificationPanel;
  ticketId?: string;
  taskId?: string;
  locationId?: string;
  locationNumber?: string;
  adjustmentId?: string;
  sessionId?: string;
  [key: string]: unknown;
};

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
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    entityType: row.entityType,
    entityId: row.entityId,
    locationId: row.locationId,
    payload: (row.payload ?? null) as NotificationPayload | null,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    actorEmployeeId: row.actorEmployeeId,
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

async function employeesWithAction(
  action: Action,
  opts: { locationId?: string | null } = {},
): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { employeeId: true, role: true },
  });

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

/** Prefer sector primary supervisor; fall back to action holders in scope. */
export async function recipientsForLocationOps(
  locationId: string | null | undefined,
  action: Action,
): Promise<string[]> {
  const ids = new Set<string>();
  if (locationId) {
    const snap = await sectorSnapshotForLocation(locationId);
    if (snap.sectorSupervisorEmployeeId) {
      ids.add(snap.sectorSupervisorEmployeeId);
    }
  }
  for (const id of await employeesWithAction(action, { locationId })) {
    ids.add(id);
  }
  return [...ids];
}

export async function recipientsWithAction(action: Action): Promise<string[]> {
  return employeesWithAction(action);
}

/**
 * Create in-app notifications for recipients. Email/push get delivery stubs only.
 * Dedupes on (recipientEmployeeId, dedupeKey). Never notifies the actor.
 */
export async function createNotifications(
  input: CreateNotificationInput,
): Promise<{ created: number; skipped: number }> {
  const settings = await getSetting("notifications");
  if (!settings.in_app.enabled) {
    return { created: 0, skipped: input.recipientEmployeeIds.length };
  }

  const actorId = input.actorEmployeeId ?? null;
  const uniqueRecipients = [
    ...new Set(
      input.recipientEmployeeIds.filter(
        (id) => id && id !== actorId,
      ),
    ),
  ];
  if (uniqueRecipients.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const emailStatus = settings.email.enabled
    ? NotificationDeliveryStatus.not_configured
    : NotificationDeliveryStatus.skipped;
  // Push is always clamped not_configured in settings.
  const pushStatus = NotificationDeliveryStatus.not_configured;

  let created = 0;
  let skipped = 0;
  const notifiedRecipients: string[] = [];

  for (const recipientEmployeeId of uniqueRecipients) {
    try {
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
          payload:
            input.payload === undefined
              ? Prisma.JsonNull
              : (input.payload as Prisma.InputJsonValue),
          dedupeKey: input.dedupeKey,
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
      created += 1;
      notifiedRecipients.push(row.recipientEmployeeId);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  for (const recipientEmployeeId of notifiedRecipients) {
    publish("notification.changed", { recipientEmployeeId });
  }

  return { created, skipped };
}

export async function listNotificationsForEmployee(input: {
  employeeId: string;
  unreadOnly?: boolean;
  includeDismissed?: boolean;
  cursor?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const where: Prisma.NotificationWhereInput = {
    recipientEmployeeId: input.employeeId,
  };
  if (!input.includeDismissed) {
    where.dismissedAt = null;
  }
  if (input.unreadOnly) {
    where.readAt = null;
    where.dismissedAt = null;
  }
  if (input.cursor) {
    where.id = { lt: input.cursor };
  }

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

export async function unreadNotificationCount(employeeId: string) {
  const count = await prisma.notification.count({
    where: {
      recipientEmployeeId: employeeId,
      readAt: null,
      dismissedAt: null,
    },
  });
  return { count };
}

export async function markNotificationRead(input: {
  employeeId: string;
  notificationId: string;
}) {
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
  if (existing.readAt) {
    return formatNotification(existing);
  }
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

export async function markAllNotificationsRead(employeeId: string) {
  const result = await prisma.notification.updateMany({
    where: {
      recipientEmployeeId: employeeId,
      readAt: null,
      dismissedAt: null,
    },
    data: { readAt: new Date() },
  });
  if (result.count > 0) {
    publish("notification.changed", { recipientEmployeeId: employeeId });
  }
  return { updated: result.count };
}

export async function dismissNotification(input: {
  employeeId: string;
  notificationId: string;
}) {
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
  if (existing.dismissedAt) {
    return formatNotification(existing);
  }
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
