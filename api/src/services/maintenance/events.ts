/**
 * Persist ticket status transitions: TicketEvent row + matching audit entry.
 */
import { TicketStatus } from "@prisma/client";
import { recordAudit } from "../audit";
import {
  lifecyclePayloadFingerprint,
  type LifecycleCommandKey,
} from "./commands";
import type { TicketEventPayload, Tx } from "./types";

/**
 * Writes a ticket event and audit record inside the caller's transaction.
 * When `commandKey` is set, embeds `_commandFingerprint` so idempotent replays
 * can detect commandId reuse with a different payload.
 */
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
  // Normalize payload to a plain object; ignore arrays/non-objects.
  const payloadBase =
    input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
      ? { ...(input.payload as Record<string, unknown>) }
      : {};
  // Fingerprint ties commandId uniqueness to the semantic payload, not just the id.
  const payload =
    input.commandKey != null
      ? {
          ...payloadBase,
          _commandFingerprint: lifecyclePayloadFingerprint(input.commandKey),
        }
      : input.payload;

  // Append-only lifecycle row (unique commandId when provided).
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

  // Resolve audit action: explicit override, else derive from payload/status.
  const action =
    input.action ??
    (() => {
      // Re-read payload for reopen/resume flags (same object the caller passed).
      const payload =
        input.payload && typeof input.payload === "object" && input.payload !== null
          ? (input.payload as Record<string, unknown>)
          : {};
      // Reopen/resume are payload flags, not distinct TicketStatus values.
      if (payload.reopen) return "ticket.reopen";
      if (payload.resumed) return "ticket.resume";
      // Map toStatus → stable audit action string.
      switch (input.toStatus) {
        case TicketStatus.new:
          // Initial create transition.
          return "ticket.create";
        case TicketStatus.assigned:
          // Assign / reassign before work starts.
          return "ticket.assign";
        case TicketStatus.in_progress:
          // Technician started work.
          return "ticket.start";
        case TicketStatus.waiting:
          // Paused for parts/guest/etc.
          return "ticket.wait";
        case TicketStatus.resolved:
          // Work done, awaiting close.
          return "ticket.resolve";
        case TicketStatus.closed:
          // Terminal closed state.
          return "ticket.close";
        default:
          // Future statuses get a namespaced fallback.
          return `ticket.${input.toStatus}`;
      }
    })();

  // Human-readable default when the caller did not supply summary.
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
        // Resume is payload-driven, not a TicketStatus.
        return "Resumed ticket";
      case "ticket.resolve":
        return "Resolved ticket";
      case "ticket.close":
        return "Closed ticket";
      case "ticket.reopen":
        // Reopen is payload-driven, not a TicketStatus.
        return "Reopened ticket";
      default:
        // Fallback uses the toStatus enum value.
        return `Ticket ${input.toStatus}`;
    }
  })();

  // Mirror the transition into the unified audit trail (same DB transaction).
  await recordAudit(
    {
      actorEmployeeId: input.actorEmployeeId,
      action,
      entityType: "ticket",
      entityId: input.ticketId,
      locationId: input.locationId,
      reason: input.reason,
      // Compact before/after status (+ optional payload fields) for chronology UI.
      before: input.fromStatus ? { status: input.fromStatus } : null,
      after: {
        status: input.toStatus,
        ...(input.payload && typeof input.payload === "object"
          ? (input.payload as object)
          : {}),
      },
      // Prefer caller summary; fall back to the action-derived default.
      summary: input.summary?.trim() || defaultSummary,
    },
    tx,
  );
}
