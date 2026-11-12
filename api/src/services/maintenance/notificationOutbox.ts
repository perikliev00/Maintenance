/**
 * Durable ticket-outcome notice intents.
 * Delivery/flush use the shared outbox runtime; enqueue builds domain payload.
 */
import type { Prisma } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../notifications for this service.
import { type CreateNotificationInput } from "../notifications";
// Import module dependency for this service.
import {
  // Run next step: deliverOutboxIntent,
  deliverOutboxIntent,
  // Run next step: flushOutbox,
  flushOutbox,
// Run next step: } from "../notifications/outboxRuntime";
} from "../notifications/outboxRuntime";
// Import module dependency for this service.
import {
  // Run next step: countOutboxBacklog,
  countOutboxBacklog,
  // Run next step: listEligibleOutboxKeys,
  listEligibleOutboxKeys,
  // Run next step: recordOutboxFailure,
  recordOutboxFailure,
// Run next step: } from "../notifications/outboxAdapterHelpers";
} from "../notifications/outboxAdapterHelpers";
// Import type(s) Tx, TicketWithRelations for typing without runtime cost.
import type { Tx, TicketWithRelations } from "./types";

/** Snapshot recipients/content now, so replay never uses a later ticket state. */
export async function enqueueTicketOutcome(
  // Set tx on the structure being built.
  tx: Tx,
  // Set eventId on the structure being built.
  eventId: string,
  // Set ticket on the structure being built.
  ticket: TicketWithRelations,
  // Set outcome on the structure being built.
  outcome: "resolved" | "closed",
  // Set actorEmployeeId on the structure being built.
  actorEmployeeId: string,
// Run next step: ) {
) {
  // Capture payload for use in this scope.
  const payload: CreateNotificationInput = {
    // Set type on the structure being built.
    type: `ticket.${outcome}`,
    // Set title on the structure being built.
    title: `Ticket ${outcome}`,
    // Set body on the structure being built.
    body: `${ticket.location?.number ?? "?"}: ${ticket.title}`,
    // Set entityType on the structure being built.
    entityType: "ticket",
    // Set entityId on the structure being built.
    entityId: ticket.id,
    // Set locationId on the structure being built.
    locationId: ticket.locationId,
    // Run next step: actorEmployeeId,
    actorEmployeeId,
    // Set recipientEmployeeIds on the structure being built.
    recipientEmployeeIds: [
      // Run next step: ...new Set(
      ...new Set(
        // Run next step: [ticket.assigneeId, ticket.reportedByEmployeeId].filter(
        [ticket.assigneeId, ticket.reportedByEmployeeId].filter(
          // Run next step: (id): id is string => Boolean(id) && id !== actorEmployeeId,
          (id): id is string => Boolean(id) && id !== actorEmployeeId,
        ),
      ),
    ],
    // Set dedupeKey on the structure being built.
    dedupeKey: `ticket.${outcome}:${eventId}`,
    // Set payload on the structure being built.
    payload: {
      // Set panel on the structure being built.
      panel: "repairs",
      // Set ticketId on the structure being built.
      ticketId: ticket.id,
      // Set locationId on the structure being built.
      locationId: ticket.locationId,
      // Set locationNumber on the structure being built.
      locationNumber: ticket.location?.number ?? "?",
    },
  };
  // Wait for the async step before continuing.
  await tx.ticketNotificationOutbox.create({
    // Set data on the structure being built.
    data: {
      // Run next step: eventId,
      eventId,
      // Set payload on the structure being built.
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });
}

// Build ticket adapters object holding related fields.
const ticketAdapters = {
  // Set findPending on the structure being built.
  findPending: async (eventId: string) => {
    // Load intent asynchronously for the next steps.
    const intent = await prisma.ticketNotificationOutbox.findUnique({
      // Set where on the structure being built.
      where: { eventId },
    });
    // Branch when this condition holds so the right path runs.
    if (!intent) return null;
    // Return the computed result to the caller.
    return {
      // Set key on the structure being built.
      key: intent.eventId,
      // Set payload on the structure being built.
      payload: intent.payload,
      // Set deliveredAt on the structure being built.
      deliveredAt: intent.deliveredAt,
    };
  },
  // Set markDelivered on the structure being built.
  markDelivered: async (eventId: string) => {
    // Wait for the async step before continuing.
    await prisma.ticketNotificationOutbox.update({
      // Set where on the structure being built.
      where: { eventId },
      // Set data on the structure being built.
      data: {
        // Set deliveredAt on the structure being built.
        deliveredAt: new Date(),
        // Set nextAttemptAt on the structure being built.
        nextAttemptAt: null,
        // Set failedPermanentlyAt on the structure being built.
        failedPermanentlyAt: null,
        // Set lastError on the structure being built.
        lastError: null,
      },
    });
  },
};

/** Repeated/concurrent delivery repairs partial recipient inserts via unique keys. */
export async function deliverTicketOutcome(eventId: string): Promise<void> {
  // Wait for the async step before continuing.
  await deliverOutboxIntent(eventId, ticketAdapters);
}

/** Bounded background recovery also covers crashes and online calls without commandId. */
export async function flushTicketNotificationOutbox() {
  // Return the computed result to the caller.
  return flushOutbox({
    // Set listEligibleKeys on the structure being built.
    listEligibleKeys: () => listEligibleOutboxKeys(prisma, "ticket"),
    // Set deliver on the structure being built.
    deliver: deliverTicketOutcome,
    // Set recordFailure on the structure being built.
    recordFailure: (key, kind, message) =>
      // Run next step: recordOutboxFailure(prisma, "ticket", key, kind, message),
      recordOutboxFailure(prisma, "ticket", key, kind, message),
    // Set countBacklog on the structure being built.
    countBacklog: () => countOutboxBacklog(prisma, "ticket"),
    // Set errorLabel on the structure being built.
    errorLabel: "Ticket notification delivery failed",
  });
}
