/**
 * Mid-lifecycle transitions: start work, wait (SLA pause), resume (SLA unpause).
 * Each supports commandId idempotency; P2002 races fall back to replay.
 */
import { TicketStatus } from "@prisma/client";
// Module dependency import.
import { prisma } from "../../db";
import { assertActiveWorkStarter } from "../assignees";
// Module dependency import.
import { AppError } from "../../errors";
// Module dependency import.
import { lockEmployeesForLiveAccess } from "../liveAccessLocks";
import { claimTicketUpdate } from "./claims";
import {
  replayLifecycleCommand,
  type LifecycleCommandKey,
} from "./commands";
import { writeTicketEvent } from "./events";
import { formatMaintenanceTicket } from "./format";
import { loadLockedTicket } from "./locks";
import { notifyTicketEvent, publishTicketChanged } from "./notify";
import { pauseFieldsOnWait, unpauseFields } from "./slaPause";
import {
  assertTicketAssigneeOrAllowBypass,
  catchLifecycleCommandReplay,
  invalidTicketStatusError,
} from "./lifecycleGuards";

/**
 * assigned → in_progress. Assignee must match actor unless bypassAssigneeCheck.
 * On duplicate commandId unique violation, replay the prior successful event.
 *
 * @param input.ticketId - Ticket primary key.
 * @param input.actorEmployeeId - Must match assignee unless bypassAssigneeCheck.
 * @param input.bypassAssigneeCheck - Dispatch/supervisor override for assignee gate.
 * @param input.commandId - Offline idempotency key (optional).
 */
export async function startMaintenanceTicket(input: {
  ticketId: string;
  actorEmployeeId: string;
  bypassAssigneeCheck?: boolean;
  commandId?: string;
  /** Unused on start; accepted for call-site symmetry with wait/resume. */
  now?: Date;
}) {
  // Idempotency key for offline / retryable start commands.
  const commandKey: LifecycleCommandKey = {
    kind: "start",
    ticketId: input.ticketId,
    actorEmployeeId: input.actorEmployeeId,
  };
  // Replay prior successful start with the same commandId.
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  // Idempotent offline retry — skip mutation when event already exists.
  if (replayed) return replayed.ticket;

  try {
    // Serialize start against concurrent lifecycle mutations.
    const updated = await prisma.$transaction(async (tx) => {
      // Deadlock-safe lock order vs assignMaintenanceTicket + SSE FOR SHARE:
      // User locks BEFORE MaintenanceTicket (same class as cleaning AUDIT-001 /
      // sessions.ts start). assign takes User → Ticket; never Ticket → User.
      const preview = await tx.maintenanceTicket.findUnique({
        where: { id: input.ticketId },
        select: { assigneeId: true },
      });
      if (!preview) {
        throw new AppError(404, "not_found", "Ticket not found");
      }
      // Lock starter (+ current assignee if different) before the ticket row.
      await lockEmployeesForLiveAccess(tx, [
        preview.assigneeId,
        input.actorEmployeeId,
      ]);
      // Eligibility under the User lock (FOR SHARE is nested under FOR UPDATE).
      await assertActiveWorkStarter(input.actorEmployeeId, tx);

      // Row lock + load for status/assignee checks.
      const ticket = await loadLockedTicket(tx, input.ticketId);
      // Only assigned tickets may start.
      if (ticket.status !== TicketStatus.assigned) {
        throw invalidTicketStatusError("start", ticket.status);
      }
      // Unassigned tickets cannot be started.
      if (!ticket.assigneeId) {
        // assigned status without assigneeId is treated as invalid.
        throw new AppError(409, "invalid_state", "Ticket has no assignee");
      }
      // Non-owners cannot start someone else's assignment.
      if (
        !input.bypassAssigneeCheck &&
        ticket.assigneeId !== input.actorEmployeeId
      ) {
        // Supervisor may pass bypassAssigneeCheck for dispatch overrides.
        throw new AppError(403, "forbidden", "Ticket is assigned to another employee");
      }

      const fromStatus = ticket.status;
      // Conditional claim: assigned → in_progress.
      const row = await claimTicketUpdate(
        tx,
        ticket.id,
        [TicketStatus.assigned],
        { status: TicketStatus.in_progress },
        (status) => `Cannot start ticket in status ${status}`,
      );

      // Persist lifecycle event (and commandId for replay).
      await writeTicketEvent(tx, {
        ticketId: ticket.id,
        locationId: ticket.locationId,
        fromStatus,
        toStatus: TicketStatus.in_progress,
        actorEmployeeId: input.actorEmployeeId,
        commandId: input.commandId,
        commandKey,
      });

      // Row includes ticketInclude joins for formatMaintenanceTicket.
      return row;
    });

    // Notify live boards of the status change.
    publishTicketChanged(updated);
    // Notify the assignee that work started.
    if (updated.assigneeId) {
      await notifyTicketEvent({
        type: "ticket.started",
        title: "Ticket started",
        body: `${updated.location?.number ?? "?"}: ${updated.title}`,
        ticket: updated,
        actorEmployeeId: input.actorEmployeeId,
        recipientEmployeeIds: [updated.assigneeId],
        dedupeKey: `ticket.started:${updated.id}:${updated.status}`,
      });
    }
    return formatMaintenanceTicket(updated);
  } catch (err) {
    const again = await catchLifecycleCommandReplay(
      err,
      input.commandId,
      commandKey,
    );
    if (again) return again.ticket;
    throw err;
  }
}

