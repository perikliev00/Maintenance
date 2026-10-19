/**
 * Outbox CRUD and My Work cache access scoped to the active offline user.
 *
 * Enqueue / retry / rebase refuse to run while `isOfflineSwitching` so a logout
 * or A→B account switch cannot interleave writes with another user's rows.
 */
import {
  canRebaseConflict,
  rebaseBodyWithCurrentVersion,
} from "./conflict";
import {
  isApiUnreachable,
  notify,
  triggerDrain,
  type QueueStats,
} from "./connState";
import {
  deleteQueuedAction,
  compareQueuedActions,
  listQueueForUser,
  putQueuedAction,
  readMyWorkCache,
  writeMyWorkCache,
  type MyWorkCachePayload,
  type QueueActionStatus,
  type QueuedAction,
} from "./storage";
import { getOfflineUser, isOfflineSwitching } from "./userScope";

/** Zeroed banner counters used when there is no bound user / mid-switch. */
function emptyStats(): QueueStats {
  return { pending: 0, sending: 0, conflict: 0, failed: 0 };
}

/** Aggregate outbox rows into banner status counts. */
function statsFromRows(rows: QueuedAction[]): QueueStats {
  return {
    pending: rows.filter((r) => r.status === "pending").length,
    sending: rows.filter((r) => r.status === "sending").length,
    conflict: rows.filter((r) => r.status === "conflict").length,
    failed: rows.filter((r) => r.status === "failed").length,
  };
}

/** Counts by status for the connection banner; empty while switching users. */
export async function getQueueStats(): Promise<QueueStats> {
  // Avoid leaking another user's counts during logout / account switch.
  if (isOfflineSwitching() || !getOfflineUser()) return emptyStats();
  try {
    const rows = await listQueueForUser(getOfflineUser()!);
    return statsFromRows(rows);
  } catch {
    // IndexedDB unavailable (Node unit tests) or transient IDB failure.
    return emptyStats();
  }
}

/** Outbox rows for the active user, oldest first (drain order). */
export async function listQueuedActions(
  statuses?: QueueActionStatus[],
): Promise<QueuedAction[]> {
  if (isOfflineSwitching() || !getOfflineUser()) return [];
  const rows = await listQueueForUser(getOfflineUser()!);
  // Optional status filter (e.g. conflict-only for the issues panel).
  const filtered = statuses
    ? rows.filter((r) => statuses.includes(r.status))
    : rows;
  // Oldest first so drain / UI match FIFO order.
  return filtered.sort(compareQueuedActions);
}

/**
 * Persist a pending mutation and nudge the drain loop when the browser is online.
 * Throws if there is no bound user (avoids orphaned unscoped queue rows).
 */
export async function enqueue(
  action: Omit<
    QueuedAction,
    | "id"
    | "userId"
    | "createdAt"
    | "updatedAt"
    | "status"
    | "lastError"
    | "conflictCode"
    | "conflictMessage"
    | "conflictDetails"
    | "retries"
  > & { id?: string },
): Promise<QueuedAction> {
  const activeUserId = getOfflineUser();
  // Refuse orphaned rows — every outbox entry must be user-scoped.
  if (isOfflineSwitching() || !activeUserId) {
    throw new Error("Cannot enqueue offline action without an active user");
  }
  const now = Date.now();
  const row: QueuedAction = {
    id: action.id ?? crypto.randomUUID(),
    userId: activeUserId,
    commandId: action.commandId,
    type: action.type,
    url: action.url,
    method: action.method,
    body: action.body,
    createdAt: now,
    updatedAt: now,
    status: "pending",
    lastError: null,
    conflictCode: null,
    conflictMessage: null,
    conflictDetails: null,
    retries: 0,
  };
  await putQueuedAction(row);
  // Banner mode reflects why we queued (offline vs unreachable vs syncing).
  notify(
    !navigator.onLine
      ? "offline"
      : isApiUnreachable()
        ? "unreachable"
        : "syncing",
  );
  // Kick drain immediately when the browser already thinks it is online.
  if (navigator.onLine) triggerDrain();
  return row;
}

/** Snapshot My Work lists for offline display (keyed by active user). */
export async function saveMyWorkCache(
  payload: MyWorkCachePayload,
): Promise<void> {
  if (isOfflineSwitching() || !getOfflineUser()) return;
  await writeMyWorkCache(getOfflineUser()!, payload);
}

/**
 * Load My Work cache; re-checks user identity after the async read so a
 * mid-flight account switch cannot return another user's snapshot.
 */
export async function loadMyWorkCache(): Promise<MyWorkCachePayload | null> {
  if (isOfflineSwitching() || !getOfflineUser()) return null;
  const userId = getOfflineUser()!;
  const row = await readMyWorkCache(userId);
  // Identity may have changed while IDB was reading — discard stale snapshot.
  if (isOfflineSwitching() || getOfflineUser() !== userId) return null;
  return row;
}

/**
 * Blind retry (same payload). Prefer `resolveQueuedAction({ mode: "rebase" })`
 * for version_conflict so expectedVersion is advanced.
 */
export async function retryQueuedAction(id: string): Promise<void> {
  if (isOfflineSwitching() || !getOfflineUser()) return;
  const rows = await listQueueForUser(getOfflineUser()!);
  const item = rows.find((r) => r.id === id);
  if (!item) return;
  // Only conflict/failed rows are eligible for manual retry.
  if (item.status !== "conflict" && item.status !== "failed") return;
  // Reset to pending with cleared conflict fields and retry counter.
  await putQueuedAction({
    ...item,
    status: "pending",
    lastError: null,
    conflictCode: null,
    conflictMessage: null,
    conflictDetails: null,
    retries: 0,
    updatedAt: Date.now(),
  });
  notify("syncing");
  if (navigator.onLine) triggerDrain();
}

/**
 * Conflict recovery: `dismiss` drops the row; `rebase` advances `expectedVersion`
 * from server conflict details so the next drain can succeed without replaying
 * a stale optimistic version (ownership conflicts are non-rebaseable).
 */
export async function resolveQueuedAction(
  id: string,
  opts: { mode: "rebase" | "dismiss" },
): Promise<boolean> {
  if (isOfflineSwitching() || !getOfflineUser()) return false;
  const rows = await listQueueForUser(getOfflineUser()!);
  const item = rows.find((r) => r.id === id);
  if (!item) return false;
  if (item.status !== "conflict" && item.status !== "failed") return false;

  // User chose to drop the queued mutation.
  if (opts.mode === "dismiss") {
    await deleteQueuedAction(id);
    notify();
    return true;
  }

  // Ownership / scope losses cannot be fixed by bumping expectedVersion.
  if (
    item.status !== "conflict" ||
    !canRebaseConflict(item.conflictCode, item.conflictDetails)
  ) {
    return false;
  }
  const nextBody = rebaseBodyWithCurrentVersion(
    item.body,
    item.conflictDetails,
  );
  if (!nextBody) return false;

  // Re-queue with advanced version so the next drain can succeed.
  await putQueuedAction({
    ...item,
    body: nextBody,
    status: "pending",
    lastError: null,
    conflictCode: null,
    conflictMessage: null,
    conflictDetails: null,
    retries: 0,
    updatedAt: Date.now(),
  });
  notify("syncing");
  if (navigator.onLine) triggerDrain();
  return true;
}
