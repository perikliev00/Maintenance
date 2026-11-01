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

      // Re-validate under row lock: status may have left the open set after the
      // scan snapshot (resolved/waiting/paused). Concurrent scans serialize here.
      const gate = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          { id: string; status: string; slaPausedAt: Date | null }[]
        >`
          SELECT id, status, "slaPausedAt"
          FROM "MaintenanceTicket"
          WHERE id = ${ticket.id}
          FOR UPDATE
        `;
        const current = locked[0];
        if (
          !current ||
          current.slaPausedAt != null ||
          !(OPEN_TICKET_STATUSES as readonly string[]).includes(current.status)
        ) {
          return { live: false as const, status: current?.status ?? null };
        }
        const stillRecent = await tx.auditEvent.findFirst({
          where: {
            entityType: "maintenance_ticket",
            entityId: ticket.id,
            action: "ticket.sla_breach",
            occurredAt: {
              gte: new Date(now.getTime() - 12 * 60 * 60 * 1000),
            },
          },
          select: { id: true, occurredAt: true },
        });
        if (!stillRecent) {
          await recordAudit(
            {
              actorEmployeeId: null,
              action: "ticket.sla_breach",
              entityType: "maintenance_ticket",
              entityId: ticket.id,
              // Scope-filtered audit readers need the room; omit → invisible under sector scope.
              locationId: ticket.locationId,
              summary: `SLA: ${ticket.location.number} — ${ticket.title}`,
              after: {
                status: current.status,
                dueAt: ticket.dueAt?.toISOString() ?? null,
                title: ticket.title,
                locationNumber: ticket.location.number,
                ticketId: ticket.id,
              },
            },
            tx,
          );
        }
        return {
          live: true as const,
          status: current.status,
          markerAt: stillRecent?.occurredAt ?? now,
          insertedMarker: !stillRecent,
        };
      });

      if (!gate.live) continue;

      if (gate.insertedMarker) {
        publish("ticket.changed", {
          ticketId: ticket.id,
          locationId: ticket.locationId,
        });
      }

      // Assignee plus ops with tickets.assign for this location's scope.
      const supervisors = await recipientsForLocationOps(
        ticket.locationId,
        "tickets.assign",
      );
      const recipients = [
        ...(ticket.assigneeId ? [ticket.assigneeId] : []),
        ...supervisors,
      ];
      // Prefer locked marker time; fall back to the pre-lock recent / now.
      const notifyAt = gate.markerAt ?? breachAt;
      const result = await createNotifications({
        type: "ticket.sla_breach",
        title: "Ticket SLA breached",
        body: `${ticket.location.number}: ${ticket.title}`,
        entityType: "ticket",
        entityId: ticket.id,
        locationId: ticket.locationId,
        actorEmployeeId: null,
        recipientEmployeeIds: recipients,
        dedupeKey: `ticket.sla_breach:${ticket.id}:${notifyAt.toISOString().slice(0, 13)}`,
        payload: {
          panel: "repairs",
          ticketId: ticket.id,
          locationId: ticket.locationId,
          locationNumber: ticket.location.number,
        },
      });
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
