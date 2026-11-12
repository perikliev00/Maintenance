/**
 * Shared maintenance lifecycle guards: idempotent replay on P2002 / invalid_state,
 * and common status / assignee error shapes. Does not run transitions.
 */
import { TicketStatus } from "@prisma/client";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module dependency for this service.
import {
  // Run next step: replayLifecycleCommand,
  replayLifecycleCommand,
  // Declare type LifecycleCommandKey for callers and internals.
  type LifecycleCommandKey,
// Run next step: } from "./commands";
} from "./commands";
// Import type(s) FormattedMaintenanceTicket for typing without runtime cost.
import type { FormattedMaintenanceTicket } from "./format";
// Import module ./prismaConflicts for this service.
import { isP2002 } from "./prismaConflicts";

// Declare type LifecycleReplay for callers and internals.
type LifecycleReplay = {
  // Set ticket on the structure being built.
  ticket: FormattedMaintenanceTicket;
  // Set eventId on the structure being built.
  eventId: string;
};

/**
 * When a lifecycle command loses a commandId or status-claim race, replay the
 * prior successful TicketEvent if fingerprints match.
 */
export async function catchLifecycleCommandReplay(
  // Set err on the structure being built.
  err: unknown,
  // Set commandId on the structure being built.
  commandId: string | undefined,
  // Set commandKey on the structure being built.
  commandKey: LifecycleCommandKey,
// Run next step: ): Promise<LifecycleReplay | null> {
): Promise<LifecycleReplay | null> {
  // Branch when this condition holds so the right path runs.
  if (!commandId) return null;
  // Branch when this condition holds so the right path runs.
  if (
    // Run next step: isP2002(err) ||
    isP2002(err) ||
    // Run next step: (err instanceof AppError && err.code === "invalid_state")
    (err instanceof AppError && err.code === "invalid_state")
  // Run next step: ) {
  ) {
    // Load again asynchronously for the next steps.
    const again = await replayLifecycleCommand(commandId, commandKey);
    // Branch when this condition holds so the right path runs.
    if (again) {
      // Return the computed result to the caller.
      return { ticket: again.ticket, eventId: again.eventId };
    }
  }
  // Return the computed result to the caller.
  return null;
}

/** 409 invalid_state for a lifecycle action from the wrong ticket status. */
export function invalidTicketStatusError(
  // Set action on the structure being built.
  action: string,
  // Set status on the structure being built.
  status: TicketStatus,
// Run next step: ): AppError {
): AppError {
  // Return the computed result to the caller.
  return new AppError(
    // Run next step: 409,
    409,
    // Run next step: "invalid_state",
    "invalid_state",
    // Run next step: `Cannot ${action} ticket in status ${status}`,
    `Cannot ${action} ticket in status ${status}`,
  );
}

/** Assignee-only gate unless supervisor bypass is enabled. */
export function assertTicketAssigneeOrAllowBypass(
  // Set ticket on the structure being built.
  ticket: { assigneeId: string | null },
  // Set actorEmployeeId on the structure being built.
  actorEmployeeId: string,
  // Run next step: bypassAssigneeCheck?: boolean,
  bypassAssigneeCheck?: boolean,
// Run next step: ): void {
): void {
  // Branch when this condition holds so the right path runs.
  if (
    // Run next step: !bypassAssigneeCheck &&
    !bypassAssigneeCheck &&
    // Run next step: ticket.assigneeId &&
    ticket.assigneeId &&
    // Run next step: ticket.assigneeId !== actorEmployeeId
    ticket.assigneeId !== actorEmployeeId
  // Run next step: ) {
  ) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 403,
      403,
      // Run next step: "forbidden",
      "forbidden",
      // Run next step: "Ticket is assigned to another employee",
      "Ticket is assigned to another employee",
    );
  }
}
