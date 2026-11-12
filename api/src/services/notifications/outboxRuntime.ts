/**
 * Shared notification-outbox delivery / flush helpers.
 * Domain modules keep their own enqueue + Prisma table adapters.
 *
 * Flush selects only *eligible* intents (not quarantined, nextAttempt due) so
 * a stuck batch of permanent failures cannot starve newer valid rows.
 */
import { z } from "zod/v3";
// Import module dependency for this service.
import {
  // Run next step: createNotifications,
  createNotifications,
  // Declare type CreateNotificationInput for callers and internals.
  type CreateNotificationInput,
// Run next step: } from "../notifications";
} from "../notifications";
// Import module ../settings for this service.
import { getSetting } from "../settings";

/** Cap for one flush batch (fairness window). */
export const OUTBOX_FLUSH_BATCH_SIZE = 100;

/** Transient failures beyond this are quarantined as permanent. */
export const OUTBOX_MAX_TRANSIENT_ATTEMPTS = 8;

/** Zod decoder for persisted CreateNotificationInput JSON (rejects malformed rows). */
export const createNotificationInputSchema: z.ZodType<CreateNotificationInput> =
  // Run next step: z.object({
  z.object({
    // Set type on the structure being built.
    type: z.string().min(1),
    // Set title on the structure being built.
    title: z.string(),
    // Set body on the structure being built.
    body: z.string(),
    // Set entityType on the structure being built.
    entityType: z.string().min(1),
    // Set entityId on the structure being built.
    entityId: z.string().min(1),
    // Set locationId on the structure being built.
    locationId: z.string().nullable().optional(),
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: z.string().nullable().optional(),
    // Set recipientEmployeeIds on the structure being built.
    recipientEmployeeIds: z.array(z.string().min(1)),
    // Set dedupeKey on the structure being built.
    dedupeKey: z.string().min(1),
    // Set payload on the structure being built.
    payload: z.record(z.string(), z.unknown()).optional(),
  });

/** Parse persisted outbox JSON; throws on malformed payloads. */
export function decodeNotificationPayload(
  // Set raw on the structure being built.
  raw: unknown,
// Run next step: ): CreateNotificationInput {
): CreateNotificationInput {
  // Return the computed result to the caller.
  return createNotificationInputSchema.parse(raw);
}

// Declare type OutboxFailureKind for callers and internals.
export type OutboxFailureKind = "transient" | "permanent";

/** Permanent = malformed / unrecoverable payload; else retryable delivery. */
export function classifyOutboxError(err: unknown): OutboxFailureKind {
  // Branch when this condition holds so the right path runs.
  if (err instanceof z.ZodError) return "permanent";
  // Capture name for use in this scope.
  const name = err instanceof Error ? err.name : "";
  // Branch when this condition holds so the right path runs.
  if (name === "ZodError") return "permanent";
  // Return the computed result to the caller.
  return "transient";
}

/**
 * Exponential backoff after a transient failure (attemptCount is post-increment).
 * Caps at 1 hour: 30s, 60s, 120s, … 
 */
export function computeNextAttemptAt(
  // Set attemptCount on the structure being built.
  attemptCount: number,
  // Update now as control flow progresses.
  now = new Date(),
// Run next step: ): Date {
): Date {
  // Capture exp for use in this scope.
  const exp = Math.min(Math.max(attemptCount, 1) - 1, 10);
  // Capture seconds for use in this scope.
  const seconds = Math.min(3600, 30 * 2 ** exp);
  // Return the computed result to the caller.
  return new Date(now.getTime() + seconds * 1000);
}

/** Shared Prisma filter: undelivered, not quarantined, due for attempt. */
export function eligibleOutboxWhere(now = new Date()) {
  // Return the computed result to the caller.
  return {
    // Set deliveredAt on the structure being built.
    deliveredAt: null,
    // Set failedPermanentlyAt on the structure being built.
    failedPermanentlyAt: null,
    // Set OR on the structure being built.
    OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
  // Run next step: } as const;
  } as const;
}

// Declare type OutboxDeliverAdapters for callers and internals.
export type OutboxDeliverAdapters = {
  /** Load undelivered intent by domain key; null if missing. */
  findPending: (
    // Set key on the structure being built.
    key: string,
  // Run next step: ) => Promise<{ key: string; payload: unknown; deliveredAt: D…
  ) => Promise<{ key: string; payload: unknown; deliveredAt: Date | null } | null>;
  /** Mark intent delivered (also used when notifications are disabled). */
  markDelivered: (key: string) => Promise<void>;
};

