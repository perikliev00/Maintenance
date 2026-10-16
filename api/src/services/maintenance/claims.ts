/**
 * Conditional status updates: only apply if the ticket is still in an allowed state.
 */
import { Prisma, TicketStatus } from "@prisma/client";
import { AppError } from "../../errors";
import { ticketInclude, type Tx } from "./types";

/**
 * Atomic claim: `updateMany` with status ∈ fromStatuses.
 * Zero rows means another transaction won the race or the ticket left the
 * expected state — surface 409 with the current status rather than overwriting.
 */
export async function claimTicketUpdate(
  tx: Tx,
  ticketId: string,
  fromStatuses: TicketStatus[],
  data: Prisma.MaintenanceTicketUncheckedUpdateManyInput,
  invalidMessage: (status: TicketStatus) => string,
) {
  // Status predicate doubles as the concurrency claim under the row lock.
  const claimed = await tx.maintenanceTicket.updateMany({
    where: { id: ticketId, status: { in: fromStatuses } },
    data,
  });
  // Zero rows → status left the allowed set (or ticket vanished).
  if (claimed.count === 0) {
    // Re-read to distinguish 404 vs 409 for the client.
    const current = await tx.maintenanceTicket.findUnique({
      where: { id: ticketId },
    });
    // Ticket deleted between lock and claim (rare).
    if (!current) {
      throw new AppError(404, "not_found", "Ticket not found");
    }
    // Surface the actual status so clients can refresh.
    throw new AppError(409, "invalid_state", invalidMessage(current.status));
  }
  // Reload with relations for API response / notifications.
  return tx.maintenanceTicket.findUniqueOrThrow({
    where: { id: ticketId },
    include: ticketInclude,
  });
}
