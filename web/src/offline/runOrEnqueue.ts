/**
 * Try a mutation online; on offline / unreachable / 5xx, enqueue instead.
 *
 * 4xx (except network-mapped undefined status) propagate so the UI can show
 * validation errors immediately rather than hiding them in the outbox.
 */
import {
  // Continue multi-line list/arguments.
  assignTicketQueued as assignTicketCommand,
  // Continue multi-line list/arguments.
  closeTicketQueued as closeTicketCommand,
  // Continue multi-line list/arguments.
  completeCleaningQueued as completeCleaningCommand,
  // Continue multi-line list/arguments.
  reportTicketQueued as reportTicketCommand,
  // Continue multi-line list/arguments.
  reopenTicketQueued as reopenTicketCommand,
  // Continue multi-line list/arguments.
  resolveTicketQueued as resolveTicketCommand,
  // Continue multi-line list/arguments.
  resumeTicketQueued as resumeTicketCommand,
  // Continue multi-line list/arguments.
  startCleaningQueued as startCleaningCommand,
  // Continue multi-line list/arguments.
  startTicketQueued as startTicketCommand,
  // Continue multi-line list/arguments.
  waitTicketQueued as waitTicketCommand,
// Close multi-line construct with trailing syntax.
} from "./commands";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  isApiUnreachable,
  // List item in import/export/params.
  markUnreachable,
  // List item in import/export/params.
  scheduleBackoff,
// Close multi-line construct with trailing syntax.
} from "./connState";
// Import dependency used by this module.
import { enqueue } from "./queueOps";
// Import dependency used by this module.
import type { QueueCommandType } from "./storage";
// Import dependency used by this module.
import { authHeader, postJsonWithSessionRefresh } from "./transport";
// Import dependency used by this module.
import { getOfflineBindingRevision, getOfflineUser, isOfflineSwitching } from "./userScope";

/** `queued: true` means the action is in IndexedDB; else `data` is the live response. */
export type QueuedResult = { queued: boolean; data?: unknown };

/** Network/timeouts and 5xx are safe to defer; client/auth errors are not. */
function isQueueableError(err: unknown): boolean {
  // Const arrow/function binding.
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
  // Field/property in this shape.
  type: QueueCommandType,
  // Field/property in this shape.
  url: string,
  // Field/property in this shape.
  body: Record<string, unknown>,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Local constant binding.
  const userId = getOfflineUser();
  // Local constant binding.
  const revision = getOfflineBindingRevision();
  // Const arrow/function binding.
  const beforeAttempt = () => {
    // Conditional branch for this case.
    if (!userId || isOfflineSwitching() || getOfflineUser() !== userId || getOfflineBindingRevision() !== revision) {
      // Abort with an error for the caller.
      throw Object.assign(new Error("Account changed; retry the action from the current account"), { status: 409, code: "identity_changed" });
    }
  };
  // Invoke helper or pass arguments.
  beforeAttempt();
  // Stable idempotency key — reuse caller-supplied id when present.
  const commandId = String(body.commandId ?? crypto.randomUUID());
  // Local constant binding.
  const payload = { ...body, commandId };
  // Already offline / marked unreachable — skip the round-trip and enqueue.
  if (!navigator.onLine || isApiUnreachable()) {
    // Await async work before continuing.
    await enqueue({
      // List item in import/export/params.
      commandId,
      // List item in import/export/params.
      type,
      // List item in import/export/params.
      url,
      // Field/property in this shape.
      method: "POST",
      // Field/property in this shape.
      body: payload,
    });
    // Return computed result to caller.
    return { queued: true };
  }
  // Guard fallible work.
  try {
    // Local constant binding.
    const data = await postJsonWithSessionRefresh(url, payload, {
      // List item in import/export/params.
      beforeAttempt,
      // Arrow function / callback body.
      headersFn: () => {
        // Local constant binding.
        const headers = new Headers(authHeader());
        // Invoke helper or pass arguments.
        headers.set("X-Offline-User", userId!);
        // Return computed result to caller.
        return headers;
      },
    });
    // Invoke helper or pass arguments.
    beforeAttempt();
    // Return computed result to caller.
    return { queued: false, data };
  // Invoke helper or pass arguments.
  } catch (err) {
    // Do not turn an old account's failed request into the new account's outbox.
    beforeAttempt();
    // Transient failure → mark unreachable, backoff, and park in IndexedDB.
    if (isQueueableError(err)) {
      // Invoke helper or pass arguments.
      markUnreachable();
      // Invoke helper or pass arguments.
      scheduleBackoff();
      // Await async work before continuing.
      await enqueue({
        // List item in import/export/params.
        commandId,
        // List item in import/export/params.
        type,
        // List item in import/export/params.
        url,
        // Field/property in this shape.
        method: "POST",
        // Field/property in this shape.
        body: payload,
      });
      // Return computed result to caller.
      return { queued: true };
    }
    // Validation / auth / conflict — let the caller show the error.
    throw err;
  }
}

