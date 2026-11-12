/**
 * Idempotent lifecycle/create commands keyed by client commandId.
 * Fingerprints the semantic payload so the same commandId cannot be reused for a
 * different actor/ticket/notes combination (or a different create payload).
 */
import { createHash } from "crypto";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../commandIdempotency for this service.
import { assertCommandPayloadMatch } from "../commandIdempotency";
// Import module ./format for this service.
import { formatMaintenanceTicket, type FormattedMaintenanceTicket } from "./format";
// Import module ./types for this service.
import { ticketInclude } from "./types";

// Declare type LifecycleCommandKind for callers and internals.
export type LifecycleCommandKind =
  // Run next step: | "start"
  | "start"
  // Run next step: | "wait"
  | "wait"
  // Run next step: | "resume"
  | "resume"
  // Run next step: | "resolve"
  | "resolve"
  // Run next step: | "assign"
  | "assign"
  // Run next step: | "close"
  | "close"
  // Run next step: | "reopen";
  | "reopen";

/** Canonical fields hashed into `_commandFingerprint` on the ticket event payload. */
export type LifecycleCommandKey = {
  // Set kind on the structure being built.
  kind: LifecycleCommandKind;
  // Set ticketId on the structure being built.
  ticketId: string;
  // Set actorEmployeeId on the structure being built.
  actorEmployeeId: string;
  // Run next step: reason?: string | null;
  reason?: string | null;
  // Run next step: resolutionNotes?: string | null;
  resolutionNotes?: string | null;
  /** Present for assign — fingerprint must bind the chosen technician. */
  assigneeId?: string | null;
};

/** Canonical fields for create commandId fingerprinting. */
export type CreateCommandKey = {
  // Set kind on the structure being built.
  kind: "create";
  // Set locationId on the structure being built.
  locationId: string;
  // Set reportedByEmployeeId on the structure being built.
  reportedByEmployeeId: string;
  // Run next step: issueOptionId?: string | null;
  issueOptionId?: string | null;
  // Run next step: categoryId?: string | null;
  categoryId?: string | null;
  // Run next step: title?: string | null;
  title?: string | null;
  // Run next step: description?: string | null;
  description?: string | null;
  // Run next step: priority?: string | null;
  priority?: string | null;
  // Set blocksRoom on the structure being built.
  blocksRoom: boolean;
};

/** Stable hash of the lifecycle command key for conflict detection on replay. */
export function lifecyclePayloadFingerprint(key: LifecycleCommandKey): string {
  // Null-normalize optional fields so undefined vs null hash identically.
  // Keep legacy start/wait/resume/resolve hashes stable — only assign binds assigneeId.
  const normalized =
    // Run next step: key.kind === "assign"
    key.kind === "assign"
      // Complete the ternary or optional chain started above.
      ? {
          // Set kind on the structure being built.
          kind: key.kind,
          // Set ticketId on the structure being built.
          ticketId: key.ticketId,
          // Set actorEmployeeId on the structure being built.
          actorEmployeeId: key.actorEmployeeId,
          // Set reason on the structure being built.
          reason: key.reason ?? null,
          // Set resolutionNotes on the structure being built.
          resolutionNotes: key.resolutionNotes ?? null,
          // Set assigneeId on the structure being built.
          assigneeId: key.assigneeId ?? null,
        }
      // Complete the ternary or optional chain started above.
      : {
          // Set kind on the structure being built.
          kind: key.kind,
          // Set ticketId on the structure being built.
          ticketId: key.ticketId,
          // Set actorEmployeeId on the structure being built.
          actorEmployeeId: key.actorEmployeeId,
          // Set reason on the structure being built.
          reason: key.reason ?? null,
          // Set resolutionNotes on the structure being built.
          resolutionNotes: key.resolutionNotes ?? null,
        };
  // SHA-256 hex of the canonical JSON — stored as `_commandFingerprint`.
  return createHash("sha256")
    // Continue the chained call from the previous expression.
    .update(JSON.stringify(normalized))
    // Continue the chained call from the previous expression.
    .digest("hex");
}

