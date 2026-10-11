import { TicketStatus } from "@prisma/client";
import { recordAudit } from "../audit";
import {
  lifecyclePayloadFingerprint,
  type LifecycleCommandKey,
} from "./commands";
import type { TicketEventPayload, Tx } from "./types";

export async function writeTicketEvent(
  tx: Tx,
  input: {
    ticketId: string;
    locationId?: string;
    fromStatus: TicketStatus | null;
    toStatus: TicketStatus;
    actorEmployeeId: string;
    reason?: string | null;
    payload?: TicketEventPayload;
    action?: string;
    summary?: string;
    commandId?: string;
    commandKey?: LifecycleCommandKey;
  },
) {
  const payloadBase =
    input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
      ? { ...(input.payload as Record<string, unknown>) }
      : {};
  const payload =
    input.commandKey != null
      ? {
          ...payloadBase,
          _commandFingerprint: lifecyclePayloadFingerprint(input.commandKey),
        }
      : input.payload;

  await tx.ticketEvent.create({
    data: {
      ticketId: input.ticketId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actorEmployeeId: input.actorEmployeeId,
      reason: input.reason ?? null,
      payload: (payload as TicketEventPayload) ?? undefined,
      commandId: input.commandId ?? null,
    },
  });

  const action =
    input.action ??
    (() => {
      const payload =
        input.payload && typeof input.payload === "object" && input.payload !== null
          ? (input.payload as Record<string, unknown>)
          : {};
      if (payload.reopen) return "ticket.reopen";
      if (payload.resumed) return "ticket.resume";
      switch (input.toStatus) {
        case TicketStatus.new:
          return "ticket.create";
        case TicketStatus.assigned:
          return "ticket.assign";
        case TicketStatus.in_progress:
          return "ticket.start";
        case TicketStatus.waiting:
          return "ticket.wait";
        case TicketStatus.resolved:
          return "ticket.resolve";
        case TicketStatus.closed:
          return "ticket.close";
        default:
          return `ticket.${input.toStatus}`;
      }
    })();

  const defaultSummary = (() => {
    switch (action) {
      case "ticket.create":
        return "Created ticket";
      case "ticket.assign":
        return "Assigned ticket";
      case "ticket.start":
        return "Started ticket";
      case "ticket.wait":
        return "Ticket set to waiting";
      case "ticket.resume":
        return "Resumed ticket";
      case "ticket.resolve":
        return "Resolved ticket";
      case "ticket.close":
        return "Closed ticket";
      case "ticket.reopen":
        return "Reopened ticket";
      default:
        return `Ticket ${input.toStatus}`;
    }
  })();

  await recordAudit(
    {
      actorEmployeeId: input.actorEmployeeId,
      action,
      entityType: "ticket",
      entityId: input.ticketId,
      locationId: input.locationId,
      reason: input.reason,
      before: input.fromStatus ? { status: input.fromStatus } : null,
      after: {
        status: input.toStatus,
        ...(input.payload && typeof input.payload === "object"
          ? (input.payload as object)
          : {}),
      },
      summary: input.summary?.trim() || defaultSummary,
    },
    tx,
  );
}
