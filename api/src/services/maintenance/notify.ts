/**
 * Side effects after ticket mutations: in-app notifications + live event bus.
 */
import { publish } from "../../events/bus";
// Import module ../notifications for this service.
import { createNotifications } from "../notifications";
// Import type(s) TicketWithRelations for typing without runtime cost.
import type { TicketWithRelations } from "./types";

/**
 * Fan out an in-app notification for a ticket transition (panel: repairs).
 * `dedupeKey` must be stable across retries so replays do not spam the inbox.
 */
export async function notifyTicketEvent(input: {
  // Set type on the structure being built.
  type: string;
  // Set title on the structure being built.
  title: string;
  // Set body on the structure being built.
  body: string;
  // Set ticket on the structure being built.
  ticket: TicketWithRelations;
  // Set actorEmployeeId on the structure being built.
  actorEmployeeId: string | null;
  // Set recipientEmployeeIds on the structure being built.
  recipientEmployeeIds: string[];
  // Set dedupeKey on the structure being built.
  dedupeKey: string;
// Run next step: }) {
}) {
  // Optional room number for UI deep-link / display in the payload.
  const locNum = input.ticket.location?.number;
  // Persist + deliver; dedupeKey prevents duplicate alerts on replay.
  await createNotifications({
    // Set type on the structure being built.
    type: input.type,
    // Set title on the structure being built.
    title: input.title,
    // Set body on the structure being built.
    body: input.body,
    // Set entityType on the structure being built.
    entityType: "ticket",
    // Set entityId on the structure being built.
    entityId: input.ticket.id,
    // Set locationId on the structure being built.
    locationId: input.ticket.locationId,
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: input.actorEmployeeId,
    // Set recipientEmployeeIds on the structure being built.
    recipientEmployeeIds: input.recipientEmployeeIds,
    // Set dedupeKey on the structure being built.
    dedupeKey: input.dedupeKey,
    // Client routing hints for the Repairs panel.
    payload: {
      // Set panel on the structure being built.
      panel: "repairs",
      // Set ticketId on the structure being built.
      ticketId: input.ticket.id,
      // Set locationId on the structure being built.
      locationId: input.ticket.locationId,
      // Set locationNumber on the structure being built.
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
    // Set locationId on the structure being built.
    locationId: ticket.locationId,
    // Set ticketId on the structure being built.
    ticketId: ticket.id,
  });
}
