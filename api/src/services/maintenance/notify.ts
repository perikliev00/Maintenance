/**
 * Side effects after ticket mutations: in-app notifications + live event bus.
 */
import { publish } from "../../events/bus";
import { createNotifications } from "../notifications";
import type { TicketWithRelations } from "./types";

/**
 * Fan out an in-app notification for a ticket transition (panel: repairs).
 * `dedupeKey` must be stable across retries so replays do not spam the inbox.
 */
export async function notifyTicketEvent(input: {
  type: string;
  title: string;
  body: string;
  ticket: TicketWithRelations;
  actorEmployeeId: string | null;
  recipientEmployeeIds: string[];
  dedupeKey: string;
}) {
  // Optional room number for UI deep-link / display in the payload.
  const locNum = input.ticket.location?.number;
  // Persist + deliver; dedupeKey prevents duplicate alerts on replay.
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
    // Client routing hints for the Repairs panel.
    payload: {
      panel: "repairs",
      ticketId: input.ticket.id,
      locationId: input.ticket.locationId,
      locationNumber: locNum,
    },
  });
}

/**
 * Broadcast ticket.changed for live UIs (location + ticket ids only).
 * Subscribers refresh ticket lists / room readiness when this fires.
 */
export function publishTicketChanged(ticket: { locationId: string; id: string }) {
  // SSE subscribers refresh ticket lists / room readiness when this fires.
  publish("ticket.changed", {
    locationId: ticket.locationId,
    ticketId: ticket.id,
  });
}
