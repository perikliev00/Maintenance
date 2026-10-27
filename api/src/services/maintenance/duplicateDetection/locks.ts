/**
 * Transaction-scoped advisory locks for duplicate-safe ticket creates.
 */
import type { Tx } from "../types";

/**
 * Take a PostgreSQL transaction advisory lock keyed by the duplicate identity.
 * Must be called inside an open transaction before the active-duplicate recheck.
 */
export async function lockDuplicateIdentity(
  tx: Tx,
  identityKey: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identityKey}))`;
}