/** Start a cleaning task (online or queued). Optional optimistic concurrency token. */
export async function startCleaningQueued(
  // Field/property in this shape.
  taskId: string,
  // Field/property in this shape.
  expectedVersion?: number,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return startCleaningCommand(taskId, expectedVersion, runOrEnqueue);
}

/** Complete an active cleaning session (online or queued). */
export async function completeCleaningQueued(
  // Field/property in this shape.
  sessionId: string,
  // Field/property in this shape.
  notes?: string,
  // Field/property in this shape.
  expectedVersion?: number,
  // Field/property in this shape.
  taskId?: string,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return completeCleaningCommand(
    // List item in import/export/params.
    sessionId,
    // List item in import/export/params.
    notes,
    // List item in import/export/params.
    expectedVersion,
    // List item in import/export/params.
    runOrEnqueue,
    // List item in import/export/params.
    taskId,
  );
}

/** Move a ticket into in-progress (online or queued). */
export async function startTicketQueued(ticketId: string): Promise<QueuedResult> {
  // Return computed result to caller.
  return startTicketCommand(ticketId, runOrEnqueue);
}

/** Pause a ticket into waiting (online or queued); optional reason. */
export async function waitTicketQueued(
  // Field/property in this shape.
  ticketId: string,
  // Field/property in this shape.
  reason?: string,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return waitTicketCommand(ticketId, reason, runOrEnqueue);
}

/** Resume a waiting ticket (online or queued). */
export async function resumeTicketQueued(
  // Field/property in this shape.
  ticketId: string,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return resumeTicketCommand(ticketId, runOrEnqueue);
}

/** Resolve a ticket with optional notes (online or queued). */
export async function resolveTicketQueued(
  // Field/property in this shape.
  ticketId: string,
  // Field/property in this shape.
  resolutionNotes?: string,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return resolveTicketCommand(ticketId, resolutionNotes, runOrEnqueue);
}

/** Report a new maintenance ticket from a location (online or queued). */
export async function reportTicketQueued(input: {
  // Field/property in this shape.
  locationId: string;
  // Field/property in this shape.
  title?: string;
  // Field/property in this shape.
  description?: string;
  // Field/property in this shape.
  issueOptionId?: string;
  // Field/property in this shape.
  categoryId?: string;
  // Field/property in this shape.
  priority?: string;
  // Field/property in this shape.
  blocksRoom: boolean;
// Open multi-line construct.
}): Promise<QueuedResult> {
  // Return computed result to caller.
  return reportTicketCommand(input, runOrEnqueue);
}

/** Assign / reassign a ticket (online or queued). */
export async function assignTicketQueued(
  // Field/property in this shape.
  ticketId: string,
  // Field/property in this shape.
  assigneeId: string,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return assignTicketCommand(ticketId, assigneeId, runOrEnqueue);
}

/** Close a resolved ticket (online or queued). */
export async function closeTicketQueued(ticketId: string): Promise<QueuedResult> {
  // Return computed result to caller.
  return closeTicketCommand(ticketId, runOrEnqueue);
}

/** Reopen a resolved/closed ticket (online or queued). */
export async function reopenTicketQueued(
  // Field/property in this shape.
  ticketId: string,
  // Field/property in this shape.
  reason?: string,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return reopenTicketCommand(ticketId, reason, runOrEnqueue);
}
