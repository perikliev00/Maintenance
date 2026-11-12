/**
 * Shared lock helpers for live SSE authorization serialization.
 *
 * Protocol (lowest → highest conflict with SSE FOR SHARE):
 * 1. Writers take User FOR UPDATE (stable id order) before mutating access.
 * 2. SSE delivery takes User FOR SHARE, then reads session/scope and writes.
 * 3. Sector / Location locks (when needed) are acquired only after User locks
 *    so writers cannot deadlock against each other or against SSE.
 */
import { Prisma } from "@prisma/client";
// Import type(s) Tx for typing without runtime cost.
import type { Tx } from "./db/types";

/** Lock users in a stable order for a writer which can change live access. */
export async function lockUsersForLiveAccess(
  // Set tx on the structure being built.
  tx: Tx,
  // Set userIds on the structure being built.
  userIds: readonly string[],
// Run next step: ): Promise<void> {
): Promise<void> {
  // Collect ids list for later processing.
  const ids = [...new Set(userIds)].sort();
  // Branch when this condition holds so the right path runs.
  if (!ids.length) return;
  // Wait for the async step before continuing.
  await tx.$executeRaw`
    SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE
  `;
}

/** Lock accounts identified by employee ids (sector ownership is employee based). */
export async function lockEmployeesForLiveAccess(
  // Set tx on the structure being built.
  tx: Tx,
  // Set employeeIds on the structure being built.
  employeeIds: readonly (string | null | undefined)[],
// Run next step: ): Promise<void> {
): Promise<void> {
  // Collect ids list for later processing.
  const ids = [
    // Run next step: ...new Set(employeeIds.filter((id): id is string => Boolean(…
    ...new Set(employeeIds.filter((id): id is string => Boolean(id))),
  // Run next step: ].sort();
  ].sort();
  // Branch when this condition holds so the right path runs.
  if (!ids.length) return;
  // Wait for the async step before continuing.
  await tx.$executeRaw`
    SELECT id FROM "User" WHERE "employeeId" IN (${Prisma.join(ids)})
    ORDER BY id FOR UPDATE
  `;
}

/** Lock Employee rows (covers employees without a User account). */
export async function lockEmployeeRowsForUpdate(
  // Set tx on the structure being built.
  tx: Tx,
  // Set employeeIds on the structure being built.
  employeeIds: readonly (string | null | undefined)[],
// Run next step: ): Promise<void> {
): Promise<void> {
  // Collect ids list for later processing.
  const ids = [
    // Run next step: ...new Set(employeeIds.filter((id): id is string => Boolean(…
    ...new Set(employeeIds.filter((id): id is string => Boolean(id))),
  // Run next step: ].sort();
  ].sort();
  // Branch when this condition holds so the right path runs.
  if (!ids.length) return;
  // Wait for the async step before continuing.
  await tx.$executeRaw`
    SELECT id FROM "Employee" WHERE id IN (${Prisma.join(ids)})
    ORDER BY id FOR UPDATE
  `;
}
