/**
 * Shared notification-outbox delivery / flush helpers.
 * Domain modules keep their own enqueue + Prisma table adapters.
 */
import { z } from "zod/v3";
import {
  createNotifications,
  type CreateNotificationInput,
} from "../notifications";
import { getSetting } from "../settings";

/** Zod decoder for persisted CreateNotificationInput JSON (rejects malformed rows). */
export const createNotificationInputSchema: z.ZodType<CreateNotificationInput> =
  z.object({
    type: z.string().min(1),
    title: z.string(),
    body: z.string(),
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    locationId: z.string().nullable().optional(),
    actorEmployeeId: z.string().nullable().optional(),
    recipientEmployeeIds: z.array(z.string().min(1)),
    dedupeKey: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).optional(),
  });

/** Parse persisted outbox JSON; throws on malformed payloads. */
export function decodeNotificationPayload(
  raw: unknown,
): CreateNotificationInput {
  return createNotificationInputSchema.parse(raw);
}

export type OutboxDeliverAdapters = {
  /** Load undelivered intent by domain key; null if missing. */
  findPending: (
    key: string,
  ) => Promise<{ key: string; payload: unknown; deliveredAt: Date | null } | null>;
  /** Mark intent delivered (also used when notifications are disabled). */
  markDelivered: (key: string) => Promise<void>;
};

/**
 * Idempotent delivery for one outbox intent.
 * Disabled in-app channel → mark delivered without creating rows.
 */
export async function deliverOutboxIntent(
  key: string,
  adapters: OutboxDeliverAdapters,
): Promise<void> {
  const intent = await adapters.findPending(key);
  if (!intent || intent.deliveredAt) return;

  const payload = decodeNotificationPayload(intent.payload);
  if (!(await getSetting("notifications")).in_app.enabled) {
    await adapters.markDelivered(key);
    return;
  }

  await createNotifications(payload);
  await adapters.markDelivered(key);
}

export type OutboxFlushAdapters = {
  listPendingKeys: () => Promise<string[]>;
  deliver: (key: string) => Promise<void>;
  errorLabel: string;
};

/** Bounded background recovery: take ≤100 pending keys, collect failures. */
export async function flushOutbox(adapters: OutboxFlushAdapters): Promise<{
  delivered: number;
  pending: number;
  error?: string;
}> {
  const keys = await adapters.listPendingKeys();
  let delivered = 0;
  const failures: string[] = [];
  for (const key of keys) {
    try {
      await adapters.deliver(key);
      delivered++;
    } catch {
      failures.push(key);
    }
  }
  return failures.length
    ? {
        delivered,
        pending: failures.length,
        error: adapters.errorLabel,
      }
    : { delivered, pending: 0 };
}
