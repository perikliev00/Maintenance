/**
 * Derive My Work pendingSync markers from the active user's outbox queue.
 */
import {
  // Support the surrounding logic for this step.
  entityIdFromQueued,
  // Support the surrounding logic for this step.
  listQueuedActions,
  // Declare type alias QueuedAction.
  type QueuedAction,
// Support the surrounding logic for this step.
} from "../../offline";

// Create a Set/Map for efficient membership or keyed lookup.
const CLEANING_PENDING_TYPES = new Set([
  // Support the surrounding logic for this step.
  "cleaning.start",
  // Support the surrounding logic for this step.
  "cleaning.complete",
// Support the surrounding logic for this step.
]);

/** Task ids with a pending/sending cleaning mutation still in the outbox. */
export function taskIdsFromQueuedActions(rows: QueuedAction[]): string[] {
  // Create a Set/Map for efficient membership or keyed lookup.
  const ids = new Set<string>();
  // Iterate a collection or counted range.
  for (const row of rows) {
    // Conditional branch for the case described by this guard.
    if (!CLEANING_PENDING_TYPES.has(row.type)) continue;
    // Conditional branch for the case described by this guard.
    if (row.status !== "pending" && row.status !== "sending") continue;
    // Bind entityId for use in the following logic.
    const entityId = entityIdFromQueued(row.type, row.url, row.body);
    // Conditional branch for the case described by this guard.
    if (entityId) ids.add(entityId);
  }
  // Return early result or rendered output from this path.
  return [...ids];
}

/** Read current outbox and return cleaning task ids still awaiting sync. */
export async function listPendingSyncTaskIdsFromOutbox(): Promise<string[]> {
  // Bind rows for use in the following logic.
  const rows = await listQueuedActions(["pending", "sending"]);
  // Return early result or rendered output from this path.
  return taskIdsFromQueuedActions(rows);
}
