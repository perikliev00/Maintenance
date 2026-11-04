/**
 * Prisma helpers shared by ticket / cleaning / attendance outbox flush adapters.
 */
import type { PrismaClient } from "@prisma/client";
import {
  OUTBOX_FLUSH_BATCH_SIZE,
  OUTBOX_MAX_TRANSIENT_ATTEMPTS,
  computeNextAttemptAt,
  eligibleOutboxWhere,
  type OutboxBacklogCounts,
  type OutboxFailureKind,
} from "./outboxRuntime";

type OutboxDelegate = {
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  findUnique: (args: unknown) => Promise<{
    attemptCount: number;
  } | null>;
  update: (args: unknown) => Promise<unknown>;
  count: (args: unknown) => Promise<number>;
};

function delegate(
  prisma: PrismaClient,
  table: "ticket" | "cleaning" | "attendance",
): OutboxDelegate {
  if (table === "ticket") return prisma.ticketNotificationOutbox as unknown as OutboxDelegate;
  if (table === "cleaning") return prisma.cleaningNotificationOutbox as unknown as OutboxDelegate;
  return prisma.attendanceNotificationOutbox as unknown as OutboxDelegate;
}

function idField(table: "ticket" | "cleaning" | "attendance"): string {
  if (table === "ticket") return "eventId";
  if (table === "cleaning") return "commandId";
  return "dedupeKey";
}

/** Oldest eligible keys (not quarantined, nextAttempt due), ≤ batch size. */
export async function listEligibleOutboxKeys(
  prisma: PrismaClient,
  table: "ticket" | "cleaning" | "attendance",
): Promise<string[]> {
  const id = idField(table);
  const rows = await delegate(prisma, table).findMany({
    where: eligibleOutboxWhere(),
    orderBy: [{ createdAt: "asc" }, { [id]: "asc" }],
    take: OUTBOX_FLUSH_BATCH_SIZE,
    select: { [id]: true },
  });
  return rows.map((r) => String(r[id]));
}

/** Backoff or quarantine after a failed deliver attempt. */
export async function recordOutboxFailure(
  prisma: PrismaClient,
  table: "ticket" | "cleaning" | "attendance",
  key: string,
  kind: OutboxFailureKind,
  message: string,
): Promise<void> {
  const id = idField(table);
  const row = await delegate(prisma, table).findUnique({
    where: { [id]: key },
    select: { attemptCount: true, deliveredAt: true, failedPermanentlyAt: true },
  });
  if (!row) return;
  const nextAttempt = (row.attemptCount ?? 0) + 1;
  const quarantine =
    kind === "permanent" || nextAttempt >= OUTBOX_MAX_TRANSIENT_ATTEMPTS;
  await delegate(prisma, table).update({
    where: { [id]: key },
    data: quarantine
      ? {
          attemptCount: nextAttempt,
          failedPermanentlyAt: new Date(),
          nextAttemptAt: null,
          lastError: message,
        }
      : {
          attemptCount: nextAttempt,
          nextAttemptAt: computeNextAttemptAt(nextAttempt),
          lastError: message,
        },
  });
}

/** Honest backlog split used in flush metrics. */
export async function countOutboxBacklog(
  prisma: PrismaClient,
  table: "ticket" | "cleaning" | "attendance",
): Promise<OutboxBacklogCounts> {
  const d = delegate(prisma, table);
  const now = new Date();
  const [eligiblePending, scheduledRetry, quarantined, backlog] =
    await Promise.all([
      d.count({ where: eligibleOutboxWhere(now) }),
      d.count({
        where: {
          deliveredAt: null,
          failedPermanentlyAt: null,
          nextAttemptAt: { gt: now },
        },
      }),
      d.count({
        where: { deliveredAt: null, failedPermanentlyAt: { not: null } },
      }),
      d.count({ where: { deliveredAt: null } }),
    ]);
  return { eligiblePending, scheduledRetry, quarantined, backlog };
}
