/**
 * Durable attendance-adjustment notice intents.
 * Delivery/flush use the shared outbox runtime; enqueue stays domain-specific.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import type { Tx } from "../db/types";
import type { CreateNotificationInput } from "../notifications";
import {
  deliverOutboxIntent,
  flushOutbox,
} from "../notifications/outboxRuntime";
import {
  countOutboxBacklog,
  listEligibleOutboxKeys,
  recordOutboxFailure,
} from "../notifications/outboxAdapterHelpers";

/** Snapshot recipients/content now; keyed by the notification dedupeKey. */
export async function enqueueAttendanceNotice(
  tx: Tx,
  payload: CreateNotificationInput,
) {
  await tx.attendanceNotificationOutbox.create({
    data: {
      dedupeKey: payload.dedupeKey,
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });
}

const attendanceAdapters = {
  findPending: async (dedupeKey: string) => {
    const intent = await prisma.attendanceNotificationOutbox.findUnique({
      where: { dedupeKey },
    });
    if (!intent) return null;
    return {
      // Set key.
      key: intent.dedupeKey,
      // Set payload.
      payload: intent.payload,
      // Set deliveredAt.
      deliveredAt: intent.deliveredAt,
    };
  },
  // Set markDelivered.
  markDelivered: async (dedupeKey: string) => {
    await prisma.attendanceNotificationOutbox.update({
      where: { dedupeKey },
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
export async function deliverAttendanceNotice(
  dedupeKey: string,
): Promise<void> {
  await deliverOutboxIntent(dedupeKey, attendanceAdapters);
}

/**
 * Best-effort post-commit delivery. A failure here must never fail the HTTP
 * response — the intent stays pending and the background flush repairs it.
 */
export async function tryDeliverAttendanceNotice(
  dedupeKey: string,
): Promise<void> {
  try {
    await deliverAttendanceNotice(dedupeKey);
  } catch {
    // Intent remains undelivered; flushAttendanceNotificationOutbox repairs.
  }
}

/** Bounded background recovery for crash / first-delivery failure. */
export async function flushAttendanceNotificationOutbox() {
  return flushOutbox({
    listEligibleKeys: () => listEligibleOutboxKeys(prisma, "attendance"),
    deliver: deliverAttendanceNotice,
    recordFailure: (key, kind, message) =>
      // Invoke recordOutboxFailure.
      recordOutboxFailure(prisma, "attendance", key, kind, message),
    countBacklog: () => countOutboxBacklog(prisma, "attendance"),
    errorLabel: "Attendance notification delivery failed",
  });
}