/** Stable hash of the create command key. */
export function createPayloadFingerprint(key: CreateCommandKey): string {
  // Build normalized object holding related fields.
  const normalized = {
    // Set kind on the structure being built.
    kind: key.kind,
    // Set locationId on the structure being built.
    locationId: key.locationId,
    // Set reportedByEmployeeId on the structure being built.
    reportedByEmployeeId: key.reportedByEmployeeId,
    // Set issueOptionId on the structure being built.
    issueOptionId: key.issueOptionId ?? null,
    // Set categoryId on the structure being built.
    categoryId: key.categoryId ?? null,
    // Set title on the structure being built.
    title: key.title ?? null,
    // Set description on the structure being built.
    description: key.description ?? null,
    // Set priority on the structure being built.
    priority: key.priority ?? null,
    // Set blocksRoom on the structure being built.
    blocksRoom: key.blocksRoom,
  };
  // Return the computed result to the caller.
  return createHash("sha256")
    // Continue the chained call from the previous expression.
    .update(JSON.stringify(normalized))
    // Continue the chained call from the previous expression.
    .digest("hex");
}

/** Read `_commandFingerprint` from a ticket event payload, if present. */
export function readCommandFingerprint(payload: unknown): string | null {
  // Non-objects / arrays cannot carry a fingerprint field.
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    // Return the computed result to the caller.
    return null;
  }
  // Optional field written by writeTicketEvent when commandKey is set.
  const fp = (payload as { _commandFingerprint?: unknown })._commandFingerprint;
  // Only accept string fingerprints (ignore corrupted shapes).
  return typeof fp === "string" ? fp : null;
}

/** Look up a prior TicketEvent by client commandId (with ticket include). */
async function findTicketByLifecycleCommand(commandId: string) {
  // Unique commandId → at most one prior event for idempotent replay.
  const event = await prisma.ticketEvent.findUnique({
    // Set where on the structure being built.
    where: { commandId },
    // Set include on the structure being built.
    include: { ticket: { include: ticketInclude } },
  });
  // Return the computed result to the caller.
  return event;
}

/** 409 when commandId is reused for a different ticket/actor/payload. */
function assertLifecycleCommandMatch(
  // Set event on the structure being built.
  event: { ticketId: string; actorEmployeeId: string; payload: unknown },
  // Set key on the structure being built.
  key: LifecycleCommandKey,
// Run next step: ) {
) {
  // Expected fingerprint from the new request's semantic key.
  const expected = lifecyclePayloadFingerprint(key);
  // Fingerprint stored on the prior event payload (may be missing on legacy rows).
  const actual = readCommandFingerprint(event.payload);
  // Mismatch on fingerprint, ticket, or actor → treat as commandId collision.
  assertCommandPayloadMatch(
    // Update actual as control flow progresses.
    actual === expected &&
      // Run next step: event.ticketId === key.ticketId &&
      event.ticketId === key.ticketId &&
      // Run next step: event.actorEmployeeId === key.actorEmployeeId,
      event.actorEmployeeId === key.actorEmployeeId,
  );
}

/**
 * If this commandId already produced a ticket event, return that ticket (idempotent
 * success) or 409 when the fingerprint/actor/ticket do not match the new request.
 * Also rejects commandIds already consumed by a create on MaintenanceTicket.
 */
