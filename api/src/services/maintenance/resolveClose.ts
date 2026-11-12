/**
 * Terminal lifecycle: resolve, close, and reopen back to in_progress.
 */
import { TicketStatus } from "@prisma/client";
// Module dependency import.
import { prisma } from "../../db";
// Module dependency import.
import { AppError } from "../../errors";
// Module dependency import.
import { claimTicketUpdate } from "./claims";
// Module dependency import.
import {
  // Run next step: replayLifecycleCommand,
  replayLifecycleCommand,
  // Declare type LifecycleCommandKey for callers and internals.
  type LifecycleCommandKey,
// Run next step: } from "./commands";
} from "./commands";
// Module dependency import.
import { writeTicketEvent } from "./events";
// Module dependency import.
import { formatMaintenanceTicket } from "./format";
// Module dependency import.
import { loadLockedTicket } from "./locks";
// Module dependency import.
import { notifyTicketEvent, publishTicketChanged } from "./notify";
// Module dependency import.
import { unpauseFields } from "./slaPause";
// Import module dependency for this service.
import {
  // Run next step: assertTicketAssigneeOrAllowBypass,
  assertTicketAssigneeOrAllowBypass,
  // Run next step: catchLifecycleCommandReplay,
  catchLifecycleCommandReplay,
  // Run next step: invalidTicketStatusError,
  invalidTicketStatusError,
// Run next step: } from "./lifecycleGuards";
} from "./lifecycleGuards";
// Import module ./notificationOutbox for this service.
import { deliverTicketOutcome, enqueueTicketOutcome } from "./notificationOutbox";

/**
 * in_progress|waiting → resolved. Resolving from waiting unpauses SLA first
 * so paused ms and dueAt stay consistent with resume semantics.
 *
 * @param input.ticketId - Ticket primary key.
 * @param input.resolvedByEmployeeId - Actor stamping resolvedByEmployeeId.
 * @param input.resolutionNotes - Optional free-text stored on the ticket row.
 * @param input.bypassAssigneeCheck - Supervisors may resolve non-owned assignments.
 * @param input.commandId - Offline idempotency key (optional).
 */
