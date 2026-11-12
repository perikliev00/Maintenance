/**
 * Outbox CRUD and My Work cache access scoped to the active offline user.
 *
 * Enqueue / retry / rebase refuse to run while `isOfflineSwitching` so a logout
 * or A→B account switch cannot interleave writes with another user's rows.
 */
import {
  // List item in import/export/params.
  canRebaseConflict,
  // List item in import/export/params.
  rebaseBodyWithCurrentVersion,
// Close multi-line construct with trailing syntax.
} from "./conflict";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  isApiUnreachable,
  // List item in import/export/params.
  notify,
  // List item in import/export/params.
  triggerDrain,
  // Local type alias shaping data.
  type QueueStats,
// Close multi-line construct with trailing syntax.
} from "./connState";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  deleteQueuedAction,
  // List item in import/export/params.
  compareQueuedActions,
  // List item in import/export/params.
  listQueueForUser,
  // List item in import/export/params.
  putQueuedAction,
  // List item in import/export/params.
  readMyWorkCache,
  // List item in import/export/params.
  writeMyWorkCache,
  // Local type alias shaping data.
  type MyWorkCachePayload,
  // Local type alias shaping data.
  type QueueActionStatus,
  // Local type alias shaping data.
  type QueuedAction,
// Close multi-line construct with trailing syntax.
} from "./storage";
// Import dependency used by this module.
import { getOfflineUser, isOfflineSwitching } from "./userScope";

/** Zeroed banner counters used when there is no bound user / mid-switch. */
function emptyStats(): QueueStats {
  // Return computed result to caller.
  return { pending: 0, sending: 0, conflict: 0, failed: 0 };
}

/** Aggregate outbox rows into banner status counts. */
function statsFromRows(rows: QueuedAction[]): QueueStats {
  // Return computed result to caller.
  return {
    // Arrow function / callback body.
    pending: rows.filter((r) => r.status === "pending").length,
    // Arrow function / callback body.
    sending: rows.filter((r) => r.status === "sending").length,
    // Arrow function / callback body.
    conflict: rows.filter((r) => r.status === "conflict").length,
    // Arrow function / callback body.
    failed: rows.filter((r) => r.status === "failed").length,
  };
}

/** Counts by status for the connection banner; empty while switching users. */
export async function getQueueStats(): Promise<QueueStats> {
  // Avoid leaking another user's counts during logout / account switch.
  if (isOfflineSwitching() || !getOfflineUser()) return emptyStats();
  // Guard fallible work.
  try {
    // Local constant binding.
    const rows = await listQueueForUser(getOfflineUser()!);
    // Return computed result to caller.
    return statsFromRows(rows);
  // Open multi-line construct.
  } catch {
    // IndexedDB unavailable (Node unit tests) or transient IDB failure.
    return emptyStats();
  }
}

/** Outbox rows for the active user, oldest first (drain order). */
export async function listQueuedActions(
  // Field/property in this shape.
  statuses?: QueueActionStatus[],
// Open multi-line construct.
): Promise<QueuedAction[]> {
  // Conditional branch for this case.
  if (isOfflineSwitching() || !getOfflineUser()) return [];
  // Local constant binding.
  const rows = await listQueueForUser(getOfflineUser()!);
  // Optional status filter (e.g. conflict-only for the issues panel).
  const filtered = statuses
    // Arrow function / callback body.
    ? rows.filter((r) => statuses.includes(r.status))
    // Continue module logic.
    : rows;
  // Oldest first so drain / UI match FIFO order.
  return filtered.sort(compareQueuedActions);
}

/**
 * Persist a pending mutation and nudge the drain loop when the browser is online.
 * Throws if there is no bound user (avoids orphaned unscoped queue rows).
 */
export async function enqueue(
  // Field/property in this shape.
  action: Omit<
    // List item in import/export/params.
    QueuedAction,
    // Union/intersection type member.
    | "id"
    // Union/intersection type member.
    | "userId"
    // Union/intersection type member.
    | "createdAt"
    // Union/intersection type member.
    | "updatedAt"
    // Union/intersection type member.
    | "status"
    // Union/intersection type member.
    | "lastError"
    // Union/intersection type member.
    | "conflictCode"
    // Union/intersection type member.
    | "conflictMessage"
    // Union/intersection type member.
    | "conflictDetails"
    // Union/intersection type member.
    | "retries"
  // Continue multi-line list/arguments.
  > & { id?: string },
// Open multi-line construct.
): Promise<QueuedAction> {
  // Local constant binding.
  const activeUserId = getOfflineUser();
  // Refuse orphaned rows — every outbox entry must be user-scoped.
  if (isOfflineSwitching() || !activeUserId) {
    // Abort with an error for the caller.
    throw new Error("Cannot enqueue offline action without an active user");
  }
  // Local constant binding.
  const now = Date.now();
  // Local constant binding.
  const row: QueuedAction = {
    // Field/property in this shape.
    id: action.id ?? crypto.randomUUID(),
    // Field/property in this shape.
    userId: activeUserId,
    // Field/property in this shape.
    commandId: action.commandId,
    // Field/property in this shape.
    type: action.type,
    // Field/property in this shape.
    url: action.url,
    // Field/property in this shape.
    method: action.method,
    // Field/property in this shape.
    body: action.body,
    // Field/property in this shape.
    createdAt: now,
    // Field/property in this shape.
    updatedAt: now,
    // Field/property in this shape.
    status: "pending",
    // Field/property in this shape.
    lastError: null,
    // Field/property in this shape.
    conflictCode: null,
    // Field/property in this shape.
    conflictMessage: null,
    // Field/property in this shape.
    conflictDetails: null,
    // Field/property in this shape.
    retries: 0,
  };
  // Await async work before continuing.
  await putQueuedAction(row);
  // Banner mode reflects why we queued (offline vs unreachable vs syncing).
  notify(
    // Continue module logic.
    !navigator.onLine
      // Continue module logic.
      ? "offline"
      // Invoke helper or pass arguments.
      : isApiUnreachable()
        // Continue module logic.
        ? "unreachable"
        // Continue multi-line list/arguments.
        : "syncing",
  );
  // Kick drain immediately when the browser already thinks it is online.
  if (navigator.onLine) triggerDrain();
  // Return computed result to caller.
  return row;
}

