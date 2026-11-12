/**
 * In-app notification create/list/read/dismiss plus recipient resolution by role grant.
 * Email/push channels are stubbed until adapters exist; device_push stays not_configured.
 */
import {
  // Run next step: NotificationChannel,
  NotificationChannel,
  // Run next step: NotificationDeliveryStatus,
  NotificationDeliveryStatus,
  // Run next step: Prisma,
  Prisma,
  // Run next step: Role,
  Role,
// Run next step: } from "@prisma/client";
} from "@prisma/client";
// Import module zod/v3 for this service.
import { z } from "zod/v3";
// Import module ../db for this service.
import { prisma } from "../db";
// Import module ../errors for this service.
import { AppError } from "../errors";
// Import module ../events/bus for this service.
import { publish } from "../events/bus";
// Import type(s) Action for typing without runtime cost.
import type { Action } from "../permissions";
// Import module ./db/prismaErrors for this service.
import { isP2002 } from "./db/prismaErrors";
// Import module ./dataScope for this service.
import { sectorSnapshotForLocation } from "./dataScope";
// Import module ./roleGrants for this service.
import { canPerform } from "./roleGrants";
// Import module ./settings for this service.
import { getSetting } from "./settings";

// Declare type NotificationPanel for callers and internals.
export type NotificationPanel =
  // Run next step: | "repairs"
  | "repairs"
  // Run next step: | "mywork"
  | "mywork"
  // Run next step: | "attendance"
  | "attendance"
  // Run next step: | "live"
  | "live"
  // Run next step: | "rooms"
  | "rooms"
  // Run next step: | "common"
  | "common"
  // Run next step: | "cleaning"
  | "cleaning"
  // Run next step: | "home";
  | "home";

// Capture notification panel schema for use in this scope.
const notificationPanelSchema = z.enum([
  // Run next step: "repairs",
  "repairs",
  // Run next step: "mywork",
  "mywork",
  // Run next step: "attendance",
  "attendance",
  // Run next step: "live",
  "live",
  // Run next step: "rooms",
  "rooms",
  // Run next step: "common",
  "common",
  // Run next step: "cleaning",
  "cleaning",
  // Run next step: "home",
  "home",
]);

/** Soft decoder for persisted notification JSON (malformed → null, never cast). */
const storedNotificationPayloadSchema = z
  // Continue the chained call from the previous expression.
  .object({
    // Set panel on the structure being built.
    panel: notificationPanelSchema.optional(),
    // Set ticketId on the structure being built.
    ticketId: z.string().optional(),
    // Set taskId on the structure being built.
    taskId: z.string().optional(),
    // Set locationId on the structure being built.
    locationId: z.string().optional(),
    // Set locationNumber on the structure being built.
    locationNumber: z.string().optional(),
    // Set adjustmentId on the structure being built.
    adjustmentId: z.string().optional(),
    // Set sessionId on the structure being built.
    sessionId: z.string().optional(),
  })
  // Continue the chained call from the previous expression.
  .passthrough();

// Declare type NotificationPayload for callers and internals.
export type NotificationPayload = z.infer<typeof storedNotificationPayloadSchema>;

// Define decodeStoredNotificationPayload — core behavior for this module.
export function decodeStoredNotificationPayload(
  // Set raw on the structure being built.
  raw: unknown,
// Run next step: ): NotificationPayload | null {
): NotificationPayload | null {
  // Branch when this condition holds so the right path runs.
  if (raw == null) return null;
  // Capture parsed for use in this scope.
  const parsed = storedNotificationPayloadSchema.safeParse(raw);
  // Return the computed result to the caller.
  return parsed.success ? parsed.data : null;
}

// Declare type CreateNotificationInput for callers and internals.
export type CreateNotificationInput = {
  // Set type on the structure being built.
  type: string;
  // Set title on the structure being built.
  title: string;
  // Set body on the structure being built.
  body: string;
  // Set entityType on the structure being built.
  entityType: string;
  // Set entityId on the structure being built.
  entityId: string;
  // Run next step: locationId?: string | null;
  locationId?: string | null;
  // Run next step: actorEmployeeId?: string | null;
  actorEmployeeId?: string | null;
  // Set recipientEmployeeIds on the structure being built.
  recipientEmployeeIds: string[];
  /** Stable key fragment; combined with type+entityId per recipient. */
  dedupeKey: string;
  // Run next step: payload?: NotificationPayload;
  payload?: NotificationPayload;
};

/**
 * Map a Prisma notification (+ optional deliveries) to the API DTO.
 * Derives `unread` from readAt/dismissedAt for the inbox badge.
 */
