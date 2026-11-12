/**
 * Transaction-scoped advisory locks for duplicate-safe ticket creates.
 */
import type { Tx } from "../types";

/**
 * Take a PostgreSQL transaction advisory lock keyed by the duplicate identity.
 * Must be called inside an open transaction before the active-duplicate recheck.
 */
export async function lockDuplicateIdentity(
  // Set tx on the structure being built.
  tx: Tx,
  // Set identityKey on the structure being built.
  identityKey: string,
// Run next step: ): Promise<void> {
): Promise<void> {
  // Wait for the async step before continuing.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identityKey}))`;
}
