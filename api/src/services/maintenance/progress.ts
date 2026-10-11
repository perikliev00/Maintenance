import { TicketStatus } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { claimTicketUpdate } from "./claims";
import {
  replayLifecycleCommand,
  type LifecycleCommandKey,
} from "./commands";
import { writeTicketEvent } from "./events";
import { formatMaintenanceTicket } from "./format";
import { loadLockedTicket } from "./locks";
import { notifyTicketEvent, publishTicketChanged } from "./notify";
import { isP2002 } from "./prismaConflicts";
import { pauseFieldsOnWait, unpauseFields } from "./slaPause";

export async function startMaintenanceTicket(input: {
  ticketId: string;
  actorEmployeeId: string;
  bypassAssigneeCheck?: boolean;
  commandId?: string;
}) {
  const commandKey: LifecycleCommandKey = {
    kind: "start",
    ticketId: input.ticketId,
    actorEmployeeId: input.actorEmployeeId,
  };
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  if (replayed) return replayed.ticket;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const ticket = await loadLockedTicket(tx, input.ticketId);
      if (ticket.status !== TicketStatus.assigned) {
        throw new AppError(
          409,
          "invalid_state",
          `Cannot start ticket in status ${ticket.status}`,
        );
      }
      if (!ticket.assigneeId) {
        throw new AppError(409, "invalid_state", "Ticket has no assignee");
      }
      if (
        !input.bypassAssigneeCheck &&
        ticket.assigneeId !== input.actorEmployeeId
      ) {
        throw new AppError(403, "forbidden", "Ticket is assigned to another employee");
      }

      const fromStatus = ticket.status;
      const row = await claimTicketUpdate(
        tx,
        ticket.id,
        [TicketStatus.assigned],
        { status: TicketStatus.in_progress },
        (status) => `Cannot start ticket in status ${status}`,
      );

      await writeTicketEvent(tx, {
        ticketId: ticket.id,
        locationId: ticket.locationId,
        fromStatus,
        toStatus: TicketStatus.in_progress,
        actorEmployeeId: input.actorEmployeeId,
        commandId: input.commandId,
        commandKey,
      });

      return row;
    });

    publishTicketChanged(updated);
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
    if (input.commandId && isP2002(err)) {
      const again = await replayLifecycleCommand(input.commandId, commandKey);
      if (again) return again.ticket;
    }
    throw err;
  }
}

export async function waitMaintenanceTicket(input: {
  ticketId: string;
  actorEmployeeId: string;
  reason?: string;
  bypassAssigneeCheck?: boolean;
  commandId?: string;
}) {
  const reason = input.reason?.trim() || null;
  const commandKey: LifecycleCommandKey = {
    kind: "wait",
    ticketId: input.ticketId,
    actorEmployeeId: input.actorEmployeeId,
    reason,
  };
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  if (replayed) return replayed.ticket;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const ticket = await loadLockedTicket(tx, input.ticketId);
      if (ticket.status !== TicketStatus.in_progress) {
        throw new AppError(
          409,
          "invalid_state",
          `Cannot wait ticket in status ${ticket.status}`,
        );
      }
      if (
        !input.bypassAssigneeCheck &&
        ticket.assigneeId &&
        ticket.assigneeId !== input.actorEmployeeId
      ) {
        throw new AppError(403, "forbidden", "Ticket is assigned to another employee");
      }

      const fromStatus = ticket.status;
      const row = await claimTicketUpdate(
        tx,
        ticket.id,
        [TicketStatus.in_progress],
        {
          status: TicketStatus.waiting,
          ...pauseFieldsOnWait(),
        },
        (status) => `Cannot wait ticket in status ${status}`,
      );

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
    if (updated.assigneeId) {
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
    if (input.commandId && isP2002(err)) {
      const again = await replayLifecycleCommand(input.commandId, commandKey);
      if (again) return again.ticket;
    }
    throw err;
  }
}

export async function resumeMaintenanceTicket(input: {
  ticketId: string;
  actorEmployeeId: string;
  bypassAssigneeCheck?: boolean;
  commandId?: string;
}) {
  const commandKey: LifecycleCommandKey = {
    kind: "resume",
    ticketId: input.ticketId,
    actorEmployeeId: input.actorEmployeeId,
  };
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  if (replayed) return replayed.ticket;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const ticket = await loadLockedTicket(tx, input.ticketId);
      if (ticket.status !== TicketStatus.waiting) {
        throw new AppError(
          409,
          "invalid_state",
          `Cannot resume ticket in status ${ticket.status}`,
        );
      }
      if (
        !input.bypassAssigneeCheck &&
        ticket.assigneeId &&
        ticket.assigneeId !== input.actorEmployeeId
      ) {
        throw new AppError(403, "forbidden", "Ticket is assigned to another employee");
      }

      const fromStatus = ticket.status;
      const unpaused = unpauseFields(ticket);
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
    if (updated.assigneeId) {
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
    if (input.commandId && isP2002(err)) {
      const again = await replayLifecycleCommand(input.commandId, commandKey);
      if (again) return again.ticket;
    }
    throw err;
  }
}