function formatNotification(row: {
  // Set id on the structure being built.
  id: string;
  // Set type on the structure being built.
  type: string;
  // Set title on the structure being built.
  title: string;
  // Set body on the structure being built.
  body: string;
  // Set entityType on the structure being built.
  entityType: string;
  // Set entityId on the structure being built.
  entityId: string;
  // Set locationId on the structure being built.
  locationId: string | null;
  // Set payload on the structure being built.
  payload: Prisma.JsonValue | null;
  // Set createdAt on the structure being built.
  createdAt: Date;
  // Set readAt on the structure being built.
  readAt: Date | null;
  // Set dismissedAt on the structure being built.
  dismissedAt: Date | null;
  // Set actorEmployeeId on the structure being built.
  actorEmployeeId: string | null;
  // Run next step: deliveries?: Array<{
  deliveries?: Array<{
    // Set channel on the structure being built.
    channel: NotificationChannel;
    // Set status on the structure being built.
    status: NotificationDeliveryStatus;
    // Set attemptedAt on the structure being built.
    attemptedAt: Date;
    // Set deliveredAt on the structure being built.
    deliveredAt: Date | null;
    // Set error on the structure being built.
    error: string | null;
  // Run next step: }>;
  }>;
// Run next step: }) {
}) {
  // ISO timestamps + derived unread flag for the inbox UI.
  return {
    // Set id on the structure being built.
    id: row.id,
    // Set type on the structure being built.
    type: row.type,
    // Set title on the structure being built.
    title: row.title,
    // Set body on the structure being built.
    body: row.body,
    // Set entityType on the structure being built.
    entityType: row.entityType,
    // Set entityId on the structure being built.
    entityId: row.entityId,
    // Set locationId on the structure being built.
    locationId: row.locationId,
    // Set payload on the structure being built.
    payload: decodeStoredNotificationPayload(row.payload),
    // Set createdAt on the structure being built.
    createdAt: row.createdAt.toISOString(),
    // Set readAt on the structure being built.
    readAt: row.readAt?.toISOString() ?? null,
    // Set dismissedAt on the structure being built.
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: row.actorEmployeeId,
    // Unread means never read and not soft-dismissed.
    unread: !row.readAt && !row.dismissedAt,
    // Set deliveries on the structure being built.
    deliveries: (row.deliveries ?? []).map((d) => ({
      // Set channel on the structure being built.
      channel: d.channel,
      // Set status on the structure being built.
      status: d.status,
      // Set attemptedAt on the structure being built.
      attemptedAt: d.attemptedAt.toISOString(),
      // Set deliveredAt on the structure being built.
      deliveredAt: d.deliveredAt?.toISOString() ?? null,
      // Set error on the structure being built.
      error: d.error,
    })),
  };
}

// Declare type FormattedNotification for callers and internals.
export type FormattedNotification = ReturnType<typeof formatNotification>;

/**
 * Active users whose role grants include `action`. When locationId is set,
 * supervisors are limited to those whose sector covers that location.
 */
async function employeesWithAction(
  // Set action on the structure being built.
  action: Action,
  // Set opts on the structure being built.
  opts: { locationId?: string | null } = {},
// Run next step: ): Promise<string[]> {
): Promise<string[]> {
  // All active users — role grants are checked in memory per role.
  const users = await prisma.user.findMany({
    // Set where on the structure being built.
    where: { isActive: true },
    // Set select on the structure being built.
    select: { employeeId: true, role: true },
  });

  // When location-scoped, resolve which supervisors own active sectors for it.
  let sectorSupervisorIds: Set<string> | null = null;
  // Branch when this condition holds so the right path runs.
  if (opts.locationId) {
    // Load memberships asynchronously for the next steps.
    const memberships = await prisma.sectorLocation.findMany({
      // Set where on the structure being built.
      where: {
        // Set locationId on the structure being built.
        locationId: opts.locationId,
        // Set sector on the structure being built.
        sector: { isActive: true },
      },
      // Set select on the structure being built.
      select: {
        // Set sector on the structure being built.
        sector: { select: { primarySupervisorEmployeeId: true } },
      },
    });
    // Update sector supervisor ids as control flow progresses.
    sectorSupervisorIds = new Set(
      // Run next step: memberships
      memberships
        // Continue the chained call from the previous expression.
        .map((m) => m.sector.primarySupervisorEmployeeId)
        // Continue the chained call from the previous expression.
        .filter((id): id is string => Boolean(id)),
    );
  }

  // Capture allowed for use in this scope.
  const allowed: string[] = [];
  // Iterate items to apply the same logic to each entry.
  for (const user of users) {
    // Skip roles that cannot perform the action.
    if (!(await canPerform(user.role, action))) continue;

    // Supervisors only receive location-scoped ops alerts for their sectors.
    if (
      // Run next step: opts.locationId &&
      opts.locationId &&
      // Run next step: user.role === Role.supervisor &&
      user.role === Role.supervisor &&
      // Run next step: sectorSupervisorIds &&
      sectorSupervisorIds &&
      // Run next step: !sectorSupervisorIds.has(user.employeeId)
      !sectorSupervisorIds.has(user.employeeId)
    // Run next step: ) {
    ) {
      // Skip to the next loop iteration.
      continue;
    }

    // Append an entry to the accumulating collection.
    allowed.push(user.employeeId);
  }
  // Return the computed result to the caller.
  return allowed;
}

