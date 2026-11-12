/**
 * Derive My Work pendingSync markers from the active user's outbox queue.
 */
import {
  entityIdFromQueued,
  listQueuedActions,
  type QueuedAction,
} from "../../offline";

const CLEANING_PENDING_TYPES = new Set([
  "cleaning.start",
  "cleaning.complete",
]);

/** Task ids with a pending/sending cleaning mutation still in the outbox. */
export function taskIdsFromQueuedActions(rows: QueuedAction[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!CLEANING_PENDING_TYPES.has(row.type)) continue;
    if (row.status !== "pending" && row.status !== "sending") continue;
    const entityId = entityIdFromQueued(row.type, row.url, row.body);
    if (entityId) ids.add(entityId);
  }
  return [...ids];
}

/** Read current outbox and return cleaning task ids still awaiting sync. */
export async function listPendingSyncTaskIdsFromOutbox(): Promise<string[]> {
  const rows = await listQueuedActions(["pending", "sending"]);
  return taskIdsFromQueuedActions(rows);
}
