/**
 * Persist ticket status transitions: TicketEvent row + matching audit entry.
 */
import { TicketStatus } from "@prisma/client";
// Import module ../audit for this service.
import { recordAudit } from "../audit";
// Import module dependency for this service.
import {
  // Run next step: lifecyclePayloadFingerprint,
  lifecyclePayloadFingerprint,
  // Declare type LifecycleCommandKey for callers and internals.
  type LifecycleCommandKey,
// Run next step: } from "./commands";
} from "./commands";
// Import type(s) TicketEventPayload, Tx for typing without runtime cost.
import type { TicketEventPayload, Tx } from "./types";

/**
 * Writes a ticket event and audit record inside the caller's transaction.
 * When `commandKey` is set, embeds `_commandFingerprint` so idempotent replays
 * can detect commandId reuse with a different payload.
 */
export async function writeTicketEvent(
  // Set tx on the structure being built.
  tx: Tx,
  // Set input on the structure being built.
  input: {
    // Set ticketId on the structure being built.
    ticketId: string;
    // Run next step: locationId?: string;
    locationId?: string;
    // Set fromStatus on the structure being built.
    fromStatus: TicketStatus | null;
    // Set toStatus on the structure being built.
    toStatus: TicketStatus;
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: string;
    // Run next step: reason?: string | null;
    reason?: string | null;
    // Run next step: payload?: TicketEventPayload;
    payload?: TicketEventPayload;
    // Run next step: action?: string;
    action?: string;
    // Run next step: summary?: string;
    summary?: string;
    // Run next step: commandId?: string;
    commandId?: string;
    // Run next step: commandKey?: LifecycleCommandKey;
    commandKey?: LifecycleCommandKey;
  },
// Run next step: ) {
) {
  // Normalize payload to a plain object; ignore arrays/non-objects.
  const payloadBase =
    // Run next step: input.payload && typeof input.payload === "object" && !Array…
    input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
      // Complete the ternary or optional chain started above.
      ? { ...(input.payload as Record<string, unknown>) }
      // Complete the ternary or optional chain started above.
      : {};
  // Fingerprint ties commandId uniqueness to the semantic payload, not just the id.
  const payload =
    // Run next step: input.commandKey != null
    input.commandKey != null
      // Complete the ternary or optional chain started above.
      ? {
          // Run next step: ...payloadBase,
          ...payloadBase,
          // Set _commandFingerprint on the structure being built.
          _commandFingerprint: lifecyclePayloadFingerprint(input.commandKey),
        }
      // Complete the ternary or optional chain started above.
      : input.payload;

  // Append-only lifecycle row (unique commandId when provided).
  const event = await tx.ticketEvent.create({
    // Set data on the structure being built.
    data: {
      // Set ticketId on the structure being built.
      ticketId: input.ticketId,
      // Set fromStatus on the structure being built.
      fromStatus: input.fromStatus,
      // Set toStatus on the structure being built.
      toStatus: input.toStatus,
      // Set actorEmployeeId on the structure being built.
      actorEmployeeId: input.actorEmployeeId,
      // Set reason on the structure being built.
      reason: input.reason ?? null,
      // Set payload on the structure being built.
      payload: (payload as TicketEventPayload) ?? undefined,
      // Set commandId on the structure being built.
      commandId: input.commandId ?? null,
    },
  });

  // Resolve audit action: explicit override, else derive from payload/status.
  const action =
    // Run next step: input.action ??
    input.action ??
    // Run next step: (() => {
    (() => {
      // Re-read payload for reopen/resume flags (same object the caller passed).
      const payload =
        // Run next step: input.payload && typeof input.payload === "object" && input.…
        input.payload && typeof input.payload === "object" && input.payload !== null
          // Complete the ternary or optional chain started above.
          ? (input.payload as Record<string, unknown>)
          // Complete the ternary or optional chain started above.
          : {};
      // Reopen/resume are payload flags, not distinct TicketStatus values.
      if (payload.reopen) return "ticket.reopen";
      // Branch when this condition holds so the right path runs.
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
    // Run next step: })();
    })();

  // Human-readable default when the caller did not supply summary.
  const defaultSummary = (() => {
    // Dispatch on the discriminant to pick the matching case.
    switch (action) {
      // Handle this specific case value.
      case "ticket.create":
        // Return the computed result to the caller.
        return "Created ticket";
      // Handle this specific case value.
      case "ticket.assign":
        // Return the computed result to the caller.
        return "Assigned ticket";
      // Handle this specific case value.
      case "ticket.start":
        // Return the computed result to the caller.
        return "Started ticket";
      // Handle this specific case value.
      case "ticket.wait":
        // Return the computed result to the caller.
        return "Ticket set to waiting";
      // Handle this specific case value.
      case "ticket.resume":
        // Resume is payload-driven, not a TicketStatus.
        return "Resumed ticket";
      // Handle this specific case value.
      case "ticket.resolve":
        // Return the computed result to the caller.
        return "Resolved ticket";
      // Handle this specific case value.
      case "ticket.close":
        // Return the computed result to the caller.
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
  // Run next step: })();
  })();

  // Mirror the transition into the unified audit trail (same DB transaction).
  await recordAudit(
    // Run next step: {
    {
      // Set actorEmployeeId on the structure being built.
      actorEmployeeId: input.actorEmployeeId,
      // Run next step: action,
      action,
      // Set entityType on the structure being built.
      entityType: "ticket",
      // Set entityId on the structure being built.
      entityId: input.ticketId,
      // Set locationId on the structure being built.
      locationId: input.locationId,
      // Set reason on the structure being built.
      reason: input.reason,
      // Compact before/after status (+ optional payload fields) for chronology UI.
      before: input.fromStatus ? { status: input.fromStatus } : null,
      // Set after on the structure being built.
      after: {
        // Set status on the structure being built.
        status: input.toStatus,
        // Run next step: ...(input.payload && typeof input.payload === "object"
        ...(input.payload && typeof input.payload === "object"
          // Complete the ternary or optional chain started above.
          ? (input.payload as object)
          // Complete the ternary or optional chain started above.
          : {}),
      },
      // Prefer caller summary; fall back to the action-derived default.
      summary: input.summary?.trim() || defaultSummary,
    },
    // Run next step: tx,
    tx,
  );
  // Return the computed result to the caller.
  return event;
}
