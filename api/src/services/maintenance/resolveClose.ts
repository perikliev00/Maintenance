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
  replayLifecycleCommand,
  type LifecycleCommandKey,
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
import { isP2002 } from "./prismaConflicts";
import { unpauseFields } from "./slaPause";

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
  ticketId: string;
  resolvedByEmployeeId: string;
  resolutionNotes?: string;
  bypassAssigneeCheck?: boolean;
  commandId?: string;
  /** Testable clock for resolve-from-waiting unpause + resolvedAt. */
  now?: Date;
}) {
  // Trim empty resolution notes to null for storage.
  const notes = input.resolutionNotes?.trim() || null;
  // Idempotency key for offline / retryable resolve commands.
  const commandKey: LifecycleCommandKey = {
    kind: "resolve",
    ticketId: input.ticketId,
    actorEmployeeId: input.resolvedByEmployeeId,
    resolutionNotes: notes,
  };
  // Replay prior successful resolve with the same commandId.
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  // Offline retry: return the ticket from the prior successful event.
  if (replayed) return replayed.ticket;

  // Fresh resolve proceeds below (or loses P2002 race to a peer).
  try {
    // Serialize resolve against concurrent lifecycle mutations.
    const updated = await prisma.$transaction(async (tx) => {
      // Row lock via loadLockedTicket — status/assignee read is current.
      const ticket = await loadLockedTicket(tx, input.ticketId);
      // Only in_progress or waiting may resolve.
      if (
        ticket.status !== TicketStatus.in_progress &&
        ticket.status !== TicketStatus.waiting
      ) {
        // Terminal / new / assigned etc. cannot jump straight to resolved.
        throw new AppError(
          409,
          "invalid_state",
          `Cannot resolve ticket in status ${ticket.status}`,
        );
      }
      // Non-owners cannot resolve someone else's assignment.
      if (
        !input.bypassAssigneeCheck &&
        ticket.assigneeId &&
        ticket.assigneeId !== input.resolvedByEmployeeId
      ) {
        // Assignee-only unless supervisor bypassAssigneeCheck.
        throw new AppError(403, "forbidden", "Ticket is assigned to another employee");
      }

      const fromStatus = ticket.status;
      const now = input.now ?? new Date();
      // Resolve-from-waiting must clear pause the same way resume does.
      const unpaused =
        ticket.status === TicketStatus.waiting
          ? unpauseFields(ticket, now)
          : {
              // in_progress resolve — SLA fields unchanged (not paused).
              slaPausedAt: null,
              slaPausedMsTotal: ticket.slaPausedMsTotal,
              dueAt: ticket.dueAt,
            };

      // Conditional claim → resolved with notes and SLA fields.
      const row = await claimTicketUpdate(
        tx,
        ticket.id,
        [TicketStatus.in_progress, TicketStatus.waiting],
        {
          status: TicketStatus.resolved,
          resolvedAt: now,
          resolvedByEmployeeId: input.resolvedByEmployeeId,
          resolutionNotes: notes,
          ...unpaused,
        },
        (status) => `Cannot resolve ticket in status ${status}`,
      );

      // Persist lifecycle event (and commandId for replay).
      await writeTicketEvent(tx, {
        ticketId: ticket.id,
        locationId: ticket.locationId,
        fromStatus,
        toStatus: TicketStatus.resolved,
        actorEmployeeId: input.resolvedByEmployeeId,
        reason: notes,
        commandId: input.commandId,
        commandKey,
      });

      return row;
    });

    // Notify live boards of the status change.
    publishTicketChanged(updated);
    {
      // Notify assignee and reporter (when present).
      const recipients = [
        updated.assigneeId,
        updated.reportedByEmployeeId,
      ].filter((id): id is string => Boolean(id));
      // Inbox notification for stakeholders on resolve.
      await notifyTicketEvent({
        type: "ticket.resolved",
        title: "Ticket resolved",
        body: `${updated.location?.number ?? "?"}: ${updated.title}`,
        ticket: updated,
        actorEmployeeId: input.resolvedByEmployeeId,
        recipientEmployeeIds: recipients,
        dedupeKey: `ticket.resolved:${updated.id}`,
      });
    }
    // API DTO with nested location/assignee includes.
    return formatMaintenanceTicket(updated);
  } catch (err) {
    // Concurrent first-writes of the same commandId: treat as idempotent replay.
    // Status-claim races surface as invalid_state after a peer committed the same commandId.
    if (input.commandId) {
      if (isP2002(err) || (err instanceof AppError && err.code === "invalid_state")) {
        const again = await replayLifecycleCommand(input.commandId, commandKey);
        if (again) return again.ticket;
      }
    }
    // Non-P2002 or replay miss — propagate to the HTTP layer.
    throw err;
  }
}

/**
 * resolved → closed. Final acknowledgment; no commandId idempotency path.
 *
 * @param input.ticketId - Ticket primary key.
 * @param input.closedByEmployeeId - Actor stamping closedByEmployeeId.
 */
