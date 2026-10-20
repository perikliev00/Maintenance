/**
 * Assign (or reassign) a ticket that is still in new/assigned.
 */
import { TicketStatus } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { assertActiveMaintenanceAssignee } from "../assignees";
import { claimTicketUpdate } from "./claims";
import { writeTicketEvent } from "./events";
import { formatMaintenanceTicket } from "./format";
import { loadLockedTicket } from "./locks";
import { notifyTicketEvent, publishTicketChanged } from "./notify";
import { lockEmployeesForLiveAccess } from "../liveAccessLocks";

/**
 * Sets assignee and status=assigned. Allowed only from new or assigned
 * (reassignment before work starts). Notifies the new assignee.
 */
export async function assignMaintenanceTicket(input: {
  ticketId: string;
  assigneeId: string;
  actorEmployeeId: string;
}) {
  // Reject inactive / non-technician assignees before opening a transaction.
  await assertActiveMaintenanceAssignee(input.assigneeId);

  // Serialize assign against concurrent start/wait/resolve on the same ticket.
  const updated = await prisma.$transaction(async (tx) => {
    // User locks before ticket lock (deadlock-safe vs SSE FOR SHARE).
    const preview = await tx.maintenanceTicket.findUnique({
      where: { id: input.ticketId },
      select: { assigneeId: true },
    });
    if (!preview) {
      throw new AppError(404, "not_found", "Ticket not found");
    }
    await lockEmployeesForLiveAccess(tx, [
      preview.assigneeId,
      input.assigneeId,
    ]);
    // Serialize concurrent assign/start on this ticket.
    const ticket = await loadLockedTicket(tx, input.ticketId);
    if (
      ticket.assigneeId &&
      ticket.assigneeId !== preview.assigneeId &&
      ticket.assigneeId !== input.assigneeId
    ) {
      throw new AppError(
        409,
        "conflict",
        "Ticket assignee changed concurrently; retry",
      );
    }
    // Only pre-work states may be (re)assigned.
    if (
      ticket.status !== TicketStatus.new &&
      ticket.status !== TicketStatus.assigned
    ) {
      throw new AppError(
        409,
        "invalid_state",
        `Cannot assign ticket in status ${ticket.status}`,
      );
    }

    // Re-check after ticket lock so a concurrent block/role change cannot slip in.
    await assertActiveMaintenanceAssignee(input.assigneeId, tx);

    // Capture fromStatus before the claim mutates the row.
    const fromStatus = ticket.status;
    // Conditional update — loses the race cleanly if status moved.
    const row = await claimTicketUpdate(
      tx,
      ticket.id,
      [TicketStatus.new, TicketStatus.assigned],
      {
        status: TicketStatus.assigned,
        assigneeId: input.assigneeId,
      },
      (status) => `Cannot assign ticket in status ${status}`,
    );

    // Timeline event for the ticket history panel.
    await writeTicketEvent(tx, {
      ticketId: ticket.id,
      locationId: ticket.locationId,
      fromStatus,
      toStatus: TicketStatus.assigned,
      actorEmployeeId: input.actorEmployeeId,
      payload: { assigneeId: input.assigneeId },
    });

    return row;
  });

  // Live SSE / bus update for open ticket views.
  publishTicketChanged(updated);
  // Inbox notification to the newly assigned technician.
  await notifyTicketEvent({
    type: "ticket.assigned",
    title: "Ticket assigned to you",
    body: `${updated.location?.number ?? "?"}: ${updated.title}`,
    ticket: updated,
    actorEmployeeId: input.actorEmployeeId,
    recipientEmployeeIds: [input.assigneeId],
    // Dedupe on ticket+assignee so retries do not spam.
    dedupeKey: `ticket.assigned:${updated.id}:${input.assigneeId}`,
  });
  // Legacy category alias for older clients.
  return formatMaintenanceTicket(updated);
}
