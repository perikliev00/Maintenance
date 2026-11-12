/**
 * Pure command builders: map domain ops to queue type + URL + body.
 * Inject `run` (usually `runOrEnqueue`) so unit tests can assert payloads
 * without hitting the network or IndexedDB.
 */
import { API_BASE } from "../api/http";
// Import dependency used by this module.
import type { QueueCommandType } from "./storage";

// Export type alias for consumers.
export type QueuedResult = { queued: boolean; data?: unknown };

// Export type alias for consumers.
export type RunOrEnqueue = (
  // Field/property in this shape.
  type: QueueCommandType,
  // Field/property in this shape.
  url: string,
  // Field/property in this shape.
  body: Record<string, unknown>,
// Arrow function / callback body.
) => Promise<QueuedResult>;

/** Build cleaning.start command payload and hand off to `run`. */
export function startCleaningQueued(
  // Field/property in this shape.
  taskId: string,
  // Field/property in this shape.
  expectedVersion: number | undefined,
  // Field/property in this shape.
  run: RunOrEnqueue,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return run(
    // Continue multi-line list/arguments.
    "cleaning.start",
    // Continue multi-line list/arguments.
    `${API_BASE}/cleaning/tasks/${taskId}/start`,
    // Invoke helper or pass arguments.
    { commandId: crypto.randomUUID(), expectedVersion },
  );
}

/** Build cleaning.complete payload (trim notes; optional optimistic version). */
export function completeCleaningQueued(
  // Field/property in this shape.
  sessionId: string,
  // Field/property in this shape.
  notes: string | undefined,
  // Field/property in this shape.
  expectedVersion: number | undefined,
  // Field/property in this shape.
  run: RunOrEnqueue,
  // Field/property in this shape.
  taskId?: string,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return run(
    // Continue multi-line list/arguments.
    "cleaning.complete",
    // Continue multi-line list/arguments.
    `${API_BASE}/cleaning/sessions/${sessionId}/complete`,
    {
      // Field/property in this shape.
      commandId: crypto.randomUUID(),
      // taskId is for outbox→pendingSync mapping; API ignores unknown fields.
      ...(taskId ? { taskId } : {}),
      // Spread remaining fields/props.
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
      // Spread remaining fields/props.
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    },
  );
}

/** Build ticket.start command. */
export function startTicketQueued(
  // Field/property in this shape.
  ticketId: string,
  // Field/property in this shape.
  run: RunOrEnqueue,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return run(
    // Continue multi-line list/arguments.
    "ticket.start",
    // Continue multi-line list/arguments.
    `${API_BASE}/maintenance/tickets/${ticketId}/start`,
    // Invoke helper or pass arguments.
    { commandId: crypto.randomUUID() },
  );
}

/** Build ticket.wait command; omit empty reason. */
export function waitTicketQueued(
  // Field/property in this shape.
  ticketId: string,
  // Field/property in this shape.
  reason: string | undefined,
  // Field/property in this shape.
  run: RunOrEnqueue,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return run(
    // Continue multi-line list/arguments.
    "ticket.wait",
    // Continue multi-line list/arguments.
    `${API_BASE}/maintenance/tickets/${ticketId}/wait`,
    {
      // Field/property in this shape.
      commandId: crypto.randomUUID(),
      // Spread remaining fields/props.
      ...(reason?.trim() ? { reason: reason.trim() } : {}),
    },
  );
}

/** Build ticket.resume command. */
export function resumeTicketQueued(
  // Field/property in this shape.
  ticketId: string,
  // Field/property in this shape.
  run: RunOrEnqueue,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return run(
    // Continue multi-line list/arguments.
    "ticket.resume",
    // Continue multi-line list/arguments.
    `${API_BASE}/maintenance/tickets/${ticketId}/resume`,
    // Invoke helper or pass arguments.
    { commandId: crypto.randomUUID() },
  );
}

