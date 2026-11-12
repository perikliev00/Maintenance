/**
 * Prisma helpers shared by ticket / cleaning / attendance outbox flush adapters.
 */
import type { PrismaClient } from "@prisma/client";
// Import module dependency for this service.
import {
  // Run next step: OUTBOX_FLUSH_BATCH_SIZE,
  OUTBOX_FLUSH_BATCH_SIZE,
  // Run next step: OUTBOX_MAX_TRANSIENT_ATTEMPTS,
  OUTBOX_MAX_TRANSIENT_ATTEMPTS,
  // Run next step: computeNextAttemptAt,
  computeNextAttemptAt,
  // Run next step: eligibleOutboxWhere,
  eligibleOutboxWhere,
  // Declare type OutboxBacklogCounts for callers and internals.
  type OutboxBacklogCounts,
  // Declare type OutboxFailureKind for callers and internals.
  type OutboxFailureKind,
// Run next step: } from "./outboxRuntime";
} from "./outboxRuntime";

// Declare type OutboxDelegate for callers and internals.
type OutboxDelegate = {
  // Set findMany on the structure being built.
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  // Set findUnique on the structure being built.
  findUnique: (args: unknown) => Promise<{
    // Set attemptCount on the structure being built.
    attemptCount: number;
  // Run next step: } | null>;
  } | null>;
  // Set update on the structure being built.
  update: (args: unknown) => Promise<unknown>;
  // Set count on the structure being built.
  count: (args: unknown) => Promise<number>;
};

// Define delegate — core behavior for this module.
function delegate(
  // Set prisma on the structure being built.
  prisma: PrismaClient,
  // Set table on the structure being built.
  table: "ticket" | "cleaning" | "attendance",
// Run next step: ): OutboxDelegate {
): OutboxDelegate {
  // Branch when this condition holds so the right path runs.
  if (table === "ticket") return prisma.ticketNotificationOutbox as unknown as OutboxDelegate;
  // Branch when this condition holds so the right path runs.
  if (table === "cleaning") return prisma.cleaningNotificationOutbox as unknown as OutboxDelegate;
  // Return the computed result to the caller.
  return prisma.attendanceNotificationOutbox as unknown as OutboxDelegate;
}

// Define idField — core behavior for this module.
function idField(table: "ticket" | "cleaning" | "attendance"): string {
  // Branch when this condition holds so the right path runs.
  if (table === "ticket") return "eventId";
  // Branch when this condition holds so the right path runs.
  if (table === "cleaning") return "commandId";
  // Return the computed result to the caller.
  return "dedupeKey";
}

/** Oldest eligible keys (not quarantined, nextAttempt due), ≤ batch size. */
export async function listEligibleOutboxKeys(
  // Set prisma on the structure being built.
  prisma: PrismaClient,
  // Set table on the structure being built.
  table: "ticket" | "cleaning" | "attendance",
// Run next step: ): Promise<string[]> {
): Promise<string[]> {
  // Capture id for use in this scope.
  const id = idField(table);
  // Load rows asynchronously for the next steps.
  const rows = await delegate(prisma, table).findMany({
    // Set where on the structure being built.
    where: eligibleOutboxWhere(),
    // Set orderBy on the structure being built.
    orderBy: [{ createdAt: "asc" }, { [id]: "asc" }],
    // Set take on the structure being built.
    take: OUTBOX_FLUSH_BATCH_SIZE,
    // Set select on the structure being built.
    select: { [id]: true },
  });
  // Return the computed result to the caller.
  return rows.map((r) => String(r[id]));
}

/** Backoff or quarantine after a failed deliver attempt. */
export async function recordOutboxFailure(
  // Set prisma on the structure being built.
  prisma: PrismaClient,
  // Set table on the structure being built.
  table: "ticket" | "cleaning" | "attendance",
  // Set key on the structure being built.
  key: string,
  // Set kind on the structure being built.
  kind: OutboxFailureKind,
  // Set message on the structure being built.
  message: string,
// Run next step: ): Promise<void> {
): Promise<void> {
  // Capture id for use in this scope.
  const id = idField(table);
  // Load row asynchronously for the next steps.
  const row = await delegate(prisma, table).findUnique({
    // Set where on the structure being built.
    where: { [id]: key },
    // Set select on the structure being built.
    select: { attemptCount: true, deliveredAt: true, failedPermanentlyAt: true },
  });
  // Branch when this condition holds so the right path runs.
  if (!row) return;
  // Define nextAttempt as a callable used by this flow.
  const nextAttempt = (row.attemptCount ?? 0) + 1;
  // Capture quarantine for use in this scope.
  const quarantine =
    // Update kind as control flow progresses.
    kind === "permanent" || nextAttempt >= OUTBOX_MAX_TRANSIENT_ATTEMPTS;
  // Wait for the async step before continuing.
  await delegate(prisma, table).update({
    // Set where on the structure being built.
    where: { [id]: key },
    // Set data on the structure being built.
    data: quarantine
      // Complete the ternary or optional chain started above.
      ? {
          // Set attemptCount on the structure being built.
          attemptCount: nextAttempt,
          // Set failedPermanentlyAt on the structure being built.
          failedPermanentlyAt: new Date(),
          // Set nextAttemptAt on the structure being built.
          nextAttemptAt: null,
          // Set lastError on the structure being built.
          lastError: message,
        }
      // Complete the ternary or optional chain started above.
      : {
          // Set attemptCount on the structure being built.
          attemptCount: nextAttempt,
          // Set nextAttemptAt on the structure being built.
          nextAttemptAt: computeNextAttemptAt(nextAttempt),
          // Set lastError on the structure being built.
          lastError: message,
        },
  });
}

/** Honest backlog split used in flush metrics. */
export async function countOutboxBacklog(
  // Set prisma on the structure being built.
  prisma: PrismaClient,
  // Set table on the structure being built.
  table: "ticket" | "cleaning" | "attendance",
// Run next step: ): Promise<OutboxBacklogCounts> {
): Promise<OutboxBacklogCounts> {
  // Capture d for use in this scope.
  const d = delegate(prisma, table);
  // Capture now for use in this scope.
  const now = new Date();
  // Destructure value fields needed locally.
  const [eligiblePending, scheduledRetry, quarantined, backlog] =
    // Wait for the async step before continuing.
    await Promise.all([
      // Run next step: d.count({ where: eligibleOutboxWhere(now) }),
      d.count({ where: eligibleOutboxWhere(now) }),
      // Run next step: d.count({
      d.count({
        // Set where on the structure being built.
        where: {
          // Set deliveredAt on the structure being built.
          deliveredAt: null,
          // Set failedPermanentlyAt on the structure being built.
          failedPermanentlyAt: null,
          // Set nextAttemptAt on the structure being built.
          nextAttemptAt: { gt: now },
        },
      }),
      // Run next step: d.count({
      d.count({
        // Set where on the structure being built.
        where: { deliveredAt: null, failedPermanentlyAt: { not: null } },
      }),
      // Run next step: d.count({ where: { deliveredAt: null } }),
      d.count({ where: { deliveredAt: null } }),
    ]);
  // Return the computed result to the caller.
  return { eligiblePending, scheduledRetry, quarantined, backlog };
}