/**
 * in_progress → waiting. Pauses SLA (`slaPausedAt`) so wait time does not burn dueAt.
 *
 * @param input.ticketId - Ticket primary key.
 * @param input.actorEmployeeId - Assignee or supervisor actor.
 * @param input.reason - Optional wait reason on the TicketEvent.
 * @param input.bypassAssigneeCheck - Supervisors may wait non-owned assignments.
 * @param input.commandId - Offline idempotency key (optional).
 */
export async function waitMaintenanceTicket(input: {
  ticketId: string;
  actorEmployeeId: string;
  reason?: string;
  bypassAssigneeCheck?: boolean;
  commandId?: string;
  /** Testable clock for slaPausedAt (defaults to wall clock). */
  now?: Date;
}) {
  // Trim empty wait reason to null for storage.
  const reason = input.reason?.trim() || null;
  // Idempotency key for offline / retryable wait commands.
  const commandKey: LifecycleCommandKey = {
    kind: "wait",
    ticketId: input.ticketId,
    actorEmployeeId: input.actorEmployeeId,
    reason,
  };
  // Replay prior successful wait with the same commandId.
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  // Idempotent offline retry — skip mutation when event already exists.
  if (replayed) return replayed.ticket;

  try {
    // Serialize wait against concurrent lifecycle mutations.
    // Wait does not take User locks (no Ticket→User with assign); ticket-only
    // lock is safe here because assign is disallowed once work has started.
    const updated = await prisma.$transaction(async (tx) => {
      const ticket = await loadLockedTicket(tx, input.ticketId);
      // Only in_progress may enter waiting.
      if (ticket.status !== TicketStatus.in_progress) {
        throw invalidTicketStatusError("wait", ticket.status);
      }
      assertTicketAssigneeOrAllowBypass(
        ticket,
        input.actorEmployeeId,
        input.bypassAssigneeCheck,
      );

      const fromStatus = ticket.status;
      // Claim → waiting and stamp slaPausedAt via pauseFieldsOnWait.
      const row = await claimTicketUpdate(
        tx,
        ticket.id,
        [TicketStatus.in_progress],
        {
          status: TicketStatus.waiting,
          // pauseFieldsOnWait sets slaPausedAt = now.
          ...pauseFieldsOnWait(input.now ?? new Date()),
        },
        (status) => `Cannot wait ticket in status ${status}`,
      );

      // Persist lifecycle event (and commandId for replay).
      await writeTicketEvent(tx, {
        ticketId: ticket.id,
        locationId: ticket.locationId,
        fromStatus,
        toStatus: TicketStatus.waiting,
        actorEmployeeId: input.actorEmployeeId,
        reason,
        commandId: input.commandId,
        commandKey,
      });

      return row;
    });

    publishTicketChanged(updated);
    // Notify the assignee that work is paused.
    if (updated.assigneeId) {
      // DedupeKey includes updatedAt so repeated waits notify separately.
      await notifyTicketEvent({
        type: "ticket.waiting",
        title: "Ticket waiting",
        body: `${updated.location?.number ?? "?"}: ${updated.title}`,
        ticket: updated,
        actorEmployeeId: input.actorEmployeeId,
        recipientEmployeeIds: [updated.assigneeId],
        dedupeKey: `ticket.waiting:${updated.id}:${updated.updatedAt.toISOString()}`,
      });
    }
    return formatMaintenanceTicket(updated);
  } catch (err) {
    const again = await catchLifecycleCommandReplay(
      err,
      input.commandId,
      commandKey,
    );
    if (again) return again.ticket;
    throw err;
  }
}

