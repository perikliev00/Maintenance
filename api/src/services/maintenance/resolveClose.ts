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
import { unpauseFields } from "./slaPause";

export async function resolveMaintenanceTicket(input: {
  ticketId: string;
  resolvedByEmployeeId: string;
  resolutionNotes?: string;
  bypassAssigneeCheck?: boolean;
  commandId?: string;
}) {
  const notes = input.resolutionNotes?.trim() || null;
  const commandKey: LifecycleCommandKey = {
    kind: "resolve",
    ticketId: input.ticketId,
    actorEmployeeId: input.resolvedByEmployeeId,
    resolutionNotes: notes,
  };
  const replayed = await replayLifecycleCommand(input.commandId, commandKey);
  if (replayed) return replayed.ticket;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const ticket = await loadLockedTicket(tx, input.ticketId);
      if (
        ticket.status !== TicketStatus.in_progress &&
        ticket.status !== TicketStatus.waiting
      ) {
        throw new AppError(
          409,
          "invalid_state",
          `Cannot resolve ticket in status ${ticket.status}`,
        );
      }
      if (
        !input.bypassAssigneeCheck &&
        ticket.assigneeId &&
        ticket.assigneeId !== input.resolvedByEmployeeId
      ) {
        throw new AppError(403, "forbidden", "Ticket is assigned to another employee");
      }

      const fromStatus = ticket.status;
      const unpaused =
        ticket.status === TicketStatus.waiting
          ? unpauseFields(ticket)
          : {
              slaPausedAt: null,
              slaPausedMsTotal: ticket.slaPausedMsTotal,
              dueAt: ticket.dueAt,
            };

      const row = await claimTicketUpdate(
        tx,
        ticket.id,
        [TicketStatus.in_progress, TicketStatus.waiting],
        {
          status: TicketStatus.resolved,
          resolvedAt: new Date(),
          resolvedByEmployeeId: input.resolvedByEmployeeId,
          resolutionNotes: notes,
          ...unpaused,
        },
        (status) => `Cannot resolve ticket in status ${status}`,
      );

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

    publishTicketChanged(updated);
    {
      const recipients = [
        updated.assigneeId,
        updated.reportedByEmployeeId,
      ].filter((id): id is string => Boolean(id));
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
    return formatMaintenanceTicket(updated);
  } catch (err) {
    if (input.commandId && isP2002(err)) {
      const again = await replayLifecycleCommand(input.commandId, commandKey);
      if (again) return again.ticket;
    }
    throw err;
  }
}

export async function closeMaintenanceTicket(input: {
  ticketId: string;
  closedByEmployeeId: string;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await loadLockedTicket(tx, input.ticketId);
    if (ticket.status !== TicketStatus.resolved) {
      throw new AppError(
        409,
        "invalid_state",
        `Cannot close ticket in status ${ticket.status}`,
      );
    }

    const fromStatus = ticket.status;
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

    await writeTicketEvent(tx, {
      ticketId: ticket.id,
      locationId: ticket.locationId,
      fromStatus,
      toStatus: TicketStatus.closed,
      actorEmployeeId: input.closedByEmployeeId,
    });

    return row;
  });

  publishTicketChanged(updated);
  {
    const recipients = [
      updated.assigneeId,
      updated.reportedByEmployeeId,
    ].filter((id): id is string => Boolean(id));
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
  return formatMaintenanceTicket(updated);
}

export async function reopenMaintenanceTicket(input: {
  ticketId: string;
  reopenedByEmployeeId: string;
  reason?: string;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await loadLockedTicket(tx, input.ticketId);
    if (
      ticket.status !== TicketStatus.resolved &&
      ticket.status !== TicketStatus.closed
    ) {
      throw new AppError(
        409,
        "invalid_state",
        "Only resolved or closed tickets can be reopened",
      );
    }

    const reason = input.reason?.trim() || null;
    const fromStatus = ticket.status;

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
        slaPausedAt: null,
      },
      () => "Only resolved or closed tickets can be reopened",
    );

    await tx.ticketReopenEvent.create({
      data: {
        ticketId: ticket.id,
        reopenedByEmployeeId: input.reopenedByEmployeeId,
        reason,
        previousStatus: fromStatus,
      },
    });

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

  publishTicketChanged(updated);
  {
    const recipients = [
      updated.assigneeId,
      updated.reportedByEmployeeId,
    ].filter((id): id is string => Boolean(id));
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
