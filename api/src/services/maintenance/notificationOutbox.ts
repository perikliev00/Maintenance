/**
 * Durable ticket-outcome notice intents.
 * Delivery/flush use the shared outbox runtime; enqueue builds domain payload.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { type CreateNotificationInput } from "../notifications";
import {
  deliverOutboxIntent,
  flushOutbox,
} from "../notifications/outboxRuntime";
import {
  countOutboxBacklog,
  listEligibleOutboxKeys,
  recordOutboxFailure,
} from "../notifications/outboxAdapterHelpers";
import type { Tx, TicketWithRelations } from "./types";

/** Snapshot recipients/content now, so replay never uses a later ticket state. */
export async function enqueueTicketOutcome(
  tx: Tx,
  eventId: string,
  ticket: TicketWithRelations,
  outcome: "resolved" | "closed",
  actorEmployeeId: string,
) {
  const payload: CreateNotificationInput = {
    type: `ticket.${outcome}`,
    title: `Ticket ${outcome}`,
    body: `${ticket.location?.number ?? "?"}: ${ticket.title}`,
    entityType: "ticket",
    entityId: ticket.id,
    locationId: ticket.locationId,
    actorEmployeeId,
    recipientEmployeeIds: [
      ...new Set(
        [ticket.assigneeId, ticket.reportedByEmployeeId].filter(
          (id): id is string => Boolean(id) && id !== actorEmployeeId,
        ),
      ),
    ],
    dedupeKey: `ticket.${outcome}:${eventId}`,
    payload: {
      panel: "repairs",
      ticketId: ticket.id,
      locationId: ticket.locationId,
      locationNumber: ticket.location?.number ?? "?",
    },
  };
  await tx.ticketNotificationOutbox.create({
    data: {
      eventId,
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });
}

const ticketAdapters = {
  findPending: async (eventId: string) => {
    const intent = await prisma.ticketNotificationOutbox.findUnique({
      where: { eventId },
    });
    if (!intent) return null;
    return {
      key: intent.eventId,
      payload: intent.payload,
      deliveredAt: intent.deliveredAt,
    };
  },
  markDelivered: async (eventId: string) => {
    await prisma.ticketNotificationOutbox.update({
      where: { eventId },
      data: {
        deliveredAt: new Date(),
        nextAttemptAt: null,
        failedPermanentlyAt: null,
        lastError: null,
      },
    });
  },
};

/** Repeated/concurrent delivery repairs partial recipient inserts via unique keys. */
export async function deliverTicketOutcome(eventId: string): Promise<void> {
  await deliverOutboxIntent(eventId, ticketAdapters);
}

/** Bounded background recovery also covers crashes and online calls without commandId. */
export async function flushTicketNotificationOutbox() {
  return flushOutbox({
    listEligibleKeys: () => listEligibleOutboxKeys(prisma, "ticket"),
    deliver: deliverTicketOutcome,
    recordFailure: (key, kind, message) =>
      recordOutboxFailure(prisma, "ticket", key, kind, message),
    countBacklog: () => countOutboxBacklog(prisma, "ticket"),
    errorLabel: "Ticket notification delivery failed",
  });
}
