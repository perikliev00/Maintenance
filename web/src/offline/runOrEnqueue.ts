/**
 * Try a mutation online; on offline / unreachable / 5xx, enqueue instead.
 *
 * 4xx (except network-mapped undefined status) propagate so the UI can show
 * validation errors immediately rather than hiding them in the outbox.
 */
import {
  assignTicketQueued as assignTicketCommand,
  closeTicketQueued as closeTicketCommand,
  completeCleaningQueued as completeCleaningCommand,
  reportTicketQueued as reportTicketCommand,
  reopenTicketQueued as reopenTicketCommand,
  resolveTicketQueued as resolveTicketCommand,
  resumeTicketQueued as resumeTicketCommand,
  startCleaningQueued as startCleaningCommand,
  startTicketQueued as startTicketCommand,
  waitTicketQueued as waitTicketCommand,
} from "./commands";
import {
  isApiUnreachable,
  markUnreachable,
  scheduleBackoff,
} from "./connState";
import { enqueue } from "./queueOps";
import type { QueueCommandType } from "./storage";
import { authHeader, postJsonWithSessionRefresh } from "./transport";
import { getOfflineBindingRevision, getOfflineUser, isOfflineSwitching } from "./userScope";

/** `queued: true` means the action is in IndexedDB; else `data` is the live response. */
export type QueuedResult = { queued: boolean; data?: unknown };

/** Network/timeouts and 5xx are safe to defer; client/auth errors are not. */
function isQueueableError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  // No status → treat as transport failure (safe to queue).
  if (status === undefined) return true;
  // Only 5xx; 4xx must surface to the UI immediately.
  return status >= 500;
}

/**
 * Shared online-or-enqueue path for cleaning/ticket POSTs.
 * Ensures every body carries a stable `commandId` for idempotent sync push.
 */
async function runOrEnqueue(
  type: QueueCommandType,
  url: string,
  body: Record<string, unknown>,
): Promise<QueuedResult> {
  const userId = getOfflineUser();
  const revision = getOfflineBindingRevision();
  const beforeAttempt = () => {
    if (!userId || isOfflineSwitching() || getOfflineUser() !== userId || getOfflineBindingRevision() !== revision) {
      throw Object.assign(new Error("Account changed; retry the action from the current account"), { status: 409, code: "identity_changed" });
    }
  };
  beforeAttempt();
  // Stable idempotency key — reuse caller-supplied id when present.
  const commandId = String(body.commandId ?? crypto.randomUUID());
  const payload = { ...body, commandId };
  // Already offline / marked unreachable — skip the round-trip and enqueue.
  if (!navigator.onLine || isApiUnreachable()) {
    await enqueue({
      commandId,
      type,
      url,
      method: "POST",
      body: payload,
    });
    return { queued: true };
  }
  try {
    const data = await postJsonWithSessionRefresh(url, payload, {
      beforeAttempt,
      headersFn: () => {
        const headers = new Headers(authHeader());
        headers.set("X-Offline-User", userId!);
        return headers;
      },
    });
    beforeAttempt();
    return { queued: false, data };
  } catch (err) {
    // Do not turn an old account's failed request into the new account's outbox.
    beforeAttempt();
    // Transient failure → mark unreachable, backoff, and park in IndexedDB.
    if (isQueueableError(err)) {
      markUnreachable();
      scheduleBackoff();
      await enqueue({
        commandId,
        type,
        url,
        method: "POST",
        body: payload,
      });
      return { queued: true };
    }
    // Validation / auth / conflict — let the caller show the error.
    throw err;
  }
}

/** Start a cleaning task (online or queued). Optional optimistic concurrency token. */
export async function startCleaningQueued(
  taskId: string,
  expectedVersion?: number,
): Promise<QueuedResult> {
  return startCleaningCommand(taskId, expectedVersion, runOrEnqueue);
}

/** Complete an active cleaning session (online or queued). */
export async function completeCleaningQueued(
  sessionId: string,
  notes?: string,
  expectedVersion?: number,
  taskId?: string,
): Promise<QueuedResult> {
  return completeCleaningCommand(
    sessionId,
    notes,
    expectedVersion,
    runOrEnqueue,
    taskId,
  );
}

/** Move a ticket into in-progress (online or queued). */
export async function startTicketQueued(ticketId: string): Promise<QueuedResult> {
  return startTicketCommand(ticketId, runOrEnqueue);
}

/** Pause a ticket into waiting (online or queued); optional reason. */
export async function waitTicketQueued(
  ticketId: string,
  reason?: string,
): Promise<QueuedResult> {
  return waitTicketCommand(ticketId, reason, runOrEnqueue);
}

/** Resume a waiting ticket (online or queued). */
export async function resumeTicketQueued(
  ticketId: string,
): Promise<QueuedResult> {
  return resumeTicketCommand(ticketId, runOrEnqueue);
}

/** Resolve a ticket with optional notes (online or queued). */
export async function resolveTicketQueued(
  ticketId: string,
  resolutionNotes?: string,
): Promise<QueuedResult> {
  return resolveTicketCommand(ticketId, resolutionNotes, runOrEnqueue);
}

/** Report a new maintenance ticket from a location (online or queued). */
export async function reportTicketQueued(input: {
  locationId: string;
  title?: string;
  description?: string;
  issueOptionId?: string;
  categoryId?: string;
  priority?: string;
  blocksRoom: boolean;
}): Promise<QueuedResult> {
  return reportTicketCommand(input, runOrEnqueue);
}

/** Assign / reassign a ticket (online or queued). */
export async function assignTicketQueued(
  ticketId: string,
  assigneeId: string,
): Promise<QueuedResult> {
  return assignTicketCommand(ticketId, assigneeId, runOrEnqueue);
}

/** Close a resolved ticket (online or queued). */
export async function closeTicketQueued(ticketId: string): Promise<QueuedResult> {
  return closeTicketCommand(ticketId, runOrEnqueue);
}

/** Reopen a resolved/closed ticket (online or queued). */
export async function reopenTicketQueued(
  ticketId: string,
  reason?: string,
): Promise<QueuedResult> {
  return reopenTicketCommand(ticketId, reason, runOrEnqueue);
}
