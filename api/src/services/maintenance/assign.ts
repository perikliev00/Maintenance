/**
 * Assign (or reassign) a ticket that is still in new/assigned.
 */
import { TicketStatus } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../assignees for this service.
import { assertActiveMaintenanceAssignee } from "../assignees";
// Import module ./claims for this service.
import { claimTicketUpdate } from "./claims";
// Import module dependency for this service.
import {
  // Run next step: replayLifecycleCommand,
  replayLifecycleCommand,
  // Declare type LifecycleCommandKey for callers and internals.
  type LifecycleCommandKey,
// Run next step: } from "./commands";
} from "./commands";
// Import module ./events for this service.
import { writeTicketEvent } from "./events";
// Import module ./format for this service.
import { formatMaintenanceTicket } from "./format";
// Import module ./locks for this service.
import { loadLockedTicket } from "./locks";
// Import module ./notify for this service.
import { notifyTicketEvent, publishTicketChanged } from "./notify";
// Import module ../liveAccessLocks for this service.
import { lockEmployeesForLiveAccess } from "../liveAccessLocks";
// Import module dependency for this service.
import {
  // Run next step: catchLifecycleCommandReplay,
  catchLifecycleCommandReplay,
  // Run next step: invalidTicketStatusError,
  invalidTicketStatusError,
// Run next step: } from "./lifecycleGuards";
} from "./lifecycleGuards";

/**
 * Sets assignee and status=assigned. Allowed only from new or assigned
 * (reassignment before work starts). Notifies the new assignee.
 * Optional `commandId` enables offline/sync idempotent replay (FEAT-002 / B4).
 */