export async function resolveMaintenanceTicket(input: {
  // Set ticketId on the structure being built.
  ticketId: string;
  // Set resolvedByEmployeeId on the structure being built.
  resolvedByEmployeeId: string;
  // Run next step: resolutionNotes?: string;
  resolutionNotes?: string;
  // Run next step: bypassAssigneeCheck?: boolean;
  bypassAssigneeCheck?: boolean;
  // Run next step: commandId?: string;
  commandId?: string;
  /** Testable clock for resolve-from-waiting unpause + resolvedAt. */
  now?: Date;
// Run next step: }) {
}) {
  // Trim empty resolution notes to null for storage.
  const notes = input.resolutionNotes?.trim() || null;
  // Idempotency key for offline / retryable resolve commands.
  const commandKey: LifecycleCommandKey = {
    // Set kind on the structure being built.
    kind: "resolve",
    // Set ticketId on the structure being built.
    ticketId: input.ticketId,
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: input.resolvedByEmployeeId,
    // Set resolutionNotes on the structure being built.
    resolutionNotes: notes,
  };
  // Replay prior successful resolve with the same commandId.
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  // Offline retry: return the ticket from the prior successful event.
  if (replayed) { await deliverTicketOutcome(replayed.eventId); return replayed.ticket; }

  // Fresh resolve proceeds below (or loses P2002 race to a peer).
  try {
    // Serialize resolve against concurrent lifecycle mutations.
    // Resolve does not take User locks — assign is already disallowed in
    // in_progress/waiting, so there is no Ticket→User deadlock with assign.
    const { row: updated, eventId } = await prisma.$transaction(async (tx) => {
      // Row lock via loadLockedTicket — status/assignee read is current.
      const ticket = await loadLockedTicket(tx, input.ticketId);
      // Only in_progress or waiting may resolve.
      if (
        // Run next step: ticket.status !== TicketStatus.in_progress &&
        ticket.status !== TicketStatus.in_progress &&
        // Run next step: ticket.status !== TicketStatus.waiting
        ticket.status !== TicketStatus.waiting
      // Run next step: ) {
      ) {
        // Abort with an error so callers can react.
        throw invalidTicketStatusError("resolve", ticket.status);
      }
      // Blocking / high-risk tickets require a meaningful repair note.
      const requiresNotes =
        // Run next step: ticket.blocksRoom ||
        ticket.blocksRoom ||
        // Run next step: ticket.priority === "high" ||
        ticket.priority === "high" ||
        // Run next step: ticket.priority === "urgent";
        ticket.priority === "urgent";
      // Branch when this condition holds so the right path runs.
      if (requiresNotes && !notes) {
        // Abort with an error so callers can react.
        throw new AppError(
          // Run next step: 400,
          400,
          // Run next step: "validation",
          "validation",
          // Run next step: "resolutionNotes required for blocking or high/urgent ticket…
          "resolutionNotes required for blocking or high/urgent tickets",
        );
      }
      // Non-owners cannot resolve someone else's assignment.
      assertTicketAssigneeOrAllowBypass(
        // Run next step: ticket,
        ticket,
        // Run next step: input.resolvedByEmployeeId,
        input.resolvedByEmployeeId,
        // Run next step: input.bypassAssigneeCheck,
        input.bypassAssigneeCheck,
      );

      // Capture from status for use in this scope.
      const fromStatus = ticket.status;
      // Capture now for use in this scope.
      const now = input.now ?? new Date();
      // Resolve-from-waiting must clear pause the same way resume does.
      const unpaused =
        // Run next step: ticket.status === TicketStatus.waiting
        ticket.status === TicketStatus.waiting
          // Complete the ternary or optional chain started above.
          ? unpauseFields(ticket, now)
          // Complete the ternary or optional chain started above.
          : {
              // in_progress resolve — SLA fields unchanged (not paused).
              slaPausedAt: null,
              // Set slaPausedMsTotal on the structure being built.
              slaPausedMsTotal: ticket.slaPausedMsTotal,
              // Set dueAt on the structure being built.
              dueAt: ticket.dueAt,
            };

      // Conditional claim → resolved with notes and SLA fields.
      const row = await claimTicketUpdate(
        // Run next step: tx,
        tx,
        // Run next step: ticket.id,
        ticket.id,
        // Run next step: [TicketStatus.in_progress, TicketStatus.waiting],
        [TicketStatus.in_progress, TicketStatus.waiting],
        // Run next step: {
        {
          // Set status on the structure being built.
          status: TicketStatus.resolved,
          // Set resolvedAt on the structure being built.
          resolvedAt: now,
          // Set resolvedByEmployeeId on the structure being built.
          resolvedByEmployeeId: input.resolvedByEmployeeId,
          // Set resolutionNotes on the structure being built.
          resolutionNotes: notes,
          // Run next step: ...unpaused,
          ...unpaused,
        },
        // Run next step: (status) => `Cannot resolve ticket in status ${status}`,
        (status) => `Cannot resolve ticket in status ${status}`,
      );

      // Persist lifecycle event (and commandId for replay).
      const event = await writeTicketEvent(tx, {
        // Set ticketId on the structure being built.
        ticketId: ticket.id,
        // Set locationId on the structure being built.
        locationId: ticket.locationId,
        // Run next step: fromStatus,
        fromStatus,
        // Set toStatus on the structure being built.
        toStatus: TicketStatus.resolved,
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: input.resolvedByEmployeeId,
        // Set reason on the structure being built.
        reason: notes,
        // Set commandId on the structure being built.
        commandId: input.commandId,
        // Run next step: commandKey,
        commandKey,
      });

      // Wait for the async step before continuing.
      await enqueueTicketOutcome(tx, event.id, row, "resolved", input.resolvedByEmployeeId);
      // Return the computed result to the caller.
      return { row, eventId: event.id };
    });

    // Notify live boards of the status change.
    publishTicketChanged(updated);
    // Wait for the async step before continuing.
    await deliverTicketOutcome(eventId);
    // API DTO with nested location/assignee includes.
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
    if (again) {
      // Wait for the async step before continuing.
      await deliverTicketOutcome(again.eventId);
      // Return the computed result to the caller.
      return again.ticket;
    }
    // Abort with an error so callers can react.
    throw err;
  }
}

/**
 * resolved → closed. Optional `commandId` for offline/sync idempotent replay
 * (FEAT-002 / B4).
 *
 * @param input.ticketId - Ticket primary key.
 * @param input.closedByEmployeeId - Actor stamping closedByEmployeeId.
 * @param input.commandId - Offline idempotency key (optional).
 */
