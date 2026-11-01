/**
 * Durable inspection-notice intent for cleaning session complete.
 * Mirrors ticket notification outbox: enqueue in the domain TX, deliver after
 * commit, and repair partial/failed delivery via replay or background flush.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import {
  createNotifications,
  type CreateNotificationInput,
} from "../notifications";
import { getSetting } from "../settings";

type Tx = Prisma.TransactionClient;

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

/** Idempotent delivery; unique (recipient, dedupeKey) repairs partial inserts. */
export async function deliverCleaningInspectionNotice(
  commandId: string,
): Promise<void> {
  const intent = await prisma.cleaningNotificationOutbox.findUnique({
    where: { commandId },
  });
  if (!intent || intent.deliveredAt) return;

  const payload = intent.payload as unknown as CreateNotificationInput;
  if (!(await getSetting("notifications")).in_app.enabled) {
    await prisma.cleaningNotificationOutbox.update({
      where: { commandId },
      data: { deliveredAt: new Date() },
    });
    return;
  }

  await createNotifications(payload);
  await prisma.cleaningNotificationOutbox.update({
    where: { commandId },
    data: { deliveredAt: new Date() },
  });
}

/** Bounded background recovery for crash / first-delivery failure. */
export async function flushCleaningNotificationOutbox() {
  const intents = await prisma.cleaningNotificationOutbox.findMany({
    where: { deliveredAt: null },
    orderBy: [{ createdAt: "asc" }, { commandId: "asc" }],
    take: 100,
  });
  let delivered = 0;
  const failures: string[] = [];
  for (const intent of intents) {
    try {
      await deliverCleaningInspectionNotice(intent.commandId);
      delivered++;
    } catch {
      failures.push(intent.commandId);
    }
  }
  return failures.length
    ? {
        delivered,
        pending: failures.length,
        error: "Cleaning notification delivery failed",
      }
    : { delivered, pending: 0 };
}