export async function closeMaintenanceTicket(input: {
  ticketId: string;
  closedByEmployeeId: string;
}) {
  // Serialize close against concurrent lifecycle mutations.
  const updated = await prisma.$transaction(async (tx) => {
    // Row lock — close races with concurrent resolve/reopen are serialized.
    const ticket = await loadLockedTicket(tx, input.ticketId);
    // Only resolved tickets may close.
    if (ticket.status !== TicketStatus.resolved) {
      // Close is only valid from resolved (not directly from in_progress).
      throw new AppError(
        409,
        "invalid_state",
        `Cannot close ticket in status ${ticket.status}`,
      );
    }

    const fromStatus = ticket.status;
    // Conditional claim → closed with closer stamp.
    const row = await claimTicketUpdate(
      tx,
      ticket.id,
      [TicketStatus.resolved],
      {
        status: TicketStatus.closed,
        closedAt: new Date(),
        closedByEmployeeId: input.closedByEmployeeId,
      },
      (status) => `Cannot close ticket in status ${status}`,
    );

    // Persist lifecycle event (no commandId path for close).
    await writeTicketEvent(tx, {
      ticketId: ticket.id,
      locationId: ticket.locationId,
      fromStatus,
      toStatus: TicketStatus.closed,
      actorEmployeeId: input.closedByEmployeeId,
    });

    return row;
  });

  // Broadcast closed status to live maintenance views.
  publishTicketChanged(updated);
  {
    // Notify assignee and reporter (when present).
    const recipients = [
      updated.assigneeId,
      updated.reportedByEmployeeId,
    ].filter((id): id is string => Boolean(id));
    // Close notification — no commandId dedupe path on this transition.
    await notifyTicketEvent({
      type: "ticket.closed",
      title: "Ticket closed",
      body: `${updated.location?.number ?? "?"}: ${updated.title}`,
      ticket: updated,
      actorEmployeeId: input.closedByEmployeeId,
      recipientEmployeeIds: recipients,
      dedupeKey: `ticket.closed:${updated.id}`,
    });
  }
  // Close path has no commandId replay — always a fresh transition.
  return formatMaintenanceTicket(updated);
}

/**
 * resolved|closed → in_progress. Clears resolve/close fields and records a
 * TicketReopenEvent; does not restore prior SLA pause state.
 *
 * @param input.ticketId - Ticket primary key.
 * @param input.reopenedByEmployeeId - Actor for reopen audit + TicketEvent.
 * @param input.reason - Optional reopen reason stored on TicketReopenEvent.
 */
export async function reopenMaintenanceTicket(input: {
  ticketId: string;
  reopenedByEmployeeId: string;
  reason?: string;
}) {
  // Serialize reopen against concurrent lifecycle mutations.
  const updated = await prisma.$transaction(async (tx) => {
    // Row lock before terminal → in_progress transition.
    const ticket = await loadLockedTicket(tx, input.ticketId);
    // Only terminal resolved/closed states may reopen.
    if (
      ticket.status !== TicketStatus.resolved &&
      ticket.status !== TicketStatus.closed
    ) {
      // Open lifecycle states must use start/wait/resume instead.
      throw new AppError(
        409,
        "invalid_state",
        "Only resolved or closed tickets can be reopened",
      );
    }

    const reason = input.reason?.trim() || null;
    const fromStatus = ticket.status;

    // Claim → in_progress and clear resolve/close/pause fields.
    const row = await claimTicketUpdate(
      tx,
      ticket.id,
      [TicketStatus.resolved, TicketStatus.closed],
      {
        status: TicketStatus.in_progress,
        resolvedAt: null,
        resolvedByEmployeeId: null,
        resolutionNotes: null,
        closedAt: null,
        closedByEmployeeId: null,
        // Reopen resumes active work; any prior waiting pause is discarded.
        slaPausedAt: null,
      },
      () => "Only resolved or closed tickets can be reopened",
    );

    // Analytics table — separate from TicketEvent stream.
    await tx.ticketReopenEvent.create({
      data: {
        ticketId: ticket.id,
        reopenedByEmployeeId: input.reopenedByEmployeeId,
        reason,
        previousStatus: fromStatus,
      },
    });

    // Persist lifecycle event marked as a reopen.
    await writeTicketEvent(tx, {
      ticketId: ticket.id,
      locationId: ticket.locationId,
      fromStatus,
      toStatus: TicketStatus.in_progress,
      actorEmployeeId: input.reopenedByEmployeeId,
      reason,
      payload: { reopen: true },
    });

    return row;
  });

  // Live subscribers refresh after reopen clears terminal fields.
  publishTicketChanged(updated);
  {
    // Notify assignee and reporter (when present).
    const recipients = [
      updated.assigneeId,
      updated.reportedByEmployeeId,
    ].filter((id): id is string => Boolean(id));
    // DedupeKey includes updatedAt so multiple reopens notify separately.
    await notifyTicketEvent({
      type: "ticket.reopened",
      title: "Ticket reopened",
      body: `${updated.location?.number ?? "?"}: ${updated.title}`,
      ticket: updated,
      actorEmployeeId: input.reopenedByEmployeeId,
      recipientEmployeeIds: recipients,
      dedupeKey: `ticket.reopened:${updated.id}:${updated.updatedAt.toISOString()}`,
    });
  }
  return formatMaintenanceTicket(updated);
}
