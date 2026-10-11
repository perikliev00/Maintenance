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
  listQueueForUser,
  putQueuedAction,
  readMyWorkCache,
  writeMyWorkCache,
  type MyWorkCachePayload,
  type QueueActionStatus,
  type QueuedAction,
} from "./storage";
import { getOfflineUser, isOfflineSwitching } from "./userScope";

function emptyStats(): QueueStats {
  return { pending: 0, sending: 0, conflict: 0, failed: 0 };
}

function statsFromRows(rows: QueuedAction[]): QueueStats {
  return {
    pending: rows.filter((r) => r.status === "pending").length,
    sending: rows.filter((r) => r.status === "sending").length,
    conflict: rows.filter((r) => r.status === "conflict").length,
    failed: rows.filter((r) => r.status === "failed").length,
  };
}

export async function getQueueStats(): Promise<QueueStats> {
  if (isOfflineSwitching() || !getOfflineUser()) return emptyStats();
  const rows = await listQueueForUser(getOfflineUser()!);
  return statsFromRows(rows);
}

export async function listQueuedActions(
  statuses?: QueueActionStatus[],
): Promise<QueuedAction[]> {
  if (isOfflineSwitching() || !getOfflineUser()) return [];
  const rows = await listQueueForUser(getOfflineUser()!);
  const filtered = statuses
    ? rows.filter((r) => statuses.includes(r.status))
    : rows;
  return filtered.sort((a, b) => a.createdAt - b.createdAt);
}

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
  notify(
    !navigator.onLine
      ? "offline"
      : isApiUnreachable()
        ? "unreachable"
        : "syncing",
  );
  if (navigator.onLine) triggerDrain();
  return row;
}

export async function saveMyWorkCache(
  payload: MyWorkCachePayload,
): Promise<void> {
  if (isOfflineSwitching() || !getOfflineUser()) return;
  await writeMyWorkCache(getOfflineUser()!, payload);
}

export async function loadMyWorkCache(): Promise<MyWorkCachePayload | null> {
  if (isOfflineSwitching() || !getOfflineUser()) return null;
  const userId = getOfflineUser()!;
  const row = await readMyWorkCache(userId);
  if (isOfflineSwitching() || getOfflineUser() !== userId) return null;
  return row;
}

export async function dismissQueuedAction(id: string): Promise<void> {
  await resolveQueuedAction(id, { mode: "dismiss" });
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
  if (item.status !== "conflict" && item.status !== "failed") return;
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

export async function resolveQueuedAction(
  id: string,
  opts: { mode: "rebase" | "dismiss" },
): Promise<boolean> {
  if (isOfflineSwitching() || !getOfflineUser()) return false;
  const rows = await listQueueForUser(getOfflineUser()!);
  const item = rows.find((r) => r.id === id);
  if (!item) return false;
  if (item.status !== "conflict" && item.status !== "failed") return false;

  if (opts.mode === "dismiss") {
    await deleteQueuedAction(id);
    notify();
    return true;
  }

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
