/**
 * Idempotent lifecycle commands (start/wait/resume/resolve) keyed by client commandId.
 * Fingerprints the semantic payload so the same commandId cannot be reused for a
 * different actor/ticket/notes combination.
 */
import { createHash } from "crypto";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { formatMaintenanceTicket, type FormattedMaintenanceTicket } from "./format";
import { ticketInclude } from "./types";

export type LifecycleCommandKind = "start" | "wait" | "resume" | "resolve";

/** Canonical fields hashed into `_commandFingerprint` on the ticket event payload. */
export type LifecycleCommandKey = {
  kind: LifecycleCommandKind;
  ticketId: string;
  actorEmployeeId: string;
  reason?: string | null;
  resolutionNotes?: string | null;
};

/** Stable hash of the lifecycle command key for conflict detection on replay. */
export function lifecyclePayloadFingerprint(key: LifecycleCommandKey): string {
  // Null-normalize optional fields so undefined vs null hash identically.
  const normalized = {
    kind: key.kind,
    ticketId: key.ticketId,
    actorEmployeeId: key.actorEmployeeId,
    reason: key.reason ?? null,
    resolutionNotes: key.resolutionNotes ?? null,
  };
  // SHA-256 hex of the canonical JSON — stored as `_commandFingerprint`.
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

/** Read `_commandFingerprint` from a ticket event payload, if present. */
function readLifecycleFingerprint(payload: unknown): string | null {
  // Non-objects / arrays cannot carry a fingerprint field.
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
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
    where: { commandId },
    include: { ticket: { include: ticketInclude } },
  });
  return event;
}

/** 409 when commandId is reused for a different ticket/actor/payload. */
function assertLifecycleCommandMatch(
  event: { ticketId: string; actorEmployeeId: string; payload: unknown },
  key: LifecycleCommandKey,
) {
  // Expected fingerprint from the new request's semantic key.
  const expected = lifecyclePayloadFingerprint(key);
  // Fingerprint stored on the prior event payload (may be missing on legacy rows).
  const actual = readLifecycleFingerprint(event.payload);
  // Mismatch on fingerprint, ticket, or actor → treat as commandId collision.
  if (
    actual !== expected ||
    event.ticketId !== key.ticketId ||
    event.actorEmployeeId !== key.actorEmployeeId
  ) {
    throw new AppError(
      409,
      "conflict",
      "commandId reused with a different payload",
    );
  }
}

/**
 * If this commandId already produced a ticket event, return that ticket (idempotent
 * success) or 409 when the fingerprint/actor/ticket do not match the new request.
 */
export async function replayLifecycleCommand(
  commandId: string | undefined,
  key: LifecycleCommandKey,
): Promise<{ ticket: FormattedMaintenanceTicket; idempotent: true } | null> {
  // Online paths without commandId skip idempotency entirely.
  if (!commandId) return null;
  const existing = await findTicketByLifecycleCommand(commandId);
  // First time seeing this commandId — caller proceeds with the mutation.
  if (!existing) return null;
  // Replay: same fingerprint → return prior ticket; mismatch → 409.
  assertLifecycleCommandMatch(existing, key);
  return {
    ticket: formatMaintenanceTicket(existing.ticket),
    idempotent: true,
  };
}
