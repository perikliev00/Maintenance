/**
 * Durable inspection-notice intent for cleaning session complete.
 * Delivery/flush use the shared outbox runtime; enqueue stays domain-specific.
 */
import { Prisma } from "@prisma/client";
// Import ../../db for cleaning/notificationOutbox.ts.
import { prisma } from "../../db";
import type { Tx } from "../db/types";
import type { CreateNotificationInput } from "../notifications";
// Side-effect or default import required by this module.
import {
  deliverOutboxIntent,
  flushOutbox,
// Execute: } from "../notifications/outboxRuntime";
} from "../notifications/outboxRuntime";
// Side-effect or default import required by this module.
import {
  countOutboxBacklog,
  listEligibleOutboxKeys,
  recordOutboxFailure,
// Execute: } from "../notifications/outboxAdapterHelpers";
} from "../notifications/outboxAdapterHelpers";

/** Snapshot recipients/content with the complete command — replay stays stable. */
export async function enqueueCleaningInspectionNotice(
  tx: Tx,
  commandId: string,
  payload: CreateNotificationInput,
) {
  // Persist the mutation inside the current transaction/context.
  await tx.cleaningNotificationOutbox.create({
    // Fields written by this create/update.
    data: {
      commandId,
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });
}

const cleaningAdapters = {
  // Open nested structure for the next related fields.
  findPending: async (commandId: string) => {
    // Load intent needed for the next decision or write.
    const intent = await prisma.cleaningNotificationOutbox.findUnique({
      // Restrict the query to the relevant rows only.
      where: { commandId },
    });
    // Guard: handle missing/invalid state before continuing.
    if (!intent) return null;
    return {
      key: intent.commandId,
      payload: intent.payload,
      deliveredAt: intent.deliveredAt,
    };
  },
  // Open nested structure for the next related fields.
  markDelivered: async (commandId: string) => {
    // Persist the mutation inside the current transaction/context.
    await prisma.cleaningNotificationOutbox.update({
      // Restrict the query to the relevant rows only.
      where: { commandId },
      // Fields written by this create/update.
      data: {
        deliveredAt: new Date(),
        nextAttemptAt: null,
        failedPermanentlyAt: null,
        lastError: null,
      },
    });
  },
};

/** Idempotent delivery; unique (recipient, dedupeKey) repairs partial inserts. */
export async function deliverCleaningInspectionNotice(
  commandId: string,
): Promise<void> {
  await deliverOutboxIntent(commandId, cleaningAdapters);
}

/** Bounded background recovery for crash / first-delivery failure. */
export async function flushCleaningNotificationOutbox() {
  return flushOutbox({
    listEligibleKeys: () => listEligibleOutboxKeys(prisma, "cleaning"),
    deliver: deliverCleaningInspectionNotice,
    recordFailure: (key, kind, message) =>
      // Execute: recordOutboxFailure(prisma, "cleaning", key, kind, message),
      recordOutboxFailure(prisma, "cleaning", key, kind, message),
    countBacklog: () => countOutboxBacklog(prisma, "cleaning"),
    errorLabel: "Cleaning notification delivery failed",
  });
}