export async function closeMaintenanceTicket(input: {
  // Set ticketId on the structure being built.
  ticketId: string;
  // Set closedByEmployeeId on the structure being built.
  closedByEmployeeId: string;
  // Run next step: commandId?: string;
  commandId?: string;
// Run next step: }) {
}) {
  // Capture command key for use in this scope.
  const commandKey: LifecycleCommandKey = {
    // Set kind on the structure being built.
    kind: "close",
    // Set ticketId on the structure being built.
    ticketId: input.ticketId,
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: input.closedByEmployeeId,
  };
  // Load replayed asynchronously for the next steps.
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  // Branch when this condition holds so the right path runs.
  if (replayed) { await deliverTicketOutcome(replayed.eventId); return replayed.ticket; }

  // Attempt the fallible work so errors can be handled below.
  try {
    // Serialize close against concurrent lifecycle mutations.
    const { row: updated, eventId } = await prisma.$transaction(async (tx) => {
      // Row lock — close races with concurrent resolve/reopen are serialized.
      const ticket = await loadLockedTicket(tx, input.ticketId);
      // Only resolved tickets may close.
      if (ticket.status !== TicketStatus.resolved) {
        // Abort with an error so callers can react.
        throw invalidTicketStatusError("close", ticket.status);
      }

      // Capture from status for use in this scope.
      const fromStatus = ticket.status;
      // Conditional claim → closed with closer stamp.
      const row = await claimTicketUpdate(
        // Run next step: tx,
        tx,
        // Run next step: ticket.id,
        ticket.id,
        // Run next step: [TicketStatus.resolved],
        [TicketStatus.resolved],
        // Run next step: {
        {
          // Set status on the structure being built.
          status: TicketStatus.closed,
          // Set closedAt on the structure being built.
          closedAt: new Date(),
          // Set closedByEmployeeId on the structure being built.
          closedByEmployeeId: input.closedByEmployeeId,
        },
        // Run next step: (status) => `Cannot close ticket in status ${status}`,
        (status) => `Cannot close ticket in status ${status}`,
      );

      // Persist lifecycle event (+ commandId for offline replay).
      const event = await writeTicketEvent(tx, {
        // Set ticketId on the structure being built.
        ticketId: ticket.id,
        // Set locationId on the structure being built.
        locationId: ticket.locationId,
        // Run next step: fromStatus,
        fromStatus,
        // Set toStatus on the structure being built.
        toStatus: TicketStatus.closed,
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: input.closedByEmployeeId,
        // Set commandId on the structure being built.
        commandId: input.commandId,
        // Run next step: commandKey,
        commandKey,
      });

      // Wait for the async step before continuing.
      await enqueueTicketOutcome(tx, event.id, row, "closed", input.closedByEmployeeId);
      // Return the computed result to the caller.
      return { row, eventId: event.id };
    });

    // Broadcast closed status to live maintenance views.
    publishTicketChanged(updated);
    // Wait for the async step before continuing.
    await deliverTicketOutcome(eventId);
    // Return the computed result to the caller.
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
    if (again) {
      // Wait for the async step before continuing.
      await deliverTicketOutcome(again.eventId);
      // Return the computed result to the caller.
      return again.ticket;
    }
    // Abort with an error so callers can react.
    throw err;
  }
}

/**
 * resolved|closed → in_progress. Clears resolve/close fields and records a
 * TicketReopenEvent; does not restore prior SLA pause state.
 * Optional `commandId` for offline/sync idempotent replay (FEAT-002 / B4).
 *
 * @param input.ticketId - Ticket primary key.
 * @param input.reopenedByEmployeeId - Actor for reopen audit + TicketEvent.
 * @param input.reason - Optional reopen reason stored on TicketReopenEvent.
 * @param input.commandId - Offline idempotency key (optional).
 */
