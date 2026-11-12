/**
 * Mid-lifecycle transitions: start work, wait (SLA pause), resume (SLA unpause).
 * Each supports commandId idempotency; P2002 races fall back to replay.
 */
import { TicketStatus } from "@prisma/client";
// Module dependency import.
import { prisma } from "../../db";
// Import module ../assignees for this service.
import { assertActiveWorkStarter } from "../assignees";
// Module dependency import.
import { AppError } from "../../errors";
// Module dependency import.
import { lockEmployeesForLiveAccess } from "../liveAccessLocks";
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
// Import module ./slaPause for this service.
import { pauseFieldsOnWait, unpauseFields } from "./slaPause";
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
  // Set ticketId on the structure being built.
  ticketId: string;
  // Set actorEmployeeId on the structure being built.
  actorEmployeeId: string;
  // Run next step: bypassAssigneeCheck?: boolean;
  bypassAssigneeCheck?: boolean;
  // Run next step: commandId?: string;
  commandId?: string;
  /** Unused on start; accepted for call-site symmetry with wait/resume. */
  now?: Date;
// Run next step: }) {
}) {
  // Idempotency key for offline / retryable start commands.
  const commandKey: LifecycleCommandKey = {
    // Set kind on the structure being built.
    kind: "start",
    // Set ticketId on the structure being built.
    ticketId: input.ticketId,
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: input.actorEmployeeId,
  };
  // Replay prior successful start with the same commandId.
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  // Idempotent offline retry — skip mutation when event already exists.
  if (replayed) return replayed.ticket;

  // Attempt the fallible work so errors can be handled below.
  try {
    // Serialize start against concurrent lifecycle mutations.
    const updated = await prisma.$transaction(async (tx) => {
      // Deadlock-safe lock order vs assignMaintenanceTicket + SSE FOR SHARE:
      // User locks BEFORE MaintenanceTicket (same class as cleaning AUDIT-001 /
      // sessions.ts start). assign takes User → Ticket; never Ticket → User.
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
      // Lock starter (+ current assignee if different) before the ticket row.
      await lockEmployeesForLiveAccess(tx, [
        // Run next step: preview.assigneeId,
        preview.assigneeId,
        // Run next step: input.actorEmployeeId,
        input.actorEmployeeId,
      ]);
      // Eligibility under the User lock (FOR SHARE is nested under FOR UPDATE).
      await assertActiveWorkStarter(input.actorEmployeeId, tx);

      // Row lock + load for status/assignee checks.
      const ticket = await loadLockedTicket(tx, input.ticketId);
      // Only assigned tickets may start.
      if (ticket.status !== TicketStatus.assigned) {
        // Abort with an error so callers can react.
        throw invalidTicketStatusError("start", ticket.status);
      }
      // Unassigned tickets cannot be started.
      if (!ticket.assigneeId) {
        // assigned status without assigneeId is treated as invalid.
        throw new AppError(409, "invalid_state", "Ticket has no assignee");
      }
      // Non-owners cannot start someone else's assignment.
      if (
        // Run next step: !input.bypassAssigneeCheck &&
        !input.bypassAssigneeCheck &&
        // Run next step: ticket.assigneeId !== input.actorEmployeeId
        ticket.assigneeId !== input.actorEmployeeId
      // Run next step: ) {
      ) {
        // Supervisor may pass bypassAssigneeCheck for dispatch overrides.
        throw new AppError(403, "forbidden", "Ticket is assigned to another employee");
      }

      // Capture from status for use in this scope.
      const fromStatus = ticket.status;
      // Conditional claim: assigned → in_progress.
      const row = await claimTicketUpdate(
        // Run next step: tx,
        tx,
        // Run next step: ticket.id,
        ticket.id,
        // Run next step: [TicketStatus.assigned],
        [TicketStatus.assigned],
        // Run next step: { status: TicketStatus.in_progress },
        { status: TicketStatus.in_progress },
        // Run next step: (status) => `Cannot start ticket in status ${status}`,
        (status) => `Cannot start ticket in status ${status}`,
      );

      // Persist lifecycle event (and commandId for replay).
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
        actorEmployeeId: input.actorEmployeeId,
        // Set commandId on the structure being built.
        commandId: input.commandId,
        // Run next step: commandKey,
        commandKey,
      });

      // Row includes ticketInclude joins for formatMaintenanceTicket.
      return row;
    });

    // Notify live boards of the status change.
    publishTicketChanged(updated);
    // Notify the assignee that work started.
    if (updated.assigneeId) {
      // Wait for the async step before continuing.
      await notifyTicketEvent({
        // Set type on the structure being built.
        type: "ticket.started",
        // Set title on the structure being built.
        title: "Ticket started",
        // Set body on the structure being built.
        body: `${updated.location?.number ?? "?"}: ${updated.title}`,
        // Set ticket on the structure being built.
        ticket: updated,
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: input.actorEmployeeId,
        // Set recipientEmployeeIds on the structure being built.
        recipientEmployeeIds: [updated.assigneeId],
        // Set dedupeKey on the structure being built.
        dedupeKey: `ticket.started:${updated.id}:${updated.status}`,
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
  // Set ticketId on the structure being built.
  ticketId: string;
  // Set actorEmployeeId on the structure being built.
  actorEmployeeId: string;
  // Run next step: reason?: string;
  reason?: string;
  // Run next step: bypassAssigneeCheck?: boolean;
  bypassAssigneeCheck?: boolean;
  // Run next step: commandId?: string;
  commandId?: string;
  /** Testable clock for slaPausedAt (defaults to wall clock). */
  now?: Date;
// Run next step: }) {
}) {
  // Trim empty wait reason to null for storage.
  const reason = input.reason?.trim() || null;
  // Idempotency key for offline / retryable wait commands.
  const commandKey: LifecycleCommandKey = {
    // Set kind on the structure being built.
    kind: "wait",
    // Set ticketId on the structure being built.
    ticketId: input.ticketId,
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: input.actorEmployeeId,
    // Run next step: reason,
    reason,
  };
  // Replay prior successful wait with the same commandId.
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  // Idempotent offline retry — skip mutation when event already exists.
  if (replayed) return replayed.ticket;

  // Attempt the fallible work so errors can be handled below.
  try {
    // Serialize wait against concurrent lifecycle mutations.
    // Wait does not take User locks (no Ticket→User with assign); ticket-only
    // lock is safe here because assign is disallowed once work has started.
    const updated = await prisma.$transaction(async (tx) => {
      // Load ticket asynchronously for the next steps.
      const ticket = await loadLockedTicket(tx, input.ticketId);
      // Only in_progress may enter waiting.
      if (ticket.status !== TicketStatus.in_progress) {
        // Abort with an error so callers can react.
        throw invalidTicketStatusError("wait", ticket.status);
      }
      // Run next step: assertTicketAssigneeOrAllowBypass(
      assertTicketAssigneeOrAllowBypass(
        // Run next step: ticket,
        ticket,
        // Run next step: input.actorEmployeeId,
        input.actorEmployeeId,
        // Run next step: input.bypassAssigneeCheck,
        input.bypassAssigneeCheck,
      );

      // Capture from status for use in this scope.
      const fromStatus = ticket.status;
      // Claim → waiting and stamp slaPausedAt via pauseFieldsOnWait.
      const row = await claimTicketUpdate(
        // Run next step: tx,
        tx,
        // Run next step: ticket.id,
        ticket.id,
        // Run next step: [TicketStatus.in_progress],
        [TicketStatus.in_progress],
        // Run next step: {
        {
          // Set status on the structure being built.
          status: TicketStatus.waiting,
          // pauseFieldsOnWait sets slaPausedAt = now.
          ...pauseFieldsOnWait(input.now ?? new Date()),
        },
        // Run next step: (status) => `Cannot wait ticket in status ${status}`,
        (status) => `Cannot wait ticket in status ${status}`,
      );

      // Persist lifecycle event (and commandId for replay).
      await writeTicketEvent(tx, {
        // Set ticketId on the structure being built.
        ticketId: ticket.id,
        // Set locationId on the structure being built.
        locationId: ticket.locationId,
        // Run next step: fromStatus,
        fromStatus,
        // Set toStatus on the structure being built.
        toStatus: TicketStatus.waiting,
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: input.actorEmployeeId,
        // Run next step: reason,
        reason,
        // Set commandId on the structure being built.
        commandId: input.commandId,
        // Run next step: commandKey,
        commandKey,
      });

      // Return the computed result to the caller.
      return row;
    });

    // Run next step: publishTicketChanged(updated);
    publishTicketChanged(updated);
    // Notify the assignee that work is paused.
    if (updated.assigneeId) {
      // DedupeKey includes updatedAt so repeated waits notify separately.
      await notifyTicketEvent({
        // Set type on the structure being built.
        type: "ticket.waiting",
        // Set title on the structure being built.
        title: "Ticket waiting",
        // Set body on the structure being built.
        body: `${updated.location?.number ?? "?"}: ${updated.title}`,
        // Set ticket on the structure being built.
        ticket: updated,
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: input.actorEmployeeId,
        // Set recipientEmployeeIds on the structure being built.
        recipientEmployeeIds: [updated.assigneeId],
        // Set dedupeKey on the structure being built.
        dedupeKey: `ticket.waiting:${updated.id}:${updated.updatedAt.toISOString()}`,
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

/**
 * waiting → in_progress. Unpauses SLA and extends dueAt by the paused duration.
 *
 * @param input.ticketId - Ticket primary key.
 * @param input.actorEmployeeId - Assignee or supervisor actor.
 * @param input.bypassAssigneeCheck - Supervisors may resume non-owned assignments.
 * @param input.commandId - Offline idempotency key (optional).
 */
export async function resumeMaintenanceTicket(input: {
  // Set ticketId on the structure being built.
  ticketId: string;
  // Set actorEmployeeId on the structure being built.
  actorEmployeeId: string;
  // Run next step: bypassAssigneeCheck?: boolean;
  bypassAssigneeCheck?: boolean;
  // Run next step: commandId?: string;
  commandId?: string;
  /** Testable clock for unpause dueAt extension (defaults to wall clock). */
  now?: Date;
// Run next step: }) {
}) {
  // Idempotency key for offline / retryable resume commands.
  const commandKey: LifecycleCommandKey = {
    // Set kind on the structure being built.
    kind: "resume",
    // Set ticketId on the structure being built.
    ticketId: input.ticketId,
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: input.actorEmployeeId,
  };
  // Replay prior successful resume with the same commandId.
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  // Idempotent offline retry — skip mutation when event already exists.
  if (replayed) return replayed.ticket;

  // Attempt the fallible work so errors can be handled below.
  try {
    // Serialize resume against concurrent lifecycle mutations.
    // Resume does not take User locks (same rationale as wait — see above).
    const updated = await prisma.$transaction(async (tx) => {
      // Load ticket asynchronously for the next steps.
      const ticket = await loadLockedTicket(tx, input.ticketId);
      // Only waiting may resume.
      if (ticket.status !== TicketStatus.waiting) {
        // Abort with an error so callers can react.
        throw invalidTicketStatusError("resume", ticket.status);
      }
      // Run next step: assertTicketAssigneeOrAllowBypass(
      assertTicketAssigneeOrAllowBypass(
        // Run next step: ticket,
        ticket,
        // Run next step: input.actorEmployeeId,
        input.actorEmployeeId,
        // Run next step: input.bypassAssigneeCheck,
        input.bypassAssigneeCheck,
      );

      // Capture from status for use in this scope.
      const fromStatus = ticket.status;
      // Compute dueAt extension / pause-clear fields from current pause state.
      const unpaused = unpauseFields(ticket, input.now ?? new Date());
      // Claim → in_progress with unpaused SLA fields.
      const row = await claimTicketUpdate(
        // Run next step: tx,
        tx,
        // Run next step: ticket.id,
        ticket.id,
        // Run next step: [TicketStatus.waiting],
        [TicketStatus.waiting],
        // Run next step: {
        {
          // Set status on the structure being built.
          status: TicketStatus.in_progress,
          // Run next step: ...unpaused,
          ...unpaused,
        },
        // Run next step: (status) => `Cannot resume ticket in status ${status}`,
        (status) => `Cannot resume ticket in status ${status}`,
      );

      // Persist lifecycle event marked as a resume.
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
        actorEmployeeId: input.actorEmployeeId,
        // Set payload on the structure being built.
        payload: { resumed: true },
        // Set commandId on the structure being built.
        commandId: input.commandId,
        // Run next step: commandKey,
        commandKey,
      });

      // Return the computed result to the caller.
      return row;
    });

    // Run next step: publishTicketChanged(updated);
    publishTicketChanged(updated);
    // Notify the assignee that work resumed.
    if (updated.assigneeId) {
      // Resume notifies assignee only (same pattern as start/wait).
      await notifyTicketEvent({
        // Set type on the structure being built.
        type: "ticket.resumed",
        // Set title on the structure being built.
        title: "Ticket resumed",
        // Set body on the structure being built.
        body: `${updated.location?.number ?? "?"}: ${updated.title}`,
        // Set ticket on the structure being built.
        ticket: updated,
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: input.actorEmployeeId,
        // Set recipientEmployeeIds on the structure being built.
        recipientEmployeeIds: [updated.assigneeId],
        // Set dedupeKey on the structure being built.
        dedupeKey: `ticket.resumed:${updated.id}:${updated.updatedAt.toISOString()}`,
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
