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

type Tx = Prisma.TransactionClient;

/** Lock users in a stable order for a writer which can change live access. */
export async function lockUsersForLiveAccess(
  tx: Tx,
  userIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(userIds)].sort();
  if (!ids.length) return;
  await tx.$executeRaw`
    SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE
  `;
}

/** Lock accounts identified by employee ids (sector ownership is employee based). */
export async function lockEmployeesForLiveAccess(
  tx: Tx,
  employeeIds: readonly (string | null | undefined)[],
): Promise<void> {
  const ids = [
    ...new Set(employeeIds.filter((id): id is string => Boolean(id))),
  ].sort();
  if (!ids.length) return;
  await tx.$executeRaw`
    SELECT id FROM "User" WHERE "employeeId" IN (${Prisma.join(ids)})
    ORDER BY id FOR UPDATE
  `;
}
