/**
 * Conditional status updates: only apply if the ticket is still in an allowed state.
 */
import { Prisma, TicketStatus } from "@prisma/client";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ./types for this service.
import { ticketInclude, type Tx } from "./types";

/**
 * Atomic claim: `updateMany` with status ∈ fromStatuses.
 * Zero rows means another transaction won the race or the ticket left the
 * expected state — surface 409 with the current status rather than overwriting.
 */
export async function claimTicketUpdate(
  // Set tx on the structure being built.
  tx: Tx,
  // Set ticketId on the structure being built.
  ticketId: string,
  // Set fromStatuses on the structure being built.
  fromStatuses: TicketStatus[],
  // Set data on the structure being built.
  data: Prisma.MaintenanceTicketUncheckedUpdateManyInput,
  // Set invalidMessage on the structure being built.
  invalidMessage: (status: TicketStatus) => string,
// Run next step: ) {
) {
  // Status predicate doubles as the concurrency claim under the row lock.
  const claimed = await tx.maintenanceTicket.updateMany({
    // Set where on the structure being built.
    where: { id: ticketId, status: { in: fromStatuses } },
    // Run next step: data,
    data,
  });
  // Zero rows → status left the allowed set (or ticket vanished).
  if (claimed.count === 0) {
    // Re-read to distinguish 404 vs 409 for the client.
    const current = await tx.maintenanceTicket.findUnique({
      // Set where on the structure being built.
      where: { id: ticketId },
    });
    // Ticket deleted between lock and claim (rare).
    if (!current) {
      // Abort with an error so callers can react.
      throw new AppError(404, "not_found", "Ticket not found");
    }
    // Surface the actual status so clients can refresh.
    throw new AppError(409, "invalid_state", invalidMessage(current.status));
  }
  // Reload with relations for API response / notifications.
  return tx.maintenanceTicket.findUniqueOrThrow({
    // Set where on the structure being built.
    where: { id: ticketId },
    // Set include on the structure being built.
    include: ticketInclude,
  });
}
