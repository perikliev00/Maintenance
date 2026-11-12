/**
 * Drain the per-user outbox.
 *
 * Prefers batched `POST /sync/push` (one round-trip, per-command results). On
 * batch failure, falls back to per-item POSTs to the original URLs. Only
 * `pending` rows auto-drain — `conflict` / `failed` wait for explicit Retry so
 * the UI can rebase versions or dismiss ownership losses. Leftover `sending`
 * rows are reset to `pending` so a crashed tab cannot strand commands forever.
 *
 * Mid-drain account switch: re-check bound user before every network send so
 * user A's commands never go out under user B's cookies.
 */
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
  compareQueuedActions,
  listQueueForUser,
  putQueuedAction,
  type QueueCommandType,
  type QueuedAction,
} from "./storage";
import {
  authHeader,
  fetchWithTimeout,
  postJsonWithSessionRefresh,
} from "./transport";
import { getOfflineUser, getOfflineBindingRevision, isOfflineSwitching } from "./userScope";

/** Transient errors retry until this count, then mark `failed`. */
const MAX_RETRIES = 8;

type RefreshFn = () => Promise<"refreshed" | "rejected" | "transient">;

/** Injectable deps for unit tests (same pattern as transport.postJsonWithSessionRefresh). */
export type DrainQueueDeps = {
  fetchFn?: typeof fetchWithTimeout;
  headersFn?: () => HeadersInit;
  refreshFn?: RefreshFn;
  /** Fallback per-item POST; default = transport postJson. */
  postJsonFn?: (
    url: string,
    body: Record<string, unknown>,
  ) => Promise<unknown>;
  listQueueForUserFn?: typeof listQueueForUser;
  putQueuedActionFn?: typeof putQueuedAction;
  deleteQueuedActionFn?: typeof deleteQueuedAction;
  /**
   * Test-only hook: after markSending, before identity re-check + network.
   * Production callers omit this.
   */
  afterClaim?: () => void | Promise<void>;
};

/**
 * Build `/sync/push` payload: body plus entity ids derived from the REST URL
 * so batch sync does not depend on those ids being duplicated in `body`.
 */
function commandPayload(item: QueuedAction): Record<string, unknown> {
  // Start from the stored body; enrich with ids parsed from the REST URL.
  const payload: Record<string, unknown> = { ...item.body };
  if (item.type === "cleaning.start") {
    payload.taskId = item.url.split("/tasks/")[1]?.split("/")[0];
  } else if (item.type === "cleaning.complete") {
    payload.sessionId = item.url.split("/sessions/")[1]?.split("/")[0];
  } else if (item.type !== "ticket.report") {
    // ticket.start/wait/resume/resolve — id lives in the path.
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
  retryable?: boolean;
};

// Function definition.
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
    beforeAttempt?: () => void;
  } = {},
): Promise<{ ok: true; results: SyncPushResult[] } | { ok: false; status: number }> {
  // Injectable deps for unit tests (same pattern as transport).
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
    { refreshFn, beforeAttempt: deps.beforeAttempt },
  );

  // Const arrow/function binding.
  const data = (await res.json().catch(() => ({}))) as {
    results?: SyncPushResult[];
  };
  // Batch success requires an array of per-command results.
  if (res.ok && Array.isArray(data.results)) {
    return { ok: true, results: data.results };
  }
  return { ok: false, status: res.status };
}

/** True when drain still owns the original user binding. */
function stillBoundTo(userId: string): boolean {
  return getOfflineUser() === userId && !isOfflineSwitching();
}

/** Flip pending rows to `sending` so a concurrent drain will not double-send. */
async function markSending(
  items: QueuedAction[],
  putFn: typeof putQueuedAction,
): Promise<QueuedAction[]> {
  const now = Date.now();
  const next: QueuedAction[] = [];
  // Iterate collection / range.
  for (const item of items) {
    const row: QueuedAction = {
      // Spread remaining fields/props.
      ...item,
      status: "sending",
      updatedAt: now,
    };
    await putFn(row);
    next.push(row);
  }
  notify("syncing");
  return next;
}

/** Apply one batch/per-item sync result to IndexedDB (delete or patch status). */
async function applySyncResult(
  item: QueuedAction,
  result: SyncPushResult,
  ownsBinding: () => boolean,
  putFn: typeof putQueuedAction,
  deleteFn: typeof deleteQueuedAction,
): Promise<void> {
  // Do not rewrite another user's store after an account switch.
  if (!ownsBinding()) return;

  const patch = decideSyncResult(result, item.retries, MAX_RETRIES);
  // Success is the only path that removes the outbox row.
  if (patch.status === "deleted") {
    await deleteFn(item.id);
    return;
  }
  // Preserve existing conflict fields when the patch omits them.
  await putFn({
    // Spread remaining fields/props.
    ...item,
    status: patch.status,
    lastError: patch.lastError ?? item.lastError,
    conflictCode:
      patch.conflictCode !== undefined ? patch.conflictCode : item.conflictCode,
    conflictMessage:
      patch.conflictMessage !== undefined
        // Continue module logic.
        ? patch.conflictMessage
        : item.conflictMessage,
    conflictDetails:
      patch.conflictDetails !== undefined
        // Continue module logic.
        ? patch.conflictDetails
        : item.conflictDetails,
    retries: patch.retries ?? item.retries,
    // Spread remaining fields/props.
    ...(patch.body ? { body: patch.body } : {}),
    updatedAt: Date.now(),
  });
}

