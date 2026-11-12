/**
 * Background job: notify on open tickets past dueAt (SLA not paused).
 * Dedupes via a recent `ticket.sla_breach` audit within 12 hours.
 */
// Ticket, audit, and notification tables for breach scan + dedupe.
import { prisma } from "../../db";
// Status filter shared with ticket list queries (excludes waiting/terminal).
import { OPEN_TICKET_STATUSES } from "../../constants";
// Import module ../audit for this service.
import { recordAudit } from "../audit";
// SSE bus for live ticket panels after breach is recorded.
import { publish } from "../../events/bus";
// Import module dependency for this service.
import {
  // Run next step: createNotifications,
  createNotifications,
  // Run next step: recipientsForLocationOps,
  recipientsForLocationOps,
// Run next step: } from "../notifications";
} from "../notifications";
// Import module ./runLifecycle for this service.
import { withJobRun } from "./runLifecycle";

/**
 * Find past-due open tickets and emit breach notifications/audits.
 * @returns Counts of breached tickets scanned and those that created inbox rows.
 */
export async function runTicketSlaBreach() {
  // Return the computed result to the caller.
  return withJobRun("ticket_sla_breach", async () => {
    // Single clock for dueAt comparison, dedupe window, and notification keys.
    const now = new Date();
    // Open + past dueAt + SLA not paused (waiting tickets are excluded).
    const tickets = await prisma.maintenanceTicket.findMany({
      // Set where on the structure being built.
      where: {
        // Set status on the structure being built.
        status: { in: [...OPEN_TICKET_STATUSES] },
        // Set dueAt on the structure being built.
        dueAt: { lt: now },
        // Set slaPausedAt on the structure being built.
        slaPausedAt: null,
      },
      // Set select on the structure being built.
      select: {
        // Set id on the structure being built.
        id: true,
        // Set dueAt on the structure being built.
        dueAt: true,
        // Set status on the structure being built.
        status: true,
        // Set locationId on the structure being built.
        locationId: true,
        // Set title on the structure being built.
        title: true,
        // Set assigneeId on the structure being built.
        assigneeId: true,
        // Set location on the structure being built.
        location: { select: { number: true } },
      },
    });
    // Empty result still finishes JobRun ok with zero counts.

    // Tickets that actually inserted at least one notification this run.
    let notified = 0;
    // Iterate items to apply the same logic to each entry.
    for (const ticket of tickets) {
      // The most recent audit timestamp identifies the dedupe bucket. Keep
      // scanning when the audit exists so a partial recipient set can heal.
      const recent = await prisma.auditEvent.findFirst({
        // Set where on the structure being built.
        where: {
          // Set entityType on the structure being built.
          entityType: "maintenance_ticket",
          // Set entityId on the structure being built.
          entityId: ticket.id,
          // Set action on the structure being built.
          action: "ticket.sla_breach",
          // Set occurredAt on the structure being built.
          occurredAt: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
        },
        // Set select on the structure being built.
        select: { id: true, occurredAt: true },
      });
      // Capture breach at for use in this scope.
      const breachAt = recent?.occurredAt ?? now;

      // Re-validate under row lock: status may have left the open set after the
      // scan snapshot (resolved/waiting/paused). Concurrent scans serialize here.
      const gate = await prisma.$transaction(async (tx) => {
        // Load locked asynchronously for the next steps.
        const locked = await tx.$queryRaw<
          // Run next step: { id: string; status: string; slaPausedAt: Date | null }[]
          { id: string; status: string; slaPausedAt: Date | null }[]
        // Run next step: >`
        >`
          SELECT id, status, "slaPausedAt"
          FROM "MaintenanceTicket"
          WHERE id = ${ticket.id}
          FOR UPDATE
        `;
        // Capture current for use in this scope.
        const current = locked[0];
        // Branch when this condition holds so the right path runs.
        if (
          // Run next step: !current ||
          !current ||
          // Run next step: current.slaPausedAt != null ||
          current.slaPausedAt != null ||
          // Run next step: !(OPEN_TICKET_STATUSES as readonly string[]).includes(curren…
          !(OPEN_TICKET_STATUSES as readonly string[]).includes(current.status)
        // Run next step: ) {
        ) {
          // Return the computed result to the caller.
          return { live: false as const, status: current?.status ?? null };
        }
        // Load still recent asynchronously for the next steps.
        const stillRecent = await tx.auditEvent.findFirst({
          // Set where on the structure being built.
          where: {
            // Set entityType on the structure being built.
            entityType: "maintenance_ticket",
            // Set entityId on the structure being built.
            entityId: ticket.id,
            // Set action on the structure being built.
            action: "ticket.sla_breach",
            // Set occurredAt on the structure being built.
            occurredAt: {
              // Set gte on the structure being built.
              gte: new Date(now.getTime() - 12 * 60 * 60 * 1000),
            },
          },
          // Set select on the structure being built.
          select: { id: true, occurredAt: true },
        });
        // Branch when this condition holds so the right path runs.
        if (!stillRecent) {
          // Wait for the async step before continuing.
          await recordAudit(
            // Run next step: {
            {
              // Set actorEmployeeId on the structure being built.
              actorEmployeeId: null,
              // Set action on the structure being built.
              action: "ticket.sla_breach",
              // Set entityType on the structure being built.
              entityType: "maintenance_ticket",
              // Set entityId on the structure being built.
              entityId: ticket.id,
              // Scope-filtered audit readers need the room; omit → invisible under sector scope.
              locationId: ticket.locationId,
              // Set summary on the structure being built.
              summary: `SLA: ${ticket.location.number} — ${ticket.title}`,
              // Set after on the structure being built.
              after: {
                // Set status on the structure being built.
                status: current.status,
                // Set dueAt on the structure being built.
                dueAt: ticket.dueAt?.toISOString() ?? null,
                // Set title on the structure being built.
                title: ticket.title,
                // Set locationNumber on the structure being built.
                locationNumber: ticket.location.number,
                // Set ticketId on the structure being built.
                ticketId: ticket.id,
              },
            },
            // Run next step: tx,
            tx,
          );
        }
        // Return the computed result to the caller.
        return {
          // Set live on the structure being built.
          live: true as const,
          // Set status on the structure being built.
          status: current.status,
          // Set markerAt on the structure being built.
          markerAt: stillRecent?.occurredAt ?? now,
          // Set insertedMarker on the structure being built.
          insertedMarker: !stillRecent,
        };
      });

      // Branch when this condition holds so the right path runs.
      if (!gate.live) continue;

      // Branch when this condition holds so the right path runs.
      if (gate.insertedMarker) {
        // Run next step: publish("ticket.changed", {
        publish("ticket.changed", {
          // Set ticketId on the structure being built.
          ticketId: ticket.id,
          // Set locationId on the structure being built.
          locationId: ticket.locationId,
        });
      }

      // Assignee plus ops with tickets.assign for this location's scope.
      const supervisors = await recipientsForLocationOps(
        // Run next step: ticket.locationId,
        ticket.locationId,
        // Run next step: "tickets.assign",
        "tickets.assign",
      );
      // Collect recipients list for later processing.
      const recipients = [
        // Run next step: ...(ticket.assigneeId ? [ticket.assigneeId] : []),
        ...(ticket.assigneeId ? [ticket.assigneeId] : []),
        // Run next step: ...supervisors,
        ...supervisors,
      ];
      // Prefer locked marker time; fall back to the pre-lock recent / now.
      const notifyAt = gate.markerAt ?? breachAt;
      // Load result asynchronously for the next steps.
      const result = await createNotifications({
        // Set type on the structure being built.
        type: "ticket.sla_breach",
        // Set title on the structure being built.
        title: "Ticket SLA breached",
        // Set body on the structure being built.
        body: `${ticket.location.number}: ${ticket.title}`,
        // Set entityType on the structure being built.
        entityType: "ticket",
        // Set entityId on the structure being built.
        entityId: ticket.id,
        // Set locationId on the structure being built.
        locationId: ticket.locationId,
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: null,
        // Set recipientEmployeeIds on the structure being built.
        recipientEmployeeIds: recipients,
        // Set dedupeKey on the structure being built.
        dedupeKey: `ticket.sla_breach:${ticket.id}:${notifyAt.toISOString().slice(0, 13)}`,
        // Set payload on the structure being built.
        payload: {
          // Set panel on the structure being built.
          panel: "repairs",
          // Set ticketId on the structure being built.
          ticketId: ticket.id,
          // Set locationId on the structure being built.
          locationId: ticket.locationId,
          // Set locationNumber on the structure being built.
          locationNumber: ticket.location.number,
        },
      });
      // Count only tickets that actually created at least one notification row.
      if (result.created > 0) notified += 1;
    }

    // Return the computed result to the caller.
    return { breached: tickets.length, notified };
  });
}
