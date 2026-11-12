/**
 * Row-level locks for ticket lifecycle mutations (serialize concurrent transitions).
 */
import { AppError } from "../../errors";
// Import type(s) Tx for typing without runtime cost.
import type { Tx } from "./types";

/**
 * Acquire a Postgres `FOR UPDATE` lock on the ticket row within the transaction.
 * Prevents two workers from racing on status/claim updates for the same ticket.
 */
export async function lockTicket(tx: Tx, ticketId: string) {
  // Row lock held until the surrounding transaction commits/rolls back.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "MaintenanceTicket" WHERE id = ${ticketId} FOR UPDATE
  `;
  // Missing id → 404 rather than proceeding with a stale in-memory ticket.
  if (rows.length === 0) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Ticket not found");
  }
}

/**
 * Lock then reload the full ticket row for status checks before claiming.
 * Callers must already be inside a Prisma transaction.
 */
export async function loadLockedTicket(tx: Tx, ticketId: string) {
  // Serialize concurrent lifecycle mutations on this ticket id.
  await lockTicket(tx, ticketId);
  // Reload full columns after the lock so status checks see committed state.
  const ticket = await tx.maintenanceTicket.findUnique({
    // Set where on the structure being built.
    where: { id: ticketId },
  });
  // Race: deleted between lock and findUnique (should be rare).
  if (!ticket) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Ticket not found");
  }
  // Return the computed result to the caller.
  return ticket;
}
