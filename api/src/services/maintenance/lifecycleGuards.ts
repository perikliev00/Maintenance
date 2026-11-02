/**
 * Shared maintenance lifecycle guards: idempotent replay on P2002 / invalid_state,
 * and common status / assignee error shapes. Does not run transitions.
 */
import { TicketStatus } from "@prisma/client";
import { AppError } from "../../errors";
import {
  replayLifecycleCommand,
  type LifecycleCommandKey,
} from "./commands";
import type { FormattedMaintenanceTicket } from "./format";
import { isP2002 } from "./prismaConflicts";

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
    throw new AppError(
      403,
      "forbidden",
      "Ticket is assigned to another employee",
    );
  }
}