/**
 * Prefer sector primary supervisor; fall back to action holders in scope.
 * Deduplicates via Set so supervisor + grant overlap is returned once.
 */
export async function recipientsForLocationOps(
  // Set locationId on the structure being built.
  locationId: string | null | undefined,
  // Set action on the structure being built.
  action: Action,
// Run next step: ): Promise<string[]> {
): Promise<string[]> {
  // Capture ids for use in this scope.
  const ids = new Set<string>();
  // Prefer the snapshotted primary supervisor for this location's sector.
  if (locationId) {
    // Load snap asynchronously for the next steps.
    const snap = await sectorSnapshotForLocation(locationId);
    // Only add when a primary supervisor is configured.
    if (snap.sectorSupervisorEmployeeId) {
      // Run next step: ids.add(snap.sectorSupervisorEmployeeId);
      ids.add(snap.sectorSupervisorEmployeeId);
    }
  }
  // Union with everyone whose role grant allows the action (scoped).
  for (const id of await employeesWithAction(action, { locationId })) {
    // Run next step: ids.add(id);
    ids.add(id);
  }
  // Return the computed result to the caller.
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
  // Set input on the structure being built.
  input: CreateNotificationInput,
// Run next step: ): Promise<{ created: number; skipped: number }> {
): Promise<{ created: number; skipped: number }> {
  // Feature flag: in-app channel must be enabled in settings.
  const settings = await getSetting("notifications");
  // Branch when this condition holds so the right path runs.
  if (!settings.in_app.enabled) {
    // Return the computed result to the caller.
    return { created: 0, skipped: input.recipientEmployeeIds.length };
  }

  // Never notify the actor; dedupe recipient list.
  const actorId = input.actorEmployeeId ?? null;
  // Collect unique recipients list for later processing.
  const uniqueRecipients = [
    // Run next step: ...new Set(
    ...new Set(
      // Run next step: input.recipientEmployeeIds.filter(
      input.recipientEmployeeIds.filter(
        // Run next step: (id) => id && id !== actorId,
        (id) => id && id !== actorId,
      ),
    ),
  ];
  // Nothing left after filtering actor / empties.
  if (uniqueRecipients.length === 0) {
    // Return the computed result to the caller.
    return { created: 0, skipped: 0 };
  }

  // Email adapter not wired yet — stub status when the channel is "enabled".
  const emailStatus = settings.email.enabled
    // Complete the ternary or optional chain started above.
    ? NotificationDeliveryStatus.not_configured
    // Complete the ternary or optional chain started above.
    : NotificationDeliveryStatus.skipped;
  // Push is always clamped not_configured in settings.
  const pushStatus = NotificationDeliveryStatus.not_configured;

  // Capture created for use in this scope.
  let created = 0;
  // Capture skipped for use in this scope.
  let skipped = 0;
  // Capture notified recipients for use in this scope.
  const notifiedRecipients: string[] = [];

  // One notification (+ delivery stubs) per recipient.
  for (const recipientEmployeeId of uniqueRecipients) {
    // Attempt the fallible work so errors can be handled below.
    try {
      // Unique on (recipientEmployeeId, dedupeKey) for idempotent creates.
      const row = await prisma.notification.create({
        // Set data on the structure being built.
        data: {
          // Run next step: recipientEmployeeId,
          recipientEmployeeId,
          // Set actorEmployeeId on the structure being built.
          actorEmployeeId: actorId,
          // Set type on the structure being built.
          type: input.type,
          // Set title on the structure being built.
          title: input.title,
          // Set body on the structure being built.
          body: input.body,
          // Set entityType on the structure being built.
          entityType: input.entityType,
          // Set entityId on the structure being built.
          entityId: input.entityId,
          // Set locationId on the structure being built.
          locationId: input.locationId ?? null,
          // Prisma.JsonNull when payload omitted (distinct from JSON null value).
          payload:
            // Run next step: input.payload === undefined
            input.payload === undefined
              // Complete the ternary or optional chain started above.
              ? Prisma.JsonNull
              // Complete the ternary or optional chain started above.
              : (input.payload as Prisma.InputJsonValue),
          // Set dedupeKey on the structure being built.
          dedupeKey: input.dedupeKey,
          // Three delivery rows: in-app delivered now; email/push stubbed.
          deliveries: {
            // Set create on the structure being built.
            create: [
              // Run next step: {
              {
                // Set channel on the structure being built.
                channel: NotificationChannel.in_app,
                // Set status on the structure being built.
                status: NotificationDeliveryStatus.delivered,
                // Set deliveredAt on the structure being built.
                deliveredAt: new Date(),
              },
              // Run next step: {
              {
                // Set channel on the structure being built.
                channel: NotificationChannel.email,
                // Set status on the structure being built.
                status: emailStatus,
              },
              // Run next step: {
              {
                // Set channel on the structure being built.
                channel: NotificationChannel.device_push,
                // Set status on the structure being built.
                status: pushStatus,
              },
            ],
          },
        },
      });
      // Count a successful create for this recipient.
      created += 1;
      // Append an entry to the accumulating collection.
      notifiedRecipients.push(row.recipientEmployeeId);
    // Run next step: } catch (err) {
    } catch (err) {
      // Duplicate dedupeKey for this recipient — count as skipped, continue.
      if (isP2002(err)) {
        // Run next step: skipped += 1;
        skipped += 1;
        // Skip to the next loop iteration.
        continue;
      }
      // Non-unique errors propagate to the caller.
      throw err;
    }
  }

  // Live inbox refresh per newly created recipient.
  for (const recipientEmployeeId of notifiedRecipients) {
    // Run next step: publish("notification.changed", { recipientEmployeeId });
    publish("notification.changed", { recipientEmployeeId });
  }

  // Aggregate create/skip counts for the caller.
  return { created, skipped };
}

