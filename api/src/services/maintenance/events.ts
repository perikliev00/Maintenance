/**
 * Persist ticket status transitions: TicketEvent row + matching audit entry.
 */
import { TicketStatus } from "@prisma/client";
import { recordAudit } from "../audit";
import {
  lifecyclePayloadFingerprint,
  // Declare type LifecycleCommandKey for callers and internals.
  type LifecycleCommandKey,
} from "./commands";
// Import type(s) TicketEventPayload, Tx for typing without runtime cost.
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
      // Complete the ternary or optional chain started above.
      ? { ...(input.payload as Record<string, unknown>) }
      // Complete the ternary or optional chain started above.
      : {};
  // Fingerprint ties commandId uniqueness to the semantic payload, not just the id.
  const payload =
    input.commandKey != null
      // Complete the ternary or optional chain started above.
      ? {
          ...payloadBase,
          _commandFingerprint: lifecyclePayloadFingerprint(input.commandKey),
        }
      // Complete the ternary or optional chain started above.
      : input.payload;

  // Append-only lifecycle row (unique commandId when provided).
  const event = await tx.ticketEvent.create({
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
          // Complete the ternary or optional chain started above.
          ? (input.payload as Record<string, unknown>)
          // Complete the ternary or optional chain started above.
          : {};
      // Reopen/resume are payload flags, not distinct TicketStatus values.
      if (payload.reopen) return "ticket.reopen";
      if (payload.resumed) return "ticket.resume";
      // Map toStatus → stable audit action string.
      switch (input.toStatus) {
        // Handle this specific case value.
        case TicketStatus.new:
          // Initial create transition.
          return "ticket.create";
        // Handle this specific case value.
        case TicketStatus.assigned:
          // Assign / reassign before work starts.
          return "ticket.assign";
        // Handle this specific case value.
        case TicketStatus.in_progress:
          // Technician started work.
          return "ticket.start";
        // Handle this specific case value.
        case TicketStatus.waiting:
          // Paused for parts/guest/etc.
          return "ticket.wait";
        // Handle this specific case value.
        case TicketStatus.resolved:
          // Work done, awaiting close.
          return "ticket.resolve";
        // Handle this specific case value.
        case TicketStatus.closed:
          // Terminal closed state.
          return "ticket.close";
        // Cover any unmatched case.
        default:
          // Future statuses get a namespaced fallback.
          return `ticket.${input.toStatus}`;
      }
    })();

  // Human-readable default when the caller did not supply summary.
  const defaultSummary = (() => {
    // Dispatch on the discriminant to pick the matching case.
    switch (action) {
      // Handle this specific case value.
      case "ticket.create":
        return "Created ticket";
      // Handle this specific case value.
      case "ticket.assign":
        return "Assigned ticket";
      // Handle this specific case value.
      case "ticket.start":
        return "Started ticket";
      // Handle this specific case value.
      case "ticket.wait":
        return "Ticket set to waiting";
      // Handle this specific case value.
      case "ticket.resume":
        // Resume is payload-driven, not a TicketStatus.
        return "Resumed ticket";
      // Handle this specific case value.
      case "ticket.resolve":
        return "Resolved ticket";
      // Handle this specific case value.
      case "ticket.close":
        return "Closed ticket";
      // Handle this specific case value.
      case "ticket.reopen":
        // Reopen is payload-driven, not a TicketStatus.
        return "Reopened ticket";
      // Cover any unmatched case.
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
          // Complete the ternary or optional chain started above.
          ? (input.payload as object)
          // Complete the ternary or optional chain started above.
          : {}),
      },
      // Prefer caller summary; fall back to the action-derived default.
      summary: input.summary?.trim() || defaultSummary,
    },
    tx,
  );
  return event;
}