/** Snapshot My Work lists for offline display (keyed by active user). */
export async function saveMyWorkCache(
  // Field/property in this shape.
  payload: MyWorkCachePayload,
// Open multi-line construct.
): Promise<void> {
  // Conditional branch for this case.
  if (isOfflineSwitching() || !getOfflineUser()) return;
  // Await async work before continuing.
  await writeMyWorkCache(getOfflineUser()!, payload);
}

/**
 * Load My Work cache; re-checks user identity after the async read so a
 * mid-flight account switch cannot return another user's snapshot.
 */
export async function loadMyWorkCache(): Promise<MyWorkCachePayload | null> {
  // Conditional branch for this case.
  if (isOfflineSwitching() || !getOfflineUser()) return null;
  // Local constant binding.
  const userId = getOfflineUser()!;
  // Local constant binding.
  const row = await readMyWorkCache(userId);
  // Identity may have changed while IDB was reading — discard stale snapshot.
  if (isOfflineSwitching() || getOfflineUser() !== userId) return null;
  // Return computed result to caller.
  return row;
}

/**
 * Blind retry (same payload). Prefer `resolveQueuedAction({ mode: "rebase" })`
 * for version_conflict so expectedVersion is advanced.
 */
export async function retryQueuedAction(id: string): Promise<void> {
  // Conditional branch for this case.
  if (isOfflineSwitching() || !getOfflineUser()) return;
  // Local constant binding.
  const rows = await listQueueForUser(getOfflineUser()!);
  // Local constant binding.
  const item = rows.find((r) => r.id === id);
  // Conditional branch for this case.
  if (!item) return;
  // Only conflict/failed rows are eligible for manual retry.
  if (item.status !== "conflict" && item.status !== "failed") return;
  // Reset to pending with cleared conflict fields and retry counter.
  await putQueuedAction({
    // Spread remaining fields/props.
    ...item,
    // Field/property in this shape.
    status: "pending",
    // Field/property in this shape.
    lastError: null,
    // Field/property in this shape.
    conflictCode: null,
    // Field/property in this shape.
    conflictMessage: null,
    // Field/property in this shape.
    conflictDetails: null,
    // Field/property in this shape.
    retries: 0,
    // Field/property in this shape.
    updatedAt: Date.now(),
  });
  // Invoke helper or pass arguments.
  notify("syncing");
  // Conditional branch for this case.
  if (navigator.onLine) triggerDrain();
}

/**
 * Conflict recovery: `dismiss` drops the row; `rebase` advances `expectedVersion`
 * from server conflict details so the next drain can succeed without replaying
 * a stale optimistic version (ownership conflicts are non-rebaseable).
 */
export async function resolveQueuedAction(
  // Field/property in this shape.
  id: string,
  // Field/property in this shape.
  opts: { mode: "rebase" | "dismiss" },
// Open multi-line construct.
): Promise<boolean> {
  // Conditional branch for this case.
  if (isOfflineSwitching() || !getOfflineUser()) return false;
  // Local constant binding.
  const rows = await listQueueForUser(getOfflineUser()!);
  // Local constant binding.
  const item = rows.find((r) => r.id === id);
  // Conditional branch for this case.
  if (!item) return false;
  // Conditional branch for this case.
  if (item.status !== "conflict" && item.status !== "failed") return false;

  // User chose to drop the queued mutation.
  if (opts.mode === "dismiss") {
    // Await async work before continuing.
    await deleteQueuedAction(id);
    // Invoke helper or pass arguments.
    notify();
    // Return computed result to caller.
    return true;
  }

  // Ownership / scope losses cannot be fixed by bumping expectedVersion.
  if (
    // Assign value for subsequent use.
    item.status !== "conflict" ||
    // Invoke helper or pass arguments.
    !canRebaseConflict(item.conflictCode, item.conflictDetails)
  // Open multi-line construct.
  ) {
    // Return computed result to caller.
    return false;
  }
  // Local constant binding.
  const nextBody = rebaseBodyWithCurrentVersion(
    // Continue multi-line list/arguments.
    item.body,
    // Continue multi-line list/arguments.
    item.conflictDetails,
  );
  // Conditional branch for this case.
  if (!nextBody) return false;

  // Re-queue with advanced version so the next drain can succeed.
  await putQueuedAction({
    // Spread remaining fields/props.
    ...item,
    // Field/property in this shape.
    body: nextBody,
    // Field/property in this shape.
    status: "pending",
    // Field/property in this shape.
    lastError: null,
    // Field/property in this shape.
    conflictCode: null,
    // Field/property in this shape.
    conflictMessage: null,
    // Field/property in this shape.
    conflictDetails: null,
    // Field/property in this shape.
    retries: 0,
    // Field/property in this shape.
    updatedAt: Date.now(),
  });
  // Invoke helper or pass arguments.
  notify("syncing");
  // Conditional branch for this case.
  if (navigator.onLine) triggerDrain();
  // Return computed result to caller.
  return true;
}
