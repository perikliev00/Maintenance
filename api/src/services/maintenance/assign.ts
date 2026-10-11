import { TicketStatus } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { assertActiveMaintenanceAssignee } from "../assignees";
import { claimTicketUpdate } from "./claims";
import { writeTicketEvent } from "./events";
import { formatMaintenanceTicket } from "./format";
import { loadLockedTicket } from "./locks";
import { notifyTicketEvent, publishTicketChanged } from "./notify";

export async function assignMaintenanceTicket(input: {
  ticketId: string;
  assigneeId: string;
  actorEmployeeId: string;
}) {
  await assertActiveMaintenanceAssignee(input.assigneeId);

  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await loadLockedTicket(tx, input.ticketId);
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

    const fromStatus = ticket.status;
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

  publishTicketChanged(updated);
  await notifyTicketEvent({
    type: "ticket.assigned",
    title: "Ticket assigned to you",
    body: `${updated.location?.number ?? "?"}: ${updated.title}`,
    ticket: updated,
    actorEmployeeId: input.actorEmployeeId,
    recipientEmployeeIds: [input.assigneeId],
    dedupeKey: `ticket.assigned:${updated.id}:${input.assigneeId}`,
  });
  return formatMaintenanceTicket(updated);
}