/**
 * Idempotent delivery for one outbox intent.
 * Disabled in-app channel → mark delivered without creating rows.
 */
export async function deliverOutboxIntent(
  // Set key on the structure being built.
  key: string,
  // Set adapters on the structure being built.
  adapters: OutboxDeliverAdapters,
// Run next step: ): Promise<void> {
): Promise<void> {
  // Load intent asynchronously for the next steps.
  const intent = await adapters.findPending(key);
  // Branch when this condition holds so the right path runs.
  if (!intent || intent.deliveredAt) return;

  // Capture payload for use in this scope.
  const payload = decodeNotificationPayload(intent.payload);
  // Branch when this condition holds so the right path runs.
  if (!(await getSetting("notifications")).in_app.enabled) {
    // Wait for the async step before continuing.
    await adapters.markDelivered(key);
    // Exit early; nothing more to do on this path.
    return;
  }

  // Wait for the async step before continuing.
  await createNotifications(payload);
  // Wait for the async step before continuing.
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
  // Set deliver on the structure being built.
  deliver: (key: string) => Promise<void>;
  /** Record transient backoff or permanent quarantine after a failed deliver. */
  recordFailure: (
    // Set key on the structure being built.
    key: string,
    // Set kind on the structure being built.
    kind: OutboxFailureKind,
    // Set message on the structure being built.
    message: string,
  // Run next step: ) => Promise<void>;
  ) => Promise<void>;
  /** Post-flush backlog accounting (must not treat quarantined as “pending=0”). */
  countBacklog: () => Promise<OutboxBacklogCounts>;
  // Set errorLabel on the structure being built.
  errorLabel: string;
};

// Declare type OutboxFlushResult for callers and internals.
export type OutboxFlushResult = {
  // Set delivered on the structure being built.
  delivered: number;
  /**
   * Eligible undelivered intents remaining after this flush (due now).
   * Quarantined / future-scheduled rows are not included — see backlog fields.
   */
  pending: number;
  // Set batchFailures on the structure being built.
  batchFailures: number;
  // Set eligiblePending on the structure being built.
  eligiblePending: number;
  // Set scheduledRetry on the structure being built.
  scheduledRetry: number;
  // Set quarantined on the structure being built.
  quarantined: number;
  // Set backlog on the structure being built.
  backlog: number;
  // Run next step: error?: string;
  error?: string;
};

/** Bounded background recovery with retry / quarantine and honest backlog metrics. */
export async function flushOutbox(
  // Set adapters on the structure being built.
  adapters: OutboxFlushAdapters,
// Run next step: ): Promise<OutboxFlushResult> {
): Promise<OutboxFlushResult> {
  // Load keys asynchronously for the next steps.
  const keys = await adapters.listEligibleKeys();
  // Capture delivered for use in this scope.
  let delivered = 0;
  // Capture batch failures for use in this scope.
  let batchFailures = 0;
  // Iterate items to apply the same logic to each entry.
  for (const key of keys) {
    // Attempt the fallible work so errors can be handled below.
    try {
      // Wait for the async step before continuing.
      await adapters.deliver(key);
      // Run next step: delivered++;
      delivered++;
    // Run next step: } catch (err) {
    } catch (err) {
      // Run next step: batchFailures++;
      batchFailures++;
      // Capture kind for use in this scope.
      const kind = classifyOutboxError(err);
      // Capture message for use in this scope.
      const message = err instanceof Error ? err.message : String(err);
      // Attempt the fallible work so errors can be handled below.
      try {
        // Wait for the async step before continuing.
        await adapters.recordFailure(key, kind, message.slice(0, 500));
      // Run next step: } catch {
      } catch {
        // Best-effort; next flush will retry eligibility selection.
      }
    }
  }
  // Load counts asynchronously for the next steps.
  const counts = await adapters.countBacklog();
  // Capture result for use in this scope.
  const result: OutboxFlushResult = {
    // Run next step: delivered,
    delivered,
    // Set pending on the structure being built.
    pending: counts.eligiblePending,
    // Run next step: batchFailures,
    batchFailures,
    // Set eligiblePending on the structure being built.
    eligiblePending: counts.eligiblePending,
    // Set scheduledRetry on the structure being built.
    scheduledRetry: counts.scheduledRetry,
    // Set quarantined on the structure being built.
    quarantined: counts.quarantined,
    // Set backlog on the structure being built.
    backlog: counts.backlog,
  };
  // Branch when this condition holds so the right path runs.
  if (batchFailures > 0) {
    // Run next step: result.error = adapters.errorLabel;
    result.error = adapters.errorLabel;
  }
  // Return the computed result to the caller.
  return result;
}