export async function replayLifecycleCommand(
  // Set commandId on the structure being built.
  commandId: string | undefined,
  // Set key on the structure being built.
  key: LifecycleCommandKey,
// Run next step: ): Promise<{ ticket: FormattedMaintenanceTicket; eventId: st…
): Promise<{ ticket: FormattedMaintenanceTicket; eventId: string; idempotent: true } | null> {
  // Online paths without commandId skip idempotency entirely.
  if (!commandId) return null;

  // Create namespace: ticket.commandId occupied by a report → cannot reuse for lifecycle.
  // Allow replay only when a matching lifecycle event exists (below); create-only
  // commandIds fingerprint-mismatch → 409 via findTicketByLifecycleCommand.
  const created = await prisma.maintenanceTicket.findUnique({
    // Set where on the structure being built.
    where: { commandId },
    // Set select on the structure being built.
    select: { id: true },
  });

  // Load existing asynchronously for the next steps.
  const existing = await findTicketByLifecycleCommand(commandId);
  // First time seeing this commandId on TicketEvent — caller proceeds (unless create-only).
  if (!existing) {
    // Create used this commandId on the ticket row but somehow no event — still conflict.
    if (created) {
      // Run next step: assertCommandPayloadMatch(false);
      assertCommandPayloadMatch(false);
    }
    // Return the computed result to the caller.
    return null;
  }
  // Replay: same fingerprint → return prior ticket; mismatch → 409.
  assertLifecycleCommandMatch(existing, key);
  // Return the computed result to the caller.
  return {
    // Set ticket on the structure being built.
    ticket: formatMaintenanceTicket(existing.ticket),
    // Set eventId on the structure being built.
    eventId: existing.id,
    // Set idempotent on the structure being built.
    idempotent: true,
  };
}

/**
 * Assert create replay matches fingerprint; throw conflict on mismatch.
 * Returns formatted ticket when the prior create event matches.
 */
export async function replayCreateCommand(
  // Set commandId on the structure being built.
  commandId: string | undefined,
  // Set key on the structure being built.
  key: CreateCommandKey,
// Run next step: ): Promise<{ ticket: FormattedMaintenanceTicket; idempotent:…
): Promise<{ ticket: FormattedMaintenanceTicket; idempotent: true } | null> {
  // Branch when this condition holds so the right path runs.
  if (!commandId) return null;

  // Lifecycle (or other) event already owns this commandId.
  const event = await prisma.ticketEvent.findUnique({
    // Set where on the structure being built.
    where: { commandId },
    // Set include on the structure being built.
    include: { ticket: { include: ticketInclude } },
  });
  // Branch when this condition holds so the right path runs.
  if (event) {
    // Capture expected for use in this scope.
    const expected = createPayloadFingerprint(key);
    // Capture actual for use in this scope.
    const actual = readCommandFingerprint(event.payload);
    // Run next step: assertCommandPayloadMatch(actual === expected);
    assertCommandPayloadMatch(actual === expected);
    // Return the computed result to the caller.
    return {
      // Set ticket on the structure being built.
      ticket: formatMaintenanceTicket(event.ticket),
      // Set idempotent on the structure being built.
      idempotent: true,
    };
  }

  // Ticket row may exist without event in legacy data — fingerprint via ticket fields.
  const ticket = await prisma.maintenanceTicket.findUnique({
    // Set where on the structure being built.
    where: { commandId },
    // Set include on the structure being built.
    include: ticketInclude,
  });
  // Branch when this condition holds so the right path runs.
  if (!ticket) return null;

  // Capture expected for use in this scope.
  const expected = createPayloadFingerprint(key);
  // Option path snapshotted category id on the row — fingerprint used null categoryId.
  const actualKey: CreateCommandKey = {
    // Set kind on the structure being built.
    kind: "create",
    // Set locationId on the structure being built.
    locationId: ticket.locationId,
    // Set reportedByEmployeeId on the structure being built.
    reportedByEmployeeId: ticket.reportedByEmployeeId ?? "",
    // Set issueOptionId on the structure being built.
    issueOptionId: ticket.issueOptionId,
    // Set categoryId on the structure being built.
    categoryId: ticket.issueOptionId ? null : ticket.maintenanceCategoryId,
    // Set title on the structure being built.
    title: ticket.title,
    // Set priority on the structure being built.
    priority: ticket.priority,
    // Set blocksRoom on the structure being built.
    blocksRoom: ticket.blocksRoom,
  };
  // Run next step: assertCommandPayloadMatch(
  assertCommandPayloadMatch(
    // Run next step: createPayloadFingerprint(actualKey) === expected,
    createPayloadFingerprint(actualKey) === expected,
  );
  // Return the computed result to the caller.
  return {
    // Set ticket on the structure being built.
    ticket: formatMaintenanceTicket(ticket),
    // Set idempotent on the structure being built.
    idempotent: true,
  };
}
