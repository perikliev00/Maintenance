import { createHash } from "crypto";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { formatMaintenanceTicket, type FormattedMaintenanceTicket } from "./format";
import { ticketInclude } from "./types";

export type LifecycleCommandKind = "start" | "wait" | "resume" | "resolve";

export type LifecycleCommandKey = {
  kind: LifecycleCommandKind;
  ticketId: string;
  actorEmployeeId: string;
  reason?: string | null;
  resolutionNotes?: string | null;
};

export function lifecyclePayloadFingerprint(key: LifecycleCommandKey): string {
  const normalized = {
    kind: key.kind,
    ticketId: key.ticketId,
    actorEmployeeId: key.actorEmployeeId,
    reason: key.reason ?? null,
    resolutionNotes: key.resolutionNotes ?? null,
  };
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

function readLifecycleFingerprint(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const fp = (payload as { _commandFingerprint?: unknown })._commandFingerprint;
  return typeof fp === "string" ? fp : null;
}

async function findTicketByLifecycleCommand(commandId: string) {
  const event = await prisma.ticketEvent.findUnique({
    where: { commandId },
    include: { ticket: { include: ticketInclude } },
  });
  return event;
}

function assertLifecycleCommandMatch(
  event: { ticketId: string; actorEmployeeId: string; payload: unknown },
  key: LifecycleCommandKey,
) {
  const expected = lifecyclePayloadFingerprint(key);
  const actual = readLifecycleFingerprint(event.payload);
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

export async function replayLifecycleCommand(
  commandId: string | undefined,
  key: LifecycleCommandKey,
): Promise<{ ticket: FormattedMaintenanceTicket; idempotent: true } | null> {
  if (!commandId) return null;
  const existing = await findTicketByLifecycleCommand(commandId);
  if (!existing) return null;
  assertLifecycleCommandMatch(existing, key);
  return {
    ticket: formatMaintenanceTicket(existing.ticket),
    idempotent: true,
  };
}
