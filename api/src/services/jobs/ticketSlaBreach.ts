/**
 * Background job: notify on open tickets past dueAt (SLA not paused).
 * Dedupes via a recent `ticket.sla_breach` audit within 12 hours.
 */
// Ticket, audit, and notification tables for breach scan + dedupe.
import { prisma } from "../../db";
// Status filter shared with ticket list queries (excludes waiting/terminal).
import { OPEN_TICKET_STATUSES } from "../../constants";
import { recordAudit } from "../audit";
// SSE bus for live ticket panels after breach is recorded.
import { publish } from "../../events/bus";
import {
  createNotifications,
  recipientsForLocationOps,
} from "../notifications";
import { startJobRun, finishJobRun } from "./runLifecycle";

/**
 * Find past-due open tickets and emit breach notifications/audits.
 * @returns Counts of breached tickets scanned and those that created inbox rows.
 */
export async function runTicketSlaBreach() {
  // Persist JobRun row for ops visibility before any DB work.
  const run = await startJobRun("ticket_sla_breach");
  try {
    // Single clock for dueAt comparison, dedupe window, and notification keys.
    const now = new Date();
    // Open + past dueAt + SLA not paused (waiting tickets are excluded).
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
    // Empty result still finishes JobRun ok with zero counts.

    // Tickets that actually inserted at least one notification this run.
    let notified = 0;
    for (const ticket of tickets) {
      // The most recent audit timestamp identifies the dedupe bucket. Keep
      // scanning when the audit exists so a partial recipient set can heal.
      const recent = await prisma.auditEvent.findFirst({
        where: {
          entityType: "maintenance_ticket",
          entityId: ticket.id,
          action: "ticket.sla_breach",
          occurredAt: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
        },
        select: { id: true, occurredAt: true },
      });
      const breachAt = recent?.occurredAt ?? now;

      // Assignee plus ops with tickets.assign for this location's scope.
      // Location-scoped ops holding tickets.assign receive supervisor copies.
      const supervisors = await recipientsForLocationOps(
        ticket.locationId,
        "tickets.assign",
      );
      // Assignee first when present; supervisors may overlap (deduped downstream).
      const recipients = [
        ...(ticket.assigneeId ? [ticket.assigneeId] : []),
        ...supervisors,
      ];
      // Reuse the audit's hour bucket so an interrupted delivery is repaired
      // without creating duplicate notifications for already delivered users.
      const result = await createNotifications({
        type: "ticket.sla_breach",
        title: "Ticket SLA breached",
        body: `${ticket.location.number}: ${ticket.title}`,
        entityType: "ticket",
        entityId: ticket.id,
        locationId: ticket.locationId,
        actorEmployeeId: null,
        recipientEmployeeIds: recipients,
        dedupeKey: `ticket.sla_breach:${ticket.id}:${breachAt.toISOString().slice(0, 13)}`,
        payload: {
          // Deep-link hints for the web client notification drawer.
          panel: "repairs",
          ticketId: ticket.id,
          locationId: ticket.locationId,
          locationNumber: ticket.location.number,
        },
      });
      // Write the dedupe marker after the idempotent notification inserts.
      // A restart before this point retries with the same hour bucket.
      if (!recent) {
        await recordAudit({
          actorEmployeeId: null,
          action: "ticket.sla_breach",
          entityType: "maintenance_ticket",
          entityId: ticket.id,
          after: { status: ticket.status, dueAt: ticket.dueAt?.toISOString() ?? null },
        });
        publish("ticket.changed", { ticketId: ticket.id, locationId: ticket.locationId });
      }
      // Count only tickets that actually created at least one notification row.
      if (result.created > 0) notified += 1;
    }

    // Mark JobRun success with scan vs notify counts for the jobs panel.
    await finishJobRun(run.id, "ok", {
      breached: tickets.length,
      notified,
    });
    return { breached: tickets.length, notified };
  } catch (err) {
    // Normalize unknown throwables to a string stored on the JobRun row.
    const message = err instanceof Error ? err.message : String(err);
    await finishJobRun(run.id, "error", undefined, message);
    // Propagate so the scheduler can log and apply retry/backoff policy.
    throw err;
  }
}