/** Cursor page ordered by createdAt, then id, for one recipient. */
export async function listNotificationsForEmployee(input: {
  // Set employeeId on the structure being built.
  employeeId: string;
  // Run next step: unreadOnly?: boolean;
  unreadOnly?: boolean;
  // Run next step: includeDismissed?: boolean;
  includeDismissed?: boolean;
  // Run next step: cursor?: string;
  cursor?: string;
  // Run next step: limit?: number;
  limit?: number;
// Run next step: }) {
}) {
  // Clamp page size to [1, 100]; default 30.
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  // Capture where for use in this scope.
  const where: Prisma.NotificationWhereInput = {
    // Set recipientEmployeeId on the structure being built.
    recipientEmployeeId: input.employeeId,
  };
  // Default inbox hides dismissed rows.
  if (!input.includeDismissed) {
    // Run next step: where.dismissedAt = null;
    where.dismissedAt = null;
  }
  // Unread filter also excludes dismissed.
  if (input.unreadOnly) {
    // Run next step: where.readAt = null;
    where.readAt = null;
    // Run next step: where.dismissedAt = null;
    where.dismissedAt = null;
  }
  // Opaque cursor is the previous page's last notification id.
  if (input.cursor) {
    // Load cursor asynchronously for the next steps.
    const cursor = await prisma.notification.findFirst({
      // Set where on the structure being built.
      where: { id: input.cursor, recipientEmployeeId: input.employeeId },
      // Set select on the structure being built.
      select: { id: true, createdAt: true },
    });
    // Branch when this condition holds so the right path runs.
    if (!cursor) throw new AppError(400, "validation", "Invalid notification cursor");
    // Run next step: where.OR = [
    where.OR = [
      // Run next step: { createdAt: { lt: cursor.createdAt } },
      { createdAt: { lt: cursor.createdAt } },
      // Run next step: { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ];
  }

  // Fetch one extra row to detect hasMore without a separate count.
  const rows = await prisma.notification.findMany({
    // Run next step: where,
    where,
    // Set include on the structure being built.
    include: { deliveries: true },
    // Set orderBy on the structure being built.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // Set take on the structure being built.
    take: limit + 1,
  });

  // Capture has more for use in this scope.
  const hasMore = rows.length > limit;
  // Capture page for use in this scope.
  const page = hasMore ? rows.slice(0, limit) : rows;
  // Return the computed result to the caller.
  return {
    // Set items on the structure being built.
    items: page.map(formatNotification),
    // Set nextCursor on the structure being built.
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}

/** Count of unread, non-dismissed notifications for badge UIs. */
export async function unreadNotificationCount(employeeId: string) {
  // Match the unread filter used by listNotificationsForEmployee.
  const count = await prisma.notification.count({
    // Set where on the structure being built.
    where: {
      // Set recipientEmployeeId on the structure being built.
      recipientEmployeeId: employeeId,
      // Set readAt on the structure being built.
      readAt: null,
      // Set dismissedAt on the structure being built.
      dismissedAt: null,
    },
  });
  // Return the computed result to the caller.
  return { count };
}

/** Idempotent mark-read for a single notification owned by the employee. */
export async function markNotificationRead(input: {
  // Set employeeId on the structure being built.
  employeeId: string;
  // Set notificationId on the structure being built.
  notificationId: string;
// Run next step: }) {
}) {
  // Ownership check: only the recipient may mark read.
  const existing = await prisma.notification.findFirst({
    // Set where on the structure being built.
    where: {
      // Set id on the structure being built.
      id: input.notificationId,
      // Set recipientEmployeeId on the structure being built.
      recipientEmployeeId: input.employeeId,
    },
    // Set include on the structure being built.
    include: { deliveries: true },
  });
  // Branch when this condition holds so the right path runs.
  if (!existing) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Notification not found");
  }
  // Already read — idempotent no-op return.
  if (existing.readAt) {
    // Return the computed result to the caller.
    return formatNotification(existing);
  }
  // Stamp readAt and reload with deliveries.
  const updated = await prisma.notification.update({
    // Set where on the structure being built.
    where: { id: existing.id },
    // Set data on the structure being built.
    data: { readAt: new Date() },
    // Set include on the structure being built.
    include: { deliveries: true },
  });
  // Run next step: publish("notification.changed", {
  publish("notification.changed", {
    // Set recipientEmployeeId on the structure being built.
    recipientEmployeeId: input.employeeId,
  });
  // Return the computed result to the caller.
  return formatNotification(updated);
}

/** Bulk mark-read for all unread, non-dismissed notifications. */
export async function markAllNotificationsRead(employeeId: string) {
  // Stamp readAt on every unread, non-dismissed row for this recipient.
  const result = await prisma.notification.updateMany({
    // Set where on the structure being built.
    where: {
      // Set recipientEmployeeId on the structure being built.
      recipientEmployeeId: employeeId,
      // Set readAt on the structure being built.
      readAt: null,
      // Set dismissedAt on the structure being built.
      dismissedAt: null,
    },
    // Set data on the structure being built.
    data: { readAt: new Date() },
  });
  // Only publish when something actually changed.
  if (result.count > 0) {
    // Run next step: publish("notification.changed", { recipientEmployeeId: emplo…
    publish("notification.changed", { recipientEmployeeId: employeeId });
  }
  // Return the computed result to the caller.
  return { updated: result.count };
}

/**
 * Soft-hide a notification. Also sets readAt if still unread so dismiss
 * does not leave a phantom unread count.
 */
export async function dismissNotification(input: {
  // Set employeeId on the structure being built.
  employeeId: string;
  // Set notificationId on the structure being built.
  notificationId: string;
// Run next step: }) {
}) {
  // Ownership check: only the recipient may dismiss.
  const existing = await prisma.notification.findFirst({
    // Set where on the structure being built.
    where: {
      // Set id on the structure being built.
      id: input.notificationId,
      // Set recipientEmployeeId on the structure being built.
      recipientEmployeeId: input.employeeId,
    },
    // Set include on the structure being built.
    include: { deliveries: true },
  });
  // Branch when this condition holds so the right path runs.
  if (!existing) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Notification not found");
  }
  // Already dismissed — idempotent no-op return.
  if (existing.dismissedAt) {
    // Return the computed result to the caller.
    return formatNotification(existing);
  }
  // Soft-hide; keep existing readAt or set it now to clear unread badges.
  const updated = await prisma.notification.update({
    // Set where on the structure being built.
    where: { id: existing.id },
    // Set data on the structure being built.
    data: {
      // Set dismissedAt on the structure being built.
      dismissedAt: new Date(),
      // Set readAt on the structure being built.
      readAt: existing.readAt ?? new Date(),
    },
    // Set include on the structure being built.
    include: { deliveries: true },
  });
  // Run next step: publish("notification.changed", {
  publish("notification.changed", {
    // Set recipientEmployeeId on the structure being built.
    recipientEmployeeId: input.employeeId,
  });
  // Return the computed result to the caller.
  return formatNotification(updated);
}
