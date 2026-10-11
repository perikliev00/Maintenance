import {
  completeCleaningQueued as completeCleaningCommand,
  reportTicketQueued as reportTicketCommand,
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
import { postJson } from "./transport";

export type QueuedResult = { queued: boolean; data?: unknown };

function isQueueableError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status === undefined) return true;
  return status >= 500;
}

async function runOrEnqueue(
  type: QueueCommandType,
  url: string,
  body: Record<string, unknown>,
): Promise<QueuedResult> {
  const commandId = String(body.commandId ?? crypto.randomUUID());
  const payload = { ...body, commandId };
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
    const data = await postJson(url, payload);
    return { queued: false, data };
  } catch (err) {
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
    throw err;
  }
}

export async function startCleaningQueued(
  taskId: string,
  expectedVersion?: number,
): Promise<QueuedResult> {
  return startCleaningCommand(taskId, expectedVersion, runOrEnqueue);
}

export async function completeCleaningQueued(
  sessionId: string,
  notes?: string,
  expectedVersion?: number,
): Promise<QueuedResult> {
  return completeCleaningCommand(sessionId, notes, expectedVersion, runOrEnqueue);
}

export async function startTicketQueued(ticketId: string): Promise<QueuedResult> {
  return startTicketCommand(ticketId, runOrEnqueue);
}

export async function waitTicketQueued(
  ticketId: string,
  reason?: string,
): Promise<QueuedResult> {
  return waitTicketCommand(ticketId, reason, runOrEnqueue);
}

export async function resumeTicketQueued(
  ticketId: string,
): Promise<QueuedResult> {
  return resumeTicketCommand(ticketId, runOrEnqueue);
}

export async function resolveTicketQueued(
  ticketId: string,
  resolutionNotes?: string,
): Promise<QueuedResult> {
  return resolveTicketCommand(ticketId, resolutionNotes, runOrEnqueue);
}

export async function reportTicketQueued(input: {
  locationId: string;
  title?: string;
  issueOptionId?: string;
  categoryId?: string;
  priority?: string;
  blocksRoom: boolean;
}): Promise<QueuedResult> {
  return reportTicketCommand(input, runOrEnqueue);
}
