import { publish } from "../../events/bus";
import { createNotifications } from "../notifications";
import type { TicketWithRelations } from "./types";

export async function notifyTicketEvent(input: {
  type: string;
  title: string;
  body: string;
  ticket: TicketWithRelations;
  actorEmployeeId: string | null;
  recipientEmployeeIds: string[];
  dedupeKey: string;
}) {
  const locNum = input.ticket.location?.number;
  await createNotifications({
    type: input.type,
    title: input.title,
    body: input.body,
    entityType: "ticket",
    entityId: input.ticket.id,
    locationId: input.ticket.locationId,
    actorEmployeeId: input.actorEmployeeId,
    recipientEmployeeIds: input.recipientEmployeeIds,
    dedupeKey: input.dedupeKey,
    payload: {
      panel: "repairs",
      ticketId: input.ticket.id,
      locationId: input.ticket.locationId,
      locationNumber: locNum,
    },
  });
}

export function publishTicketChanged(ticket: { locationId: string; id: string }) {
  publish("ticket.changed", {
    locationId: ticket.locationId,
    ticketId: ticket.id,
  });
}
