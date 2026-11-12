/**
 * Shared notification-outbox delivery / flush helpers.
 * Domain modules keep their own enqueue + Prisma table adapters.
 *
 * Flush selects only *eligible* intents (not quarantined, nextAttempt due) so
 * a stuck batch of permanent failures cannot starve newer valid rows.
 */
import { z } from "zod/v3";
import {
  createNotifications,
  // Declare type CreateNotificationInput for callers and internals.
  type CreateNotificationInput,
} from "../notifications";
import { getSetting } from "../settings";

/** Cap for one flush batch (fairness window). */
export const OUTBOX_FLUSH_BATCH_SIZE = 100;

/** Transient failures beyond this are quarantined as permanent. */
export const OUTBOX_MAX_TRANSIENT_ATTEMPTS = 8;

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

// Declare type OutboxFailureKind for callers and internals.
export type OutboxFailureKind = "transient" | "permanent";

/** Permanent = malformed / unrecoverable payload; else retryable delivery. */
export function classifyOutboxError(err: unknown): OutboxFailureKind {
  if (err instanceof z.ZodError) return "permanent";
  const name = err instanceof Error ? err.name : "";
  if (name === "ZodError") return "permanent";
  return "transient";
}

/**
 * Exponential backoff after a transient failure (attemptCount is post-increment).
 * Caps at 1 hour: 30s, 60s, 120s, … 
 */
export function computeNextAttemptAt(
  attemptCount: number,
  now = new Date(),
): Date {
  const exp = Math.min(Math.max(attemptCount, 1) - 1, 10);
  const seconds = Math.min(3600, 30 * 2 ** exp);
  return new Date(now.getTime() + seconds * 1000);
}

/** Shared Prisma filter: undelivered, not quarantined, due for attempt. */
export function eligibleOutboxWhere(now = new Date()) {
  return {
    deliveredAt: null,
    failedPermanentlyAt: null,
    OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
  } as const;
}

// Declare type OutboxDeliverAdapters for callers and internals.
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
    // Exit early; nothing more to do on this path.
    return;
  }

  await createNotifications(payload);
  await adapters.markDelivered(key);
}

// Declare type OutboxBacklogCounts for callers and internals.
export type OutboxBacklogCounts = {
  /** Undelivered, not quarantined, nextAttempt due (or null). */
  eligiblePending: number;
  /** Undelivered with future nextAttemptAt. */
  scheduledRetry: number;
  /** Undelivered with failedPermanentlyAt set. */
  quarantined: number;
  /** All undelivered rows (eligible + scheduled + quarantined). */
  backlog: number;
};

// Declare type OutboxFlushAdapters for callers and internals.
export type OutboxFlushAdapters = {
  /** Eligible keys only (excludes quarantined / not-yet-due), oldest first, ≤ batch. */
  listEligibleKeys: () => Promise<string[]>;
  deliver: (key: string) => Promise<void>;
  /** Record transient backoff or permanent quarantine after a failed deliver. */
  recordFailure: (
    key: string,
    kind: OutboxFailureKind,
    message: string,
  ) => Promise<void>;
  /** Post-flush backlog accounting (must not treat quarantined as “pending=0”). */
  countBacklog: () => Promise<OutboxBacklogCounts>;
  errorLabel: string;
};

// Declare type OutboxFlushResult for callers and internals.
export type OutboxFlushResult = {
  delivered: number;
  /**
   * Eligible undelivered intents remaining after this flush (due now).
   * Quarantined / future-scheduled rows are not included — see backlog fields.
   */
  pending: number;
  batchFailures: number;
  eligiblePending: number;
  scheduledRetry: number;
  quarantined: number;
  backlog: number;
  error?: string;
};

/** Bounded background recovery with retry / quarantine and honest backlog metrics. */
export async function flushOutbox(
  adapters: OutboxFlushAdapters,
): Promise<OutboxFlushResult> {
  const keys = await adapters.listEligibleKeys();
  let delivered = 0;
  // Capture batch failures for use in this scope.
  let batchFailures = 0;
  // Iterate items to apply the same logic to each entry.
  for (const key of keys) {
    try {
      await adapters.deliver(key);
      delivered++;
    } catch (err) {
      batchFailures++;
      const kind = classifyOutboxError(err);
      const message = err instanceof Error ? err.message : String(err);
      try {
        await adapters.recordFailure(key, kind, message.slice(0, 500));
      } catch {
        // Best-effort; next flush will retry eligibility selection.
      }
    }
  }
  const counts = await adapters.countBacklog();
  const result: OutboxFlushResult = {
    delivered,
    pending: counts.eligiblePending,
    batchFailures,
    eligiblePending: counts.eligiblePending,
    scheduledRetry: counts.scheduledRetry,
    quarantined: counts.quarantined,
    backlog: counts.backlog,
  };
  if (batchFailures > 0) {
    result.error = adapters.errorLabel;
  }
  return result;
}