/** Build ticket.resolve command; omit empty resolution notes. */
export function resolveTicketQueued(
  // Field/property in this shape.
  ticketId: string,
  // Field/property in this shape.
  resolutionNotes: string | undefined,
  // Field/property in this shape.
  run: RunOrEnqueue,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return run(
    // Continue multi-line list/arguments.
    "ticket.resolve",
    // Continue multi-line list/arguments.
    `${API_BASE}/maintenance/tickets/${ticketId}/resolve`,
    {
      // Field/property in this shape.
      commandId: crypto.randomUUID(),
      // Spread remaining fields/props.
      ...(resolutionNotes?.trim()
        // Invoke helper or pass arguments.
        ? { resolutionNotes: resolutionNotes.trim() }
        // Continue multi-line list/arguments.
        : {}),
    },
  );
}

/** Build ticket.report create payload from the issue dialog fields. */
export function reportTicketQueued(
  // Field/property in this shape.
  input: {
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
    blocksRoom?: boolean;
    // Field/property in this shape.
    allowDuplicate?: boolean;
    // Field/property in this shape.
    duplicateOverrideReason?: string;
    // Field/property in this shape.
    confirmSimilar?: boolean;
  },
  // Field/property in this shape.
  run: RunOrEnqueue,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Only include optional fields when present so the body stays minimal.
  return run("ticket.report", `${API_BASE}/maintenance/tickets`, {
    // Field/property in this shape.
    commandId: crypto.randomUUID(),
    // Field/property in this shape.
    locationId: input.locationId,
    // Spread remaining fields/props.
    ...(input.blocksRoom !== undefined ? { blocksRoom: input.blocksRoom } : {}),
    // Spread remaining fields/props.
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    // Spread remaining fields/props.
    ...(input.description?.trim()
      // Invoke helper or pass arguments.
      ? { description: input.description.trim() }
      // Continue multi-line list/arguments.
      : {}),
    // Spread remaining fields/props.
    ...(input.issueOptionId ? { issueOptionId: input.issueOptionId } : {}),
    // Spread remaining fields/props.
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    // Spread remaining fields/props.
    ...(input.priority ? { priority: input.priority } : {}),
    // Spread remaining fields/props.
    ...(input.allowDuplicate ? { allowDuplicate: true } : {}),
    // Spread remaining fields/props.
    ...(input.duplicateOverrideReason?.trim()
      // Invoke helper or pass arguments.
      ? { duplicateOverrideReason: input.duplicateOverrideReason.trim() }
      // Continue multi-line list/arguments.
      : {}),
    // Spread remaining fields/props.
    ...(input.confirmSimilar ? { confirmSimilar: true } : {}),
  });
}

/** Build ticket.assign command. */
export function assignTicketQueued(
  // Field/property in this shape.
  ticketId: string,
  // Field/property in this shape.
  assigneeId: string,
  // Field/property in this shape.
  run: RunOrEnqueue,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return run(
    // Continue multi-line list/arguments.
    "ticket.assign",
    // Continue multi-line list/arguments.
    `${API_BASE}/maintenance/tickets/${ticketId}/assign`,
    // Invoke helper or pass arguments.
    { commandId: crypto.randomUUID(), assigneeId },
  );
}

/** Build ticket.close command. */
export function closeTicketQueued(
  // Field/property in this shape.
  ticketId: string,
  // Field/property in this shape.
  run: RunOrEnqueue,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return run(
    // Continue multi-line list/arguments.
    "ticket.close",
    // Continue multi-line list/arguments.
    `${API_BASE}/maintenance/tickets/${ticketId}/close`,
    // Invoke helper or pass arguments.
    { commandId: crypto.randomUUID() },
  );
}

/** Build ticket.reopen command; omit empty reason. */
export function reopenTicketQueued(
  // Field/property in this shape.
  ticketId: string,
  // Field/property in this shape.
  reason: string | undefined,
  // Field/property in this shape.
  run: RunOrEnqueue,
// Open multi-line construct.
): Promise<QueuedResult> {
  // Return computed result to caller.
  return run(
    // Continue multi-line list/arguments.
    "ticket.reopen",
    // Continue multi-line list/arguments.
    `${API_BASE}/maintenance/tickets/${ticketId}/reopen`,
    {
      // Field/property in this shape.
      commandId: crypto.randomUUID(),
      // Spread remaining fields/props.
      ...(reason?.trim() ? { reason: reason.trim() } : {}),
    },
  );
}
