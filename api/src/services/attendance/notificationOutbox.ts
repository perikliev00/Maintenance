/**
 * Durable attendance-adjustment notice intents.
 * Delivery/flush use the shared outbox runtime; enqueue stays domain-specific.
 */
import type { Prisma } from "@prisma/client";
// Shared Prisma client singleton.
import { prisma } from "../../db";
// Type-only import from ../db/types (erased at runtime).
import type { Tx } from "../db/types";
// Type-only import from ../notifications (erased at runtime).
import type { CreateNotificationInput } from "../notifications";
// Module import required below.
import {
  deliverOutboxIntent,
  flushOutbox,
// Support the surrounding control flow.
} from "../notifications/outboxRuntime";
// Module import required below.
import {
  countOutboxBacklog,
  listEligibleOutboxKeys,
  recordOutboxFailure,
// Support the surrounding control flow.
} from "../notifications/outboxAdapterHelpers";

/** Snapshot recipients/content now; keyed by the notification dedupeKey. */
export async function enqueueAttendanceNotice(
  // Param tx required by this function.
  tx: Tx,
  // Param payload required by this function.
  payload: CreateNotificationInput,
) {
  // Await side effect before continuing.
  await tx.attendanceNotificationOutbox.create({
    // Mutation data payload.
    data: {
      // Field dedupeKey on this type/payload.
      dedupeKey: payload.dedupeKey,
      // Time field payload.
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });
}

// Local attendanceAdapters used below.
const attendanceAdapters = {
  // Field findPending on this type/payload.
  findPending: async (dedupeKey: string) => {
    // Fetch intent by unique/first match.
    const intent = await prisma.attendanceNotificationOutbox.findUnique({
      // Filter matching rows.
      where: { dedupeKey },
    });
    // Guard missing required data.
    if (!intent) return null;
    // Return response object.
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
    // Persist field updates.
    await prisma.attendanceNotificationOutbox.update({
      // Filter matching rows.
      where: { dedupeKey },
      // Mutation data payload.
      data: {
        // Time field deliveredAt.
        deliveredAt: new Date(),
        // Time field nextAttemptAt.
        nextAttemptAt: null,
        // Time field failedPermanentlyAt.
        failedPermanentlyAt: null,
        // Field lastError on this type/payload.
        lastError: null,
      },
    });
  },
};

/** Idempotent delivery; unique (recipient, dedupeKey) repairs partial inserts. */
export async function deliverAttendanceNotice(
  // Param dedupeKey required by this function.
  dedupeKey: string,
): Promise<void> {
  // Await side effect before continuing.
  await deliverOutboxIntent(dedupeKey, attendanceAdapters);
}

/**
 * Best-effort post-commit delivery. A failure here must never fail the HTTP
 * response — the intent stays pending and the background flush repairs it.
 */
export async function tryDeliverAttendanceNotice(
  // Param dedupeKey required by this function.
  dedupeKey: string,
): Promise<void> {
  // Catch locally so callers get mapped errors.
  try {
    // Await side effect before continuing.
    await deliverAttendanceNotice(dedupeKey);
  // Support the surrounding control flow.
  } catch {
    // Intent remains undelivered; flushAttendanceNotificationOutbox repairs.
  }
}

/** Bounded background recovery for crash / first-delivery failure. */
export async function flushAttendanceNotificationOutbox() {
  // Return computed result.
  return flushOutbox({
    // Param listEligibleKeys required by this function.
    listEligibleKeys: () => listEligibleOutboxKeys(prisma, "attendance"),
    // Param deliver required by this function.
    deliver: deliverAttendanceNotice,
    // Param recordFailure required by this function.
    recordFailure: (key, kind, message) =>
      // Invoke recordOutboxFailure.
      recordOutboxFailure(prisma, "attendance", key, kind, message),
    // Param countBacklog required by this function.
    countBacklog: () => countOutboxBacklog(prisma, "attendance"),
    // Param errorLabel required by this function.
    errorLabel: "Attendance notification delivery failed",
  });
}
