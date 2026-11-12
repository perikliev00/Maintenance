/**
 * Durable inspection-notice intent for cleaning session complete.
 * Delivery/flush use the shared outbox runtime; enqueue stays domain-specific.
 */
import { Prisma } from "@prisma/client";
// Import ../../db for cleaning/notificationOutbox.ts.
import { prisma } from "../../db";
// Type-only import from ../db/types used by cleaning/notificationOutbox.ts.
import type { Tx } from "../db/types";
// Type-only import from ../notifications used by cleaning/notificationOutbox.ts.
import type { CreateNotificationInput } from "../notifications";
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  deliverOutboxIntent,
  // Carry this field through the payload or query.
  flushOutbox,
// Execute: } from "../notifications/outboxRuntime";
} from "../notifications/outboxRuntime";
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  countOutboxBacklog,
  // Carry this field through the payload or query.
  listEligibleOutboxKeys,
  // Carry this field through the payload or query.
  recordOutboxFailure,
// Execute: } from "../notifications/outboxAdapterHelpers";
} from "../notifications/outboxAdapterHelpers";

/** Snapshot recipients/content with the complete command — replay stays stable. */
export async function enqueueCleaningInspectionNotice(
  // Carry this field through the payload or query.
  tx: Tx,
  // Carry this field through the payload or query.
  commandId: string,
  // Carry this field through the payload or query.
  payload: CreateNotificationInput,
// Begin block/object for the following statements.
) {
  // Persist the mutation inside the current transaction/context.
  await tx.cleaningNotificationOutbox.create({
    // Fields written by this create/update.
    data: {
      // Carry this field through the payload or query.
      commandId,
      // Carry this field through the payload or query.
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });
}

// Capture cleaningAdapters for subsequent checks or writes.
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
    // Return the computed result to the caller.
    return {
      // Carry this field through the payload or query.
      key: intent.commandId,
      // Carry this field through the payload or query.
      payload: intent.payload,
      // Carry this field through the payload or query.
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
        // Carry this field through the payload or query.
        deliveredAt: new Date(),
        // Field value required by this payload or query.
        nextAttemptAt: null,
        // Field value required by this payload or query.
        failedPermanentlyAt: null,
        // Field value required by this payload or query.
        lastError: null,
      },
    });
  },
};

/** Idempotent delivery; unique (recipient, dedupeKey) repairs partial inserts. */
export async function deliverCleaningInspectionNotice(
  // Carry this field through the payload or query.
  commandId: string,
// Begin block/object for the following statements.
): Promise<void> {
  // Await side effect or helper before continuing.
  await deliverOutboxIntent(commandId, cleaningAdapters);
}

/** Bounded background recovery for crash / first-delivery failure. */
export async function flushCleaningNotificationOutbox() {
  // Return the computed result to the caller.
  return flushOutbox({
    // Field value required by this payload or query.
    listEligibleKeys: () => listEligibleOutboxKeys(prisma, "cleaning"),
    // Carry this field through the payload or query.
    deliver: deliverCleaningInspectionNotice,
    // Carry this field through the payload or query.
    recordFailure: (key, kind, message) =>
      // Execute: recordOutboxFailure(prisma, "cleaning", key, kind, message),
      recordOutboxFailure(prisma, "cleaning", key, kind, message),
    // Field value required by this payload or query.
    countBacklog: () => countOutboxBacklog(prisma, "cleaning"),
    // Field value required by this payload or query.
    errorLabel: "Cleaning notification delivery failed",
  });
}
