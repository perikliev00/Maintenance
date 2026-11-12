/**
 * Shared cleaning commandId replay: pre-tx load, in-tx TOCTOU re-check, P2002 replay.
 * Callers supply load + payload match; concurrent guards stay in the transaction.
 */
import type { Prisma } from "@prisma/client";
// Import ./idempotency for cleaning/commandReplay.ts.
import { assertCleaningCommandPayloadMatch } from "./idempotency";
// Import ./prismaConflicts for cleaning/commandReplay.ts.
import { isP2002 } from "./prismaConflicts";

// Local structural type for this module's contracts.
type TxClient = Prisma.TransactionClient;

/** Pre-transaction idempotency read; 409 when commandId payload mismatches. */
export async function loadCleaningCommandPreTx<T>(
  load: () => Promise<T | null>,
  payloadMatches: (row: T) => boolean,
): Promise<T | null> {
  // Load existing needed for the next decision or write.
  const existing = await load();
  // Branch when this condition holds for the domain rule.
  if (existing) {
    // Execute: assertCleaningCommandPayloadMatch(payloadMatches(existing));
    assertCleaningCommandPayloadMatch(payloadMatches(existing));
  }
  return existing;
}

/** In-transaction TOCTOU re-check after domain locks (same semantics as pre-tx). */
export async function loadCleaningCommandInTx<T>(
  tx: TxClient,
  load: (client: TxClient) => Promise<T | null>,
  payloadMatches: (row: T) => boolean,
): Promise<T | null> {
  // Load replay needed for the next decision or write.
  const replay = await load(tx);
  // Branch when this condition holds for the domain rule.
  if (replay) {
    // Execute: assertCleaningCommandPayloadMatch(payloadMatches(replay));
    assertCleaningCommandPayloadMatch(payloadMatches(replay));
  }
  return replay;
}

/**
 * After a unique-index race on commandId, re-read the winner row or return null
 * so the caller can map other P2002 targets (e.g. running-session indexes).
 */
export async function replayCleaningCommandOnP2002<T>(
  err: unknown,
  load: () => Promise<T | null>,
  payloadMatches: (row: T) => boolean,
): Promise<T | null> {
  // Guard: handle missing/invalid state before continuing.
  if (!isP2002(err)) return null;
  // Load again needed for the next decision or write.
  const again = await load();
  // Branch when this condition holds for the domain rule.
  if (again) {
    // Execute: assertCleaningCommandPayloadMatch(payloadMatches(again));
    assertCleaningCommandPayloadMatch(payloadMatches(again));
    return again;
  }
  // Early return of a terminal empty/boolean result.
  return null;
}