/**
 * Single-flight drain for the bound user. No-ops when already draining,
 * switching accounts, offline, or unbound.
 */
export async function drainQueue(deps: DrainQueueDeps = {}): Promise<void> {
  const activeUserId = getOfflineUser();
  // Single-flight + online + bound-user gates.
  if (isDraining() || isOfflineSwitching() || !navigator.onLine || !activeUserId) {
    return;
  }
  const listFn = deps.listQueueForUserFn ?? listQueueForUser;
  const putFn = deps.putQueuedActionFn ?? putQueuedAction;
  const deleteFn = deps.deleteQueuedActionFn ?? deleteQueuedAction;
  const revision = getOfflineBindingRevision();
  // Const arrow/function binding.
  const ownsBinding = () => stillBoundTo(activeUserId) && getOfflineBindingRevision() === revision;
  // Const arrow/function binding.
  const beforeAttempt = () => {
    if (!ownsBinding()) throw new Error("Offline identity changed");
  };
  // Const arrow/function binding.
  const headersFn = () => {
    const headers = new Headers((deps.headersFn ?? authHeader)());
    // Server verifies this original owner against the actual cookie identity,
    // including when another tab changes cookies before our binding updates.
    headers.set("X-Offline-User", activeUserId);
    return headers;
  };
  const postJsonFn = deps.postJsonFn ?? ((url, body) => postJsonWithSessionRefresh(url, body, {
    fetchFn: deps.fetchFn,
    headersFn,
    refreshFn: deps.refreshFn,
    beforeAttempt,
  }));

  setDraining(true);
  notify("syncing");
  let networkFailure = false;
  let pendingRetry = false;
  const userId = activeUserId;
  // Guard fallible work.
  try {
    let rows = await listFn(userId);
    // Crash recovery: stranded `sending` → `pending` before we claim work.
    const recovered = recoverOrphanedSending(rows);
    // Iterate collection / range.
    for (const row of recovered) {
      const original = rows.find((r) => r.id === row.id);
      if (
        // Continue module logic.
        original &&
        original.status === "sending" &&
        row.status === "pending"
      ) {
        if (!ownsBinding()) return;
        await putFn(row);
      }
    }
    rows = recovered;

    // Auto-drain only pending; conflict/failed wait for explicit Retry.
    const pending = rows
      .filter((r) => r.status === "pending")
      // Invoke helper or pass arguments.
      .sort(compareQueuedActions);

    if (pending.length === 0) {
      markReachable({ cancelCommandRetry: true });
      return;
    }

    // Keep each request within the API limit; leave later rows unclaimed until
    // their turn so an interrupted batch cannot lose the remaining work.
    for (let offset = 0; offset < pending.length; offset += 100) {
    if (!ownsBinding()) return;
    const sending = await markSending(pending.slice(offset, offset + 100), putFn);

    if (deps.afterClaim) {
      await deps.afterClaim();
    }

    // Dev/e2e only: pause after claim so Playwright can switch accounts before
    // any network send (same seam as unit-test `afterClaim`).
    // Optional chain: plain `tsx --test` has no Vite `import.meta.env`.
    if (import.meta.env?.DEV && typeof window !== "undefined") {
      // Const arrow/function binding.
      const e2eHook = (
        window as Window & {
          __MERIDIAN_E2E_AFTER_DRAIN_CLAIM__?: () => void | Promise<void>;
        }
      ).__MERIDIAN_E2E_AFTER_DRAIN_CLAIM__;
      if (typeof e2eHook === "function") {
        await e2eHook();
      }
    }

    // Abort before any network if the account switched mid-drain.
    if (!ownsBinding()) {
      return;
    }

    // Prefer batch /sync/push when possible (refresh+retry on 401).
    try {
      const commands = sending.map((item) => ({
        commandId: item.commandId,
        type: item.type,
        payload: commandPayload(item),
        clientTime: new Date(item.createdAt).toISOString(),
      }));
      const identitySafeRefresh: RefreshFn = async () => {
        if (!ownsBinding()) return "rejected";
        const refreshFn = deps.refreshFn ?? refreshAccessToken;
        const outcome = await refreshFn();
        return ownsBinding() ? outcome : "rejected";
      };
      const batch = await pushSyncBatch(commands, {
        fetchFn: deps.fetchFn,
        headersFn,
        refreshFn: identitySafeRefresh,
        beforeAttempt,
      });
      if (!ownsBinding()) return;
      if (batch.ok) {
        // Apply each per-command result (delete / conflict / retry).
        const seen = new Set<string>();
        // Iterate collection / range.
        for (const result of batch.results) {
          const item = sending.find((p) => p.commandId === result.commandId);
          if (!item) continue;
          seen.add(item.commandId);
          await applySyncResult(item, result, ownsBinding, putFn, deleteFn);
        }
        // Missing per-command results must still advance retries (do not strand forever).
        for (const item of sending) {
          if (seen.has(item.commandId)) continue;
          await applySyncResult(
            item,
            {
              commandId: item.commandId,
              status: "error",
              message: "Temporary command failure",
              retryable: true,
            },
            ownsBinding,
            putFn,
            deleteFn,
          );
        }
        const remaining = await listFn(userId);
        if (!ownsBinding()) return;
        // Includes retryable failures (and any leftover sending recovered in finally).
        pendingRetry ||= sending.some(item => remaining.some(row =>
          row.id === item.id && (row.status === "pending" || row.status === "sending")));
        if (pendingRetry) return;
        markReachable({ cancelCommandRetry: true });
        continue;
      }
      if (batch.status === 401 || batch.status === 429) {
        // Refresh failed — keep outbox pending until the user signs in again.
        if (!ownsBinding()) return;
        // Iterate collection / range.
        for (const item of sending) {
          await putFn({
            // Spread remaining fields/props.
            ...item,
            status: "pending",
            updatedAt: Date.now(),
          });
        }
        if (batch.status === 429) scheduleBackoff();
        notify(batch.status === 401 ? "offline" : "syncing");
        return;
      }
    } catch {
      networkFailure = true;
      /* fall through to per-item */
    }

    // Fallback: POST each original URL individually.
    for (const item of sending) {
      if (!ownsBinding()) return;

      // Skip items already resolved by a partial batch (re-check store)
      const currentRows = await listFn(userId);
      const current = currentRows.find((r) => r.id === item.id);
      if (!current || current.status !== "sending") continue;

      if (!ownsBinding()) return;

      // Guard fallible work.
      try {
        await postJsonFn(item.url, item.body);
        if (!ownsBinding()) return;
        await deleteFn(item.id);
      // Invoke helper or pass arguments.
      } catch (err) {
        if (!ownsBinding()) return;
        // Const arrow/function binding.
        const status = (err as { status?: number }).status;
        const message = err instanceof Error ? err.message : "Sync failed";
        // Const arrow/function binding.
        const code = (err as { code?: string }).code;
        // Const arrow/function binding.
        const details = (err as { details?: unknown }).details;
        // Auth loss mid-drain — stop and wait for re-login.
        if (status === 401 || status === 429) {
          await putFn({
            // Spread remaining fields/props.
            ...item,
            status: "pending",
            updatedAt: Date.now(),
          });
          if (status === 429) scheduleBackoff();
          notify(status === 401 ? "offline" : "syncing");
          return;
        }
        // Network/timeout — backoff; stop the loop to avoid stampede.
        if (status === undefined) {
          networkFailure = true;
          const retries = item.retries + 1;
          await putFn({
            // Spread remaining fields/props.
            ...item,
            status: retries >= MAX_RETRIES ? "failed" : "pending",
            lastError: message,
            retries,
            updatedAt: Date.now(),
          });
          // Exit switch/loop.
          break;
        }
        // 409 and domain reassignment 403s stay in the outbox as conflicts.
        if (
          status === 409 ||
          (status === 403 &&
            shouldTreatForbiddenAsConflict(code ?? null, message))
        ) {
          await putFn({
            // Spread remaining fields/props.
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
        // Other 4xx — permanent failed (validation / hard forbidden).
        if (status >= 400 && status < 500) {
          await putFn({
            // Spread remaining fields/props.
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
        // 5xx — retry later; break so we do not hammer a sick API.
        const retries = item.retries + 1;
        await putFn({
          // Spread remaining fields/props.
          ...item,
          status: retries >= MAX_RETRIES ? "failed" : "pending",
          lastError: message,
          retries,
          updatedAt: Date.now(),
        });
        if (status >= 500) { networkFailure = true; break; }
      }
    }

    if (networkFailure) {
      markUnreachable();
      scheduleBackoff();
      return;
    } else {
      if (!pendingRetry) markReachable({ cancelCommandRetry: true });
    }
    }
  } catch {
    networkFailure = true;
    markUnreachable();
    scheduleBackoff();
  } finally {
    // Revert any leftover sending rows (crash / early break) back to pending.
    if (ownsBinding()) {
      // Guard fallible work.
      try {
        const leftover = await (deps.listQueueForUserFn ?? listQueueForUser)(
          userId,
        );
        // Iterate collection / range.
        for (const row of leftover) {
          if (row.status === "sending") {
            await (deps.putQueuedActionFn ?? putQueuedAction)({
              // Spread remaining fields/props.
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
    if (pendingRetry && ownsBinding() && navigator.onLine) {
      scheduleBackoff(() => { if (ownsBinding()) void drainQueue(deps); }, undefined, { keepOnReachable: true });
    }
    // Final banner mode from browser + unreachable latch.
    if (!navigator.onLine) {
      notify("offline");
    // Invoke helper or pass arguments.
    } else if (isApiUnreachable()) {
      notify("unreachable");
    } else {
      notify();
    }
  }
}
