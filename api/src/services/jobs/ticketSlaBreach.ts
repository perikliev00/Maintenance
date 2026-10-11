import { prisma } from "../../db";
import { OPEN_TICKET_STATUSES } from "../../constants";
import { recordAudit } from "../audit";
import { publish } from "../../events/bus";
import {
  createNotifications,
  recipientsForLocationOps,
} from "../notifications";
import { startJobRun, finishJobRun } from "./runLifecycle";

export async function runTicketSlaBreach() {
  const run = await startJobRun("ticket_sla_breach");
  try {
    const now = new Date();
    const tickets = await prisma.maintenanceTicket.findMany({
      where: {
        status: { in: [...OPEN_TICKET_STATUSES] },
        dueAt: { lt: now },
        slaPausedAt: null,
      },
      select: {
        id: true,
        dueAt: true,
        status: true,
        locationId: true,
        title: true,
        assigneeId: true,
        location: { select: { number: true } },
      },
    });

    let notified = 0;
    for (const ticket of tickets) {
      const recent = await prisma.auditEvent.findFirst({
        where: {
          entityType: "maintenance_ticket",
          entityId: ticket.id,
          action: "ticket.sla_breach",
          occurredAt: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (recent) continue;

      await recordAudit({
        actorEmployeeId: null,
        action: "ticket.sla_breach",
        entityType: "maintenance_ticket",
        entityId: ticket.id,
        after: {
          status: ticket.status,
          dueAt: ticket.dueAt?.toISOString() ?? null,
        },
      });
      publish("ticket.changed", {
        ticketId: ticket.id,
        locationId: ticket.locationId,
      });

      const supervisors = await recipientsForLocationOps(
        ticket.locationId,
        "tickets.assign",
      );
      const recipients = [
        ...(ticket.assigneeId ? [ticket.assigneeId] : []),
        ...supervisors,
      ];
      const result = await createNotifications({
        type: "ticket.sla_breach",
        title: "Ticket SLA breached",
        body: `${ticket.location.number}: ${ticket.title}`,
        entityType: "ticket",
        entityId: ticket.id,
        locationId: ticket.locationId,
        actorEmployeeId: null,
        recipientEmployeeIds: recipients,
        dedupeKey: `ticket.sla_breach:${ticket.id}:${now.toISOString().slice(0, 13)}`,
        payload: {
          panel: "repairs",
          ticketId: ticket.id,
          locationId: ticket.locationId,
          locationNumber: ticket.location.number,
        },
      });
      if (result.created > 0) notified += 1;
    }

    await finishJobRun(run.id, "ok", {
      breached: tickets.length,
      notified,
    });
    return { breached: tickets.length, notified };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishJobRun(run.id, "error", undefined, message);
    throw err;
  }
}
