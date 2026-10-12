import {
  fetchWithAuthRetry,
  refreshAccessToken,
  API_BASE,
} from "../api/http";
import {
  decideSyncResult,
  shouldTreatForbiddenAsConflict,
} from "./conflict";
import {
  isApiUnreachable,
  isDraining,
  markReachable,
  markUnreachable,
  notify,
  scheduleBackoff,
  setDraining,
} from "./connState";
import { recoverOrphanedSending } from "./recoverOrphaned";
import {
  deleteQueuedAction,
  listQueueForUser,
  putQueuedAction,
  type QueueCommandType,
  type QueuedAction,
} from "./storage";
import {
  authHeader,
  fetchWithTimeout,
  postJson,
} from "./transport";
import { getOfflineUser, isOfflineSwitching } from "./userScope";

const MAX_RETRIES = 8;

type RefreshFn = () => Promise<"refreshed" | "rejected" | "transient">;

function commandPayload(item: QueuedAction): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...item.body };
  if (item.type === "cleaning.start") {
    payload.taskId = item.url.split("/tasks/")[1]?.split("/")[0];
  } else if (item.type === "cleaning.complete") {
    payload.sessionId = item.url.split("/sessions/")[1]?.split("/")[0];
  } else if (item.type !== "ticket.report") {
    const ticketId = item.url.split("/tickets/")[1]?.split("/")[0];
    if (ticketId) payload.ticketId = ticketId;
  }
  return payload;
}

type SyncPushResult = {
  commandId: string;
  status: string;
  message?: string;
  code?: string;
  details?: unknown;
};

async function pushSyncBatch(
  commands: Array<{
    commandId: string;
    type: QueueCommandType;
    payload: Record<string, unknown>;
    clientTime: string;
  }>,
  deps: {
    fetchFn?: typeof fetchWithTimeout;
    refreshFn?: RefreshFn;
    headersFn?: () => HeadersInit;
  } = {},
): Promise<{ ok: true; results: SyncPushResult[] } | { ok: false; status: number }> {
  const fetchFn = deps.fetchFn ?? fetchWithTimeout;
  const headersFn = deps.headersFn ?? authHeader;
  const refreshFn = deps.refreshFn ?? refreshAccessToken;

  const res = await fetchWithAuthRetry(
    () =>
      fetchFn(`${API_BASE}/sync/push`, {
        method: "POST",
        credentials: "include",
        headers: headersFn(),
        body: JSON.stringify({ commands }),
      }),
    { refreshFn },
  );

  const data = (await res.json().catch(() => ({}))) as {
    results?: SyncPushResult[];
  };
  if (res.ok && Array.isArray(data.results)) {
    return { ok: true, results: data.results };
  }
  return { ok: false, status: res.status };
}

async function markSending(items: QueuedAction[]): Promise<QueuedAction[]> {
  const now = Date.now();
  const next: QueuedAction[] = [];
  for (const item of items) {
    const row: QueuedAction = {
      ...item,
      status: "sending",
      updatedAt: now,
    };
    await putQueuedAction(row);
    next.push(row);
  }
  notify("syncing");
  return next;
}

async function applySyncResult(
  item: QueuedAction,
  result: SyncPushResult,
): Promise<void> {
  const patch = decideSyncResult(result, item.retries, MAX_RETRIES);
  // Success is the only path that removes the outbox row.
  if (patch.status === "deleted") {
    await deleteQueuedAction(item.id);
    return;
  }
  await putQueuedAction({
    ...item,
    status: patch.status,
    lastError: patch.lastError ?? item.lastError,
    conflictCode:
      patch.conflictCode !== undefined ? patch.conflictCode : item.conflictCode,
    conflictMessage:
      patch.conflictMessage !== undefined
        ? patch.conflictMessage
        : item.conflictMessage,
    conflictDetails:
      patch.conflictDetails !== undefined
        ? patch.conflictDetails
        : item.conflictDetails,
    retries: patch.retries ?? item.retries,
    ...(patch.body ? { body: patch.body } : {}),
    updatedAt: Date.now(),
  });
}

