/**
 * Durable inspection-notice intent for cleaning session complete.
 * Delivery/flush use the shared outbox runtime; enqueue stays domain-specific.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import type { Tx } from "../db/types";
import type { CreateNotificationInput } from "../notifications";
import {
  deliverOutboxIntent,
  flushOutbox,
} from "../notifications/outboxRuntime";

/** Snapshot recipients/content with the complete command — replay stays stable. */
export async function enqueueCleaningInspectionNotice(
  tx: Tx,
  commandId: string,
  payload: CreateNotificationInput,
) {
  await tx.cleaningNotificationOutbox.create({
    data: {
      commandId,
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });
}

const cleaningAdapters = {
  findPending: async (commandId: string) => {
    const intent = await prisma.cleaningNotificationOutbox.findUnique({
      where: { commandId },
    });
    if (!intent) return null;
    return {
      key: intent.commandId,
      payload: intent.payload,
      deliveredAt: intent.deliveredAt,
    };
  },
  markDelivered: async (commandId: string) => {
    await prisma.cleaningNotificationOutbox.update({
      where: { commandId },
      data: { deliveredAt: new Date() },
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
    listPendingKeys: async () => {
      const intents = await prisma.cleaningNotificationOutbox.findMany({
        where: { deliveredAt: null },
        orderBy: [{ createdAt: "asc" }, { commandId: "asc" }],
        take: 100,
      });
      return intents.map((i) => i.commandId);
    },
    deliver: deliverCleaningInspectionNotice,
    errorLabel: "Cleaning notification delivery failed",
  });
}
