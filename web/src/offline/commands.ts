import { API_BASE } from "../api/http";
import type { QueueCommandType } from "./storage";

export type QueuedResult = { queued: boolean; data?: unknown };

export type RunOrEnqueue = (
  type: QueueCommandType,
  url: string,
  body: Record<string, unknown>,
) => Promise<QueuedResult>;

export function startCleaningQueued(
  taskId: string,
  expectedVersion: number | undefined,
  run: RunOrEnqueue,
): Promise<QueuedResult> {
  return run(
    "cleaning.start",
    `${API_BASE}/cleaning/tasks/${taskId}/start`,
    { commandId: crypto.randomUUID(), expectedVersion },
  );
}

export function completeCleaningQueued(
  sessionId: string,
  notes: string | undefined,
  expectedVersion: number | undefined,
  run: RunOrEnqueue,
): Promise<QueuedResult> {
  return run(
    "cleaning.complete",
    `${API_BASE}/cleaning/sessions/${sessionId}/complete`,
    {
      commandId: crypto.randomUUID(),
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    },
  );
}

export function startTicketQueued(
  ticketId: string,
  run: RunOrEnqueue,
): Promise<QueuedResult> {
  return run(
    "ticket.start",
    `${API_BASE}/maintenance/tickets/${ticketId}/start`,
    { commandId: crypto.randomUUID() },
  );
}

export function waitTicketQueued(
  ticketId: string,
  reason: string | undefined,
  run: RunOrEnqueue,
): Promise<QueuedResult> {
  return run(
    "ticket.wait",
    `${API_BASE}/maintenance/tickets/${ticketId}/wait`,
    {
      commandId: crypto.randomUUID(),
      ...(reason?.trim() ? { reason: reason.trim() } : {}),
    },
  );
}

export function resumeTicketQueued(
  ticketId: string,
  run: RunOrEnqueue,
): Promise<QueuedResult> {
  return run(
    "ticket.resume",
    `${API_BASE}/maintenance/tickets/${ticketId}/resume`,
    { commandId: crypto.randomUUID() },
  );
}

export function resolveTicketQueued(
  ticketId: string,
  resolutionNotes: string | undefined,
  run: RunOrEnqueue,
): Promise<QueuedResult> {
  return run(
    "ticket.resolve",
    `${API_BASE}/maintenance/tickets/${ticketId}/resolve`,
    {
      commandId: crypto.randomUUID(),
      ...(resolutionNotes?.trim()
        ? { resolutionNotes: resolutionNotes.trim() }
        : {}),
    },
  );
}

export function reportTicketQueued(
  input: {
    locationId: string;
    title?: string;
    issueOptionId?: string;
    categoryId?: string;
    priority?: string;
    blocksRoom: boolean;
  },
  run: RunOrEnqueue,
): Promise<QueuedResult> {
  return run("ticket.report", `${API_BASE}/maintenance/tickets`, {
    commandId: crypto.randomUUID(),
    locationId: input.locationId,
    blocksRoom: input.blocksRoom,
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    ...(input.issueOptionId ? { issueOptionId: input.issueOptionId } : {}),
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
  });
}