export async function drainQueue(): Promise<void> {
  const activeUserId = getOfflineUser();
  if (isDraining() || isOfflineSwitching() || !navigator.onLine || !activeUserId) {
    return;
  }
  setDraining(true);
  notify("syncing");
  let networkFailure = false;
  const userId = activeUserId;
  try {
    let rows = await listQueueForUser(userId);
    const recovered = recoverOrphanedSending(rows);
    for (const row of recovered) {
      const original = rows.find((r) => r.id === row.id);
      if (
        original &&
        original.status === "sending" &&
        row.status === "pending"
      ) {
        await putQueuedAction(row);
      }
    }
    rows = recovered;

    // Auto-drain only pending; conflict/failed wait for explicit Retry.
    const pending = rows
      .filter((r) => r.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt);

    if (pending.length === 0) {
      markReachable();
      return;
    }

    const sending = await markSending(pending);

    // Prefer batch /sync/push when possible (refresh+retry on 401).
    try {
      const commands = sending.map((item) => ({
        commandId: item.commandId,
        type: item.type,
        payload: commandPayload(item),
        clientTime: new Date(item.createdAt).toISOString(),
      }));
      const batch = await pushSyncBatch(commands);
      if (batch.ok) {
        for (const result of batch.results) {
          const item = sending.find((p) => p.commandId === result.commandId);
          if (!item) continue;
          await applySyncResult(item, result);
        }
        markReachable();
        return;
      }
      if (batch.status === 401) {
        // Refresh failed — keep outbox pending until the user signs in again.
        for (const item of sending) {
          await putQueuedAction({
            ...item,
            status: "pending",
            updatedAt: Date.now(),
          });
        }
        notify("offline");
        return;
      }
    } catch {
      networkFailure = true;
      /* fall through to per-item */
    }

    for (const item of sending) {
      // Skip items already resolved by a partial batch (re-check store)
      const currentRows = await listQueueForUser(userId);
      const current = currentRows.find((r) => r.id === item.id);
      if (!current || current.status !== "sending") continue;

      try {
        await postJson(item.url, item.body);
        await deleteQueuedAction(item.id);
      } catch (err) {
        const status = (err as { status?: number }).status;
        const message = err instanceof Error ? err.message : "Sync failed";
        const code = (err as { code?: string }).code;
        const details = (err as { details?: unknown }).details;
        if (status === 401) {
          await putQueuedAction({
            ...item,
            status: "pending",
            updatedAt: Date.now(),
          });
          notify("offline");
          break;
        }
        if (status === undefined) {
          networkFailure = true;
          const retries = item.retries + 1;
          await putQueuedAction({
            ...item,
            status: retries >= MAX_RETRIES ? "failed" : "pending",
            lastError: message,
            retries,
            updatedAt: Date.now(),
          });
          break;
        }
        // 409 and domain reassignment 403s stay in the outbox as conflicts.
        if (
          status === 409 ||
          (status === 403 &&
            shouldTreatForbiddenAsConflict(code ?? null, message))
        ) {
          await putQueuedAction({
            ...item,
            status: "conflict",
            lastError: message,
            conflictCode: code ?? (status === 409 ? null : "assignee_conflict"),
            conflictMessage: message,
            conflictDetails: details ?? null,
            updatedAt: Date.now(),
          });
          continue;
        }
        if (status >= 400 && status < 500) {
          await putQueuedAction({
            ...item,
            status: "failed",
            lastError: message,
            conflictCode: null,
            conflictMessage: null,
            conflictDetails: null,
            retries: item.retries + 1,
            updatedAt: Date.now(),
          });
          continue;
        }
        const retries = item.retries + 1;
        await putQueuedAction({
          ...item,
          status: retries >= MAX_RETRIES ? "failed" : "pending",
          lastError: message,
          retries,
          updatedAt: Date.now(),
        });
        if (status >= 500) break;
      }
    }

    if (networkFailure) {
      markUnreachable();
      scheduleBackoff();
    } else {
      markReachable();
    }
  } catch {
    networkFailure = true;
    markUnreachable();
    scheduleBackoff();
  } finally {
    // Revert any leftover sending rows (crash / early break) back to pending.
    if (getOfflineUser() === userId) {
      try {
        const leftover = await listQueueForUser(userId);
        for (const row of leftover) {
          if (row.status === "sending") {
            await putQueuedAction({
              ...row,
              status: "pending",
              updatedAt: Date.now(),
            });
          }
        }
      } catch {
        /* ignore cleanup errors */
      }
    }
    setDraining(false);
    if (!navigator.onLine) {
      notify("offline");
    } else if (isApiUnreachable()) {
      notify("unreachable");
    } else {
      notify();
    }
  }
}