export async function assignMaintenanceTicket(input: {
  // Set ticketId on the structure being built.
  ticketId: string;
  // Set assigneeId on the structure being built.
  assigneeId: string;
  // Set actorEmployeeId on the structure being built.
  actorEmployeeId: string;
  // Run next step: commandId?: string;
  commandId?: string;
// Run next step: }) {
}) {
  // Reject inactive / non-technician assignees before opening a transaction.
  await assertActiveMaintenanceAssignee(input.assigneeId);

  // Capture command key for use in this scope.
  const commandKey: LifecycleCommandKey = {
    // Set kind on the structure being built.
    kind: "assign",
    // Set ticketId on the structure being built.
    ticketId: input.ticketId,
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: input.actorEmployeeId,
    // Set assigneeId on the structure being built.
    assigneeId: input.assigneeId,
  };
  // Load replayed asynchronously for the next steps.
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  // Branch when this condition holds so the right path runs.
  if (replayed) return replayed.ticket;

  // Attempt the fallible work so errors can be handled below.
  try {
    // Serialize assign against concurrent start/wait/resolve on the same ticket.
    const updated = await prisma.$transaction(async (tx) => {
      // User locks before ticket lock (deadlock-safe vs SSE FOR SHARE and vs
      // startMaintenanceTicket, which uses the same User → Ticket order).
      const preview = await tx.maintenanceTicket.findUnique({
        // Set where on the structure being built.
        where: { id: input.ticketId },
        // Set select on the structure being built.
        select: { assigneeId: true },
      });
      // Branch when this condition holds so the right path runs.
      if (!preview) {
        // Abort with an error so callers can react.
        throw new AppError(404, "not_found", "Ticket not found");
      }
      // Wait for the async step before continuing.
      await lockEmployeesForLiveAccess(tx, [
        // Run next step: preview.assigneeId,
        preview.assigneeId,
        // Run next step: input.assigneeId,
        input.assigneeId,
      ]);
      // Serialize concurrent assign/start on this ticket.
      const ticket = await loadLockedTicket(tx, input.ticketId);
      // Branch when this condition holds so the right path runs.
      if (
        // Run next step: ticket.assigneeId &&
        ticket.assigneeId &&
        // Run next step: ticket.assigneeId !== preview.assigneeId &&
        ticket.assigneeId !== preview.assigneeId &&
        // Run next step: ticket.assigneeId !== input.assigneeId
        ticket.assigneeId !== input.assigneeId
      // Run next step: ) {
      ) {
        // Abort with an error so callers can react.
        throw new AppError(
          // Run next step: 409,
          409,
          // Run next step: "conflict",
          "conflict",
          // Run next step: "Ticket assignee changed concurrently; retry",
          "Ticket assignee changed concurrently; retry",
        );
      }
      // Only pre-work states may be (re)assigned.
      if (
        // Run next step: ticket.status !== TicketStatus.new &&
        ticket.status !== TicketStatus.new &&
        // Run next step: ticket.status !== TicketStatus.assigned
        ticket.status !== TicketStatus.assigned
      // Run next step: ) {
      ) {
        // Abort with an error so callers can react.
        throw invalidTicketStatusError("assign", ticket.status);
      }

      // Re-check after ticket lock so a concurrent block/role change cannot slip in.
      await assertActiveMaintenanceAssignee(input.assigneeId, tx);

      // Capture fromStatus before the claim mutates the row.
      const fromStatus = ticket.status;
      // Conditional update — loses the race cleanly if status moved.
      const row = await claimTicketUpdate(
        // Run next step: tx,
        tx,
        // Run next step: ticket.id,
        ticket.id,
        // Run next step: [TicketStatus.new, TicketStatus.assigned],
        [TicketStatus.new, TicketStatus.assigned],
        // Run next step: {
        {
          // Set status on the structure being built.
          status: TicketStatus.assigned,
          // Set assigneeId on the structure being built.
          assigneeId: input.assigneeId,
        },
        // Run next step: (status) => `Cannot assign ticket in status ${status}`,
        (status) => `Cannot assign ticket in status ${status}`,
      );

      // Timeline event for the ticket history panel (+ commandId for replay).
      await writeTicketEvent(tx, {
        // Set ticketId on the structure being built.
        ticketId: ticket.id,
        // Set locationId on the structure being built.
        locationId: ticket.locationId,
        // Run next step: fromStatus,
        fromStatus,
        // Set toStatus on the structure being built.
        toStatus: TicketStatus.assigned,
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: input.actorEmployeeId,
        // Set payload on the structure being built.
        payload: { assigneeId: input.assigneeId },
        // Set commandId on the structure being built.
        commandId: input.commandId,
        // Run next step: commandKey,
        commandKey,
      });

      // Return the computed result to the caller.
      return row;
    });

    // Live SSE / bus update for open ticket views.
    publishTicketChanged(updated);
    // Inbox notification to the newly assigned technician.
    await notifyTicketEvent({
      // Set type on the structure being built.
      type: "ticket.assigned",
      // Set title on the structure being built.
      title: "Ticket assigned to you",
      // Set body on the structure being built.
      body: `${updated.location?.number ?? "?"}: ${updated.title}`,
      // Set ticket on the structure being built.
      ticket: updated,
      // Set actorEmployeeId on the structure being built.
      actorEmployeeId: input.actorEmployeeId,
      // Set recipientEmployeeIds on the structure being built.
      recipientEmployeeIds: [input.assigneeId],
      // Dedupe on ticket+assignee so retries do not spam.
      dedupeKey: `ticket.assigned:${updated.id}:${input.assigneeId}`,
    });
    // Legacy category alias for older clients.
    return formatMaintenanceTicket(updated);
  // Run next step: } catch (err) {
  } catch (err) {
    // Load again asynchronously for the next steps.
    const again = await catchLifecycleCommandReplay(
      // Run next step: err,
      err,
      // Run next step: input.commandId,
      input.commandId,
      // Run next step: commandKey,
      commandKey,
    );
    // Branch when this condition holds so the right path runs.
    if (again) return again.ticket;
    // Abort with an error so callers can react.
    throw err;
  }
}
