/**
 * Idempotent lifecycle/create commands keyed by client commandId.
 * Fingerprints the semantic payload so the same commandId cannot be reused for a
 * different actor/ticket/notes combination (or a different create payload).
 */
import { createHash } from "crypto";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { formatMaintenanceTicket, type FormattedMaintenanceTicket } from "./format";
import { ticketInclude } from "./types";

export type LifecycleCommandKind =
  | "start"
  | "wait"
  | "resume"
  | "resolve"
  | "assign"
  | "close"
  | "reopen";

/** Canonical fields hashed into `_commandFingerprint` on the ticket event payload. */
export type LifecycleCommandKey = {
  kind: LifecycleCommandKind;
  ticketId: string;
  actorEmployeeId: string;
  reason?: string | null;
  resolutionNotes?: string | null;
  /** Present for assign — fingerprint must bind the chosen technician. */
  assigneeId?: string | null;
};

/** Canonical fields for create commandId fingerprinting. */
export type CreateCommandKey = {
  kind: "create";
  locationId: string;
  reportedByEmployeeId: string;
  issueOptionId?: string | null;
  categoryId?: string | null;
  title?: string | null;
  description?: string | null;
  priority?: string | null;
  blocksRoom: boolean;
};

/** Stable hash of the lifecycle command key for conflict detection on replay. */
export function lifecyclePayloadFingerprint(key: LifecycleCommandKey): string {
  // Null-normalize optional fields so undefined vs null hash identically.
  // Keep legacy start/wait/resume/resolve hashes stable — only assign binds assigneeId.
  const normalized =
    key.kind === "assign"
      ? {
          kind: key.kind,
          ticketId: key.ticketId,
          actorEmployeeId: key.actorEmployeeId,
          reason: key.reason ?? null,
          resolutionNotes: key.resolutionNotes ?? null,
          assigneeId: key.assigneeId ?? null,
        }
      : {
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

/** Stable hash of the create command key. */
export function createPayloadFingerprint(key: CreateCommandKey): string {
  const normalized = {
    kind: key.kind,
    locationId: key.locationId,
    reportedByEmployeeId: key.reportedByEmployeeId,
    issueOptionId: key.issueOptionId ?? null,
    categoryId: key.categoryId ?? null,
    title: key.title ?? null,
    description: key.description ?? null,
    priority: key.priority ?? null,
    blocksRoom: key.blocksRoom,
  };
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

/** Read `_commandFingerprint` from a ticket event payload, if present. */
export function readCommandFingerprint(payload: unknown): string | null {
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
  const actual = readCommandFingerprint(event.payload);
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
 * Also rejects commandIds already consumed by a create on MaintenanceTicket.
 */
export async function replayLifecycleCommand(
  commandId: string | undefined,
  key: LifecycleCommandKey,
): Promise<{ ticket: FormattedMaintenanceTicket; eventId: string; idempotent: true } | null> {
  // Online paths without commandId skip idempotency entirely.
  if (!commandId) return null;

  // Create namespace: ticket.commandId occupied by a report → cannot reuse for lifecycle.
  const created = await prisma.maintenanceTicket.findUnique({
    where: { commandId },
    select: { id: true },
  });
  if (created) {
    // Allow replay only when the prior event is a matching lifecycle event (below).
    // If the only use was create (event also has this commandId with create fp),
    // findTicketByLifecycleCommand will find that event and fingerprint-mismatch → 409.
  }

  const existing = await findTicketByLifecycleCommand(commandId);
  // First time seeing this commandId on TicketEvent — caller proceeds (unless create-only).
  if (!existing) {
    // Create used this commandId on the ticket row but somehow no event — still conflict.
    if (created) {
      throw new AppError(
        409,
        "conflict",
        "commandId reused with a different payload",
      );
    }
    return null;
  }
  // Replay: same fingerprint → return prior ticket; mismatch → 409.
  assertLifecycleCommandMatch(existing, key);
  return {
    ticket: formatMaintenanceTicket(existing.ticket),
    eventId: existing.id,
    idempotent: true,
  };
}

/**
 * Assert create replay matches fingerprint; throw conflict on mismatch.
 * Returns formatted ticket when the prior create event matches.
 */
export async function replayCreateCommand(
  commandId: string | undefined,
  key: CreateCommandKey,
): Promise<{ ticket: FormattedMaintenanceTicket; idempotent: true } | null> {
  if (!commandId) return null;

  // Lifecycle (or other) event already owns this commandId.
  const event = await prisma.ticketEvent.findUnique({
    where: { commandId },
    include: { ticket: { include: ticketInclude } },
  });
  if (event) {
    const expected = createPayloadFingerprint(key);
    const actual = readCommandFingerprint(event.payload);
    if (actual !== expected) {
      throw new AppError(
        409,
        "conflict",
        "commandId reused with a different payload",
      );
    }
    return {
      ticket: formatMaintenanceTicket(event.ticket),
      idempotent: true,
    };
  }

  // Ticket row may exist without event in legacy data — fingerprint via ticket fields.
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { commandId },
    include: ticketInclude,
  });
  if (!ticket) return null;

  const expected = createPayloadFingerprint(key);
  // Option path snapshotted category id on the row — fingerprint used null categoryId.
  const actualKey: CreateCommandKey = {
    kind: "create",
    locationId: ticket.locationId,
    reportedByEmployeeId: ticket.reportedByEmployeeId ?? "",
    issueOptionId: ticket.issueOptionId,
    categoryId: ticket.issueOptionId ? null : ticket.maintenanceCategoryId,
    title: ticket.title,
    priority: ticket.priority,
    blocksRoom: ticket.blocksRoom,
  };
  if (createPayloadFingerprint(actualKey) !== expected) {
    throw new AppError(
      409,
      "conflict",
      "commandId reused with a different payload",
    );
  }
  return {
    ticket: formatMaintenanceTicket(ticket),
    idempotent: true,
  };
}
