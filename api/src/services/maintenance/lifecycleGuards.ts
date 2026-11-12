/**
 * Shared maintenance lifecycle guards: idempotent replay on P2002 / invalid_state,
 * and common status / assignee error shapes. Does not run transitions.
 */
import { TicketStatus } from "@prisma/client";
import { AppError } from "../../errors";
import {
  replayLifecycleCommand,
  // Declare type LifecycleCommandKey for callers and internals.
  type LifecycleCommandKey,
} from "./commands";
// Import type(s) FormattedMaintenanceTicket for typing without runtime cost.
import type { FormattedMaintenanceTicket } from "./format";
import { isP2002 } from "./prismaConflicts";

// Declare type LifecycleReplay for callers and internals.
type LifecycleReplay = {
  ticket: FormattedMaintenanceTicket;
  eventId: string;
};

/**
 * When a lifecycle command loses a commandId or status-claim race, replay the
 * prior successful TicketEvent if fingerprints match.
 */
export async function catchLifecycleCommandReplay(
  err: unknown,
  commandId: string | undefined,
  commandKey: LifecycleCommandKey,
): Promise<LifecycleReplay | null> {
  if (!commandId) return null;
  if (
    isP2002(err) ||
    (err instanceof AppError && err.code === "invalid_state")
  ) {
    const again = await replayLifecycleCommand(commandId, commandKey);
    if (again) {
      return { ticket: again.ticket, eventId: again.eventId };
    }
  }
  return null;
}

/** 409 invalid_state for a lifecycle action from the wrong ticket status. */
export function invalidTicketStatusError(
  action: string,
  status: TicketStatus,
): AppError {
  return new AppError(
    409,
    "invalid_state",
    `Cannot ${action} ticket in status ${status}`,
  );
}

/** Assignee-only gate unless supervisor bypass is enabled. */
export function assertTicketAssigneeOrAllowBypass(
  ticket: { assigneeId: string | null },
  actorEmployeeId: string,
  bypassAssigneeCheck?: boolean,
): void {
  if (
    !bypassAssigneeCheck &&
    ticket.assigneeId &&
    ticket.assigneeId !== actorEmployeeId
  ) {
    // Abort with an error so callers can react.
    throw new AppError(
      403,
      "forbidden",
      "Ticket is assigned to another employee",
    );
  }
}