export async function reopenMaintenanceTicket(input: {
  // Set ticketId on the structure being built.
  ticketId: string;
  // Set reopenedByEmployeeId on the structure being built.
  reopenedByEmployeeId: string;
  // Run next step: reason?: string;
  reason?: string;
  // Run next step: commandId?: string;
  commandId?: string;
// Run next step: }) {
}) {
  // Capture reason for use in this scope.
  const reason = input.reason?.trim() || null;
  // Capture command key for use in this scope.
  const commandKey: LifecycleCommandKey = {
    // Set kind on the structure being built.
    kind: "reopen",
    // Set ticketId on the structure being built.
    ticketId: input.ticketId,
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: input.reopenedByEmployeeId,
    // Run next step: reason,
    reason,
  };
  // Load replayed asynchronously for the next steps.
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  // Branch when this condition holds so the right path runs.
  if (replayed) return replayed.ticket;

  // Attempt the fallible work so errors can be handled below.
  try {
    // Serialize reopen against concurrent lifecycle mutations.
    const updated = await prisma.$transaction(async (tx) => {
      // Row lock before terminal → in_progress transition.
      const ticket = await loadLockedTicket(tx, input.ticketId);
      // Only terminal resolved/closed states may reopen.
      if (
        // Run next step: ticket.status !== TicketStatus.resolved &&
        ticket.status !== TicketStatus.resolved &&
        // Run next step: ticket.status !== TicketStatus.closed
        ticket.status !== TicketStatus.closed
      // Run next step: ) {
      ) {
        // Open lifecycle states must use start/wait/resume instead.
        throw new AppError(
          // Run next step: 409,
          409,
          // Run next step: "invalid_state",
          "invalid_state",
          // Run next step: "Only resolved or closed tickets can be reopened",
          "Only resolved or closed tickets can be reopened",
        );
      }

      // Capture from status for use in this scope.
      const fromStatus = ticket.status;

      // Claim → in_progress and clear resolve/close/pause fields.
      const row = await claimTicketUpdate(
        // Run next step: tx,
        tx,
        // Run next step: ticket.id,
        ticket.id,
        // Run next step: [TicketStatus.resolved, TicketStatus.closed],
        [TicketStatus.resolved, TicketStatus.closed],
        // Run next step: {
        {
          // Set status on the structure being built.
          status: TicketStatus.in_progress,
          // Set resolvedAt on the structure being built.
          resolvedAt: null,
          // Set resolvedByEmployeeId on the structure being built.
          resolvedByEmployeeId: null,
          // Set resolutionNotes on the structure being built.
          resolutionNotes: null,
          // Set closedAt on the structure being built.
          closedAt: null,
          // Set closedByEmployeeId on the structure being built.
          closedByEmployeeId: null,
          // Reopen resumes active work; any prior waiting pause is discarded.
          slaPausedAt: null,
        },
        // Run next step: () => "Only resolved or closed tickets can be reopened",
        () => "Only resolved or closed tickets can be reopened",
      );

      // Analytics table — separate from TicketEvent stream.
      await tx.ticketReopenEvent.create({
        // Set data on the structure being built.
        data: {
          // Set ticketId on the structure being built.
          ticketId: ticket.id,
          // Set reopenedByEmployeeId on the structure being built.
          reopenedByEmployeeId: input.reopenedByEmployeeId,
          // Run next step: reason,
          reason,
          // Set previousStatus on the structure being built.
          previousStatus: fromStatus,
        },
      });

      // Persist lifecycle event marked as a reopen (+ commandId for replay).
      await writeTicketEvent(tx, {
        // Set ticketId on the structure being built.
        ticketId: ticket.id,
        // Set locationId on the structure being built.
        locationId: ticket.locationId,
        // Run next step: fromStatus,
        fromStatus,
        // Set toStatus on the structure being built.
        toStatus: TicketStatus.in_progress,
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: input.reopenedByEmployeeId,
        // Run next step: reason,
        reason,
        // Set payload on the structure being built.
        payload: { reopen: true },
        // Set commandId on the structure being built.
        commandId: input.commandId,
        // Run next step: commandKey,
        commandKey,
      });

      // Return the computed result to the caller.
      return row;
    });

    // Live subscribers refresh after reopen clears terminal fields.
    publishTicketChanged(updated);
    // Run next step: {
    {
      // Notify assignee and reporter (when present).
      const recipients = [
        // Run next step: updated.assigneeId,
        updated.assigneeId,
        // Run next step: updated.reportedByEmployeeId,
        updated.reportedByEmployeeId,
      // Run next step: ].filter((id): id is string => Boolean(id));
      ].filter((id): id is string => Boolean(id));
      // DedupeKey includes updatedAt so multiple reopens notify separately.
      await notifyTicketEvent({
        // Set type on the structure being built.
        type: "ticket.reopened",
        // Set title on the structure being built.
        title: "Ticket reopened",
        // Set body on the structure being built.
        body: `${updated.location?.number ?? "?"}: ${updated.title}`,
        // Set ticket on the structure being built.
        ticket: updated,
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: input.reopenedByEmployeeId,
        // Set recipientEmployeeIds on the structure being built.
        recipientEmployeeIds: recipients,
        // Set dedupeKey on the structure being built.
        dedupeKey: `ticket.reopened:${updated.id}:${updated.updatedAt.toISOString()}`,
      });
    }
    // Return the computed result to the caller.
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