/**
 * waiting → in_progress. Unpauses SLA and extends dueAt by the paused duration.
 *
 * @param input.ticketId - Ticket primary key.
 * @param input.actorEmployeeId - Assignee or supervisor actor.
 * @param input.bypassAssigneeCheck - Supervisors may resume non-owned assignments.
 * @param input.commandId - Offline idempotency key (optional).
 */
export async function resumeMaintenanceTicket(input: {
  ticketId: string;
  actorEmployeeId: string;
  bypassAssigneeCheck?: boolean;
  commandId?: string;
  /** Testable clock for unpause dueAt extension (defaults to wall clock). */
  now?: Date;
}) {
  // Idempotency key for offline / retryable resume commands.
  const commandKey: LifecycleCommandKey = {
    kind: "resume",
    ticketId: input.ticketId,
    actorEmployeeId: input.actorEmployeeId,
  };
  // Replay prior successful resume with the same commandId.
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  // Idempotent offline retry — skip mutation when event already exists.
  if (replayed) return replayed.ticket;

  try {
    // Serialize resume against concurrent lifecycle mutations.
    // Resume does not take User locks (same rationale as wait — see above).
    const updated = await prisma.$transaction(async (tx) => {
      const ticket = await loadLockedTicket(tx, input.ticketId);
      // Only waiting may resume.
      if (ticket.status !== TicketStatus.waiting) {
        throw invalidTicketStatusError("resume", ticket.status);
      }
      assertTicketAssigneeOrAllowBypass(
        ticket,
        input.actorEmployeeId,
        input.bypassAssigneeCheck,
      );

      const fromStatus = ticket.status;
      // Compute dueAt extension / pause-clear fields from current pause state.
      const unpaused = unpauseFields(ticket, input.now ?? new Date());
      // Claim → in_progress with unpaused SLA fields.
      const row = await claimTicketUpdate(
        tx,
        ticket.id,
        [TicketStatus.waiting],
        {
          status: TicketStatus.in_progress,
          ...unpaused,
        },
        (status) => `Cannot resume ticket in status ${status}`,
      );

      // Persist lifecycle event marked as a resume.
      await writeTicketEvent(tx, {
        ticketId: ticket.id,
        locationId: ticket.locationId,
        fromStatus,
        toStatus: TicketStatus.in_progress,
        actorEmployeeId: input.actorEmployeeId,
        payload: { resumed: true },
        commandId: input.commandId,
        commandKey,
      });

      return row;
    });

    publishTicketChanged(updated);
    // Notify the assignee that work resumed.
    if (updated.assigneeId) {
      // Resume notifies assignee only (same pattern as start/wait).
      await notifyTicketEvent({
        type: "ticket.resumed",
        title: "Ticket resumed",
        body: `${updated.location?.number ?? "?"}: ${updated.title}`,
        ticket: updated,
        actorEmployeeId: input.actorEmployeeId,
        recipientEmployeeIds: [updated.assigneeId],
        dedupeKey: `ticket.resumed:${updated.id}:${updated.updatedAt.toISOString()}`,
      });
    }
    return formatMaintenanceTicket(updated);
  } catch (err) {
    const again = await catchLifecycleCommandReplay(
      err,
      input.commandId,
      commandKey,
    );
    if (again) return again.ticket;
    throw err;
  }
}
