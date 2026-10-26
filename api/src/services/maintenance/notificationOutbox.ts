import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { createNotifications, type CreateNotificationInput } from "../notifications";
import { getSetting } from "../settings";
import type { Tx, TicketWithRelations } from "./types";

/** Snapshot recipients/content now, so replay never uses a later ticket state. */
export async function enqueueTicketOutcome(
  tx: Tx, eventId: string, ticket: TicketWithRelations,
  outcome: "resolved" | "closed", actorEmployeeId: string,
) {
  const payload: CreateNotificationInput = {
    type: `ticket.${outcome}`, title: `Ticket ${outcome}`,
    body: `${ticket.location?.number ?? "?"}: ${ticket.title}`,
    entityType: "ticket", entityId: ticket.id, locationId: ticket.locationId,
    actorEmployeeId,
    recipientEmployeeIds: [...new Set([ticket.assigneeId, ticket.reportedByEmployeeId]
      .filter((id): id is string => Boolean(id) && id !== actorEmployeeId))],
    dedupeKey: `ticket.${outcome}:${eventId}`,
    payload: { panel: "repairs", ticketId: ticket.id, locationId: ticket.locationId,
      locationNumber: ticket.location?.number ?? "?" },
  };
  await tx.ticketNotificationOutbox.create({ data: {
    eventId, payload: payload as unknown as Prisma.InputJsonValue,
  } });
}

/** Repeated/concurrent delivery repairs partial recipient inserts via unique keys. */
export async function deliverTicketOutcome(eventId: string): Promise<void> {
  const intent = await prisma.ticketNotificationOutbox.findUnique({ where: { eventId } });
  if (!intent || intent.deliveredAt) return;
  const payload = intent.payload as unknown as CreateNotificationInput;
  if (!(await getSetting("notifications")).in_app.enabled) {
    // Match existing disabled-channel behavior; do not backfill disabled notices.
    await prisma.ticketNotificationOutbox.update({ where: { eventId }, data: { deliveredAt: new Date() } });
    return;
  }
  await createNotifications(payload);
  await prisma.ticketNotificationOutbox.update({ where: { eventId }, data: { deliveredAt: new Date() } });
}

/** Bounded background recovery also covers crashes and online calls without commandId. */
export async function flushTicketNotificationOutbox() {
  const intents = await prisma.ticketNotificationOutbox.findMany({
    where: { deliveredAt: null }, orderBy: [{ createdAt: "asc" }, { eventId: "asc" }], take: 100,
  });
  let delivered = 0;
  const failures: string[] = [];
  for (const intent of intents) {
    try { await deliverTicketOutcome(intent.eventId); delivered++; }
    catch { failures.push(intent.eventId); }
  }
  return failures.length ? { delivered, pending: failures.length, error: "Ticket notification delivery failed" }
    : { delivered, pending: 0 };
}
