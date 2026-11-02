/**
 * Shared cleaning commandId replay: pre-tx load, in-tx TOCTOU re-check, P2002 replay.
 * Callers supply load + payload match; concurrent guards stay in the transaction.
 */
import type { Prisma } from "@prisma/client";
import { assertCleaningCommandPayloadMatch } from "./idempotency";
import { isP2002 } from "./prismaConflicts";

type TxClient = Prisma.TransactionClient;

/** Pre-transaction idempotency read; 409 when commandId payload mismatches. */
export async function loadCleaningCommandPreTx<T>(
  load: () => Promise<T | null>,
  payloadMatches: (row: T) => boolean,
): Promise<T | null> {
  const existing = await load();
  if (existing) {
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
  const replay = await load(tx);
  if (replay) {
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
  if (!isP2002(err)) return null;
  const again = await load();
  if (again) {
    assertCleaningCommandPayloadMatch(payloadMatches(again));
    return again;
  }
  return null;
}
