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
  // List item in import/export/params.
  fetchWithAuthRetry,
  // List item in import/export/params.
  refreshAccessToken,
  // List item in import/export/params.
  API_BASE,
// Close multi-line construct with trailing syntax.
} from "../api/http";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  decideSyncResult,
  // List item in import/export/params.
  shouldTreatForbiddenAsConflict,
// Close multi-line construct with trailing syntax.
} from "./conflict";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  isApiUnreachable,
  // List item in import/export/params.
  isDraining,
  // List item in import/export/params.
  markReachable,
  // List item in import/export/params.
  markUnreachable,
  // List item in import/export/params.
  notify,
  // List item in import/export/params.
  scheduleBackoff,
  // List item in import/export/params.
  setDraining,
// Close multi-line construct with trailing syntax.
} from "./connState";
// Import dependency used by this module.
import { recoverOrphanedSending } from "./recoverOrphaned";
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
  // Local type alias shaping data.
  type QueueCommandType,
  // Local type alias shaping data.
  type QueuedAction,
// Close multi-line construct with trailing syntax.
} from "./storage";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  authHeader,
  // List item in import/export/params.
  fetchWithTimeout,
  // List item in import/export/params.
  postJsonWithSessionRefresh,
// Close multi-line construct with trailing syntax.
} from "./transport";
// Import dependency used by this module.
import { getOfflineUser, getOfflineBindingRevision, isOfflineSwitching } from "./userScope";

/** Transient errors retry until this count, then mark `failed`. */
const MAX_RETRIES = 8;

// Local type alias shaping data.
type RefreshFn = () => Promise<"refreshed" | "rejected" | "transient">;

/** Injectable deps for unit tests (same pattern as transport.postJsonWithSessionRefresh). */
export type DrainQueueDeps = {
  // Field/property in this shape.
  fetchFn?: typeof fetchWithTimeout;
  // Arrow function / callback body.
  headersFn?: () => HeadersInit;
  // Field/property in this shape.
  refreshFn?: RefreshFn;
  /** Fallback per-item POST; default = transport postJson. */
  postJsonFn?: (
    // Field/property in this shape.
    url: string,
    // Field/property in this shape.
    body: Record<string, unknown>,
  // Arrow function / callback body.
  ) => Promise<unknown>;
  // Field/property in this shape.
  listQueueForUserFn?: typeof listQueueForUser;
  // Field/property in this shape.
  putQueuedActionFn?: typeof putQueuedAction;
  // Field/property in this shape.
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
  // Conditional branch for this case.
  if (item.type === "cleaning.start") {
    // Assign value for subsequent use.
    payload.taskId = item.url.split("/tasks/")[1]?.split("/")[0];
  // Assign value for subsequent use.
  } else if (item.type === "cleaning.complete") {
    // Assign value for subsequent use.
    payload.sessionId = item.url.split("/sessions/")[1]?.split("/")[0];
  // Assign value for subsequent use.
  } else if (item.type !== "ticket.report") {
    // ticket.start/wait/resume/resolve — id lives in the path.
    const ticketId = item.url.split("/tickets/")[1]?.split("/")[0];
    // Conditional branch for this case.
    if (ticketId) payload.ticketId = ticketId;
  }
  // Return computed result to caller.
  return payload;
}

// Local type alias shaping data.
type SyncPushResult = {
  // Field/property in this shape.
  commandId: string;
  // Field/property in this shape.
  status: string;
  // Field/property in this shape.
  message?: string;
  // Field/property in this shape.
  code?: string;
  // Field/property in this shape.
  details?: unknown;
  // Field/property in this shape.
  retryable?: boolean;
};

// Function definition.
async function pushSyncBatch(
  // Field/property in this shape.
  commands: Array<{
    // Field/property in this shape.
    commandId: string;
    // Field/property in this shape.
    type: QueueCommandType;
    // Field/property in this shape.
    payload: Record<string, unknown>;
    // Field/property in this shape.
    clientTime: string;
  // Continue multi-line list/arguments.
  }>,
  // Field/property in this shape.
  deps: {
    // Field/property in this shape.
    fetchFn?: typeof fetchWithTimeout;
    // Field/property in this shape.
    refreshFn?: RefreshFn;
    // Arrow function / callback body.
    headersFn?: () => HeadersInit;
    // Arrow function / callback body.
    beforeAttempt?: () => void;
  // Assign value for subsequent use.
  } = {},
// Open multi-line construct.
): Promise<{ ok: true; results: SyncPushResult[] } | { ok: false; status: number }> {
  // Injectable deps for unit tests (same pattern as transport).
  const fetchFn = deps.fetchFn ?? fetchWithTimeout;
  // Local constant binding.
  const headersFn = deps.headersFn ?? authHeader;
  // Local constant binding.
  const refreshFn = deps.refreshFn ?? refreshAccessToken;

  // Local constant binding.
  const res = await fetchWithAuthRetry(
    // Arrow function / callback body.
    () =>
      // Open multi-line construct.
      fetchFn(`${API_BASE}/sync/push`, {
        // Field/property in this shape.
        method: "POST",
        // Field/property in this shape.
        credentials: "include",
        // Field/property in this shape.
        headers: headersFn(),
        // Field/property in this shape.
        body: JSON.stringify({ commands }),
      }),
    // Continue multi-line list/arguments.
    { refreshFn, beforeAttempt: deps.beforeAttempt },
  );

  // Const arrow/function binding.
  const data = (await res.json().catch(() => ({}))) as {
    // Field/property in this shape.
    results?: SyncPushResult[];
  };
  // Batch success requires an array of per-command results.
  if (res.ok && Array.isArray(data.results)) {
    // Return computed result to caller.
    return { ok: true, results: data.results };
  }
  // Return computed result to caller.
  return { ok: false, status: res.status };
}

/** True when drain still owns the original user binding. */
function stillBoundTo(userId: string): boolean {
  // Return computed result to caller.
  return getOfflineUser() === userId && !isOfflineSwitching();
}

/** Flip pending rows to `sending` so a concurrent drain will not double-send. */
async function markSending(
  // Field/property in this shape.
  items: QueuedAction[],
  // Field/property in this shape.
  putFn: typeof putQueuedAction,
// Open multi-line construct.
): Promise<QueuedAction[]> {
  // Local constant binding.
  const now = Date.now();
  // Local constant binding.
  const next: QueuedAction[] = [];
  // Iterate collection / range.
  for (const item of items) {
    // Local constant binding.
    const row: QueuedAction = {
      // Spread remaining fields/props.
      ...item,
      // Field/property in this shape.
      status: "sending",
      // Field/property in this shape.
      updatedAt: now,
    };
    // Await async work before continuing.
    await putFn(row);
    // Invoke helper or pass arguments.
    next.push(row);
  }
  // Invoke helper or pass arguments.
  notify("syncing");
  // Return computed result to caller.
  return next;
}

/** Apply one batch/per-item sync result to IndexedDB (delete or patch status). */
async function applySyncResult(
  // Field/property in this shape.
  item: QueuedAction,
  // Field/property in this shape.
  result: SyncPushResult,
  // Arrow function / callback body.
  ownsBinding: () => boolean,
  // Field/property in this shape.
  putFn: typeof putQueuedAction,
  // Field/property in this shape.
  deleteFn: typeof deleteQueuedAction,
// Open multi-line construct.
): Promise<void> {
  // Do not rewrite another user's store after an account switch.
  if (!ownsBinding()) return;

  // Local constant binding.
  const patch = decideSyncResult(result, item.retries, MAX_RETRIES);
  // Success is the only path that removes the outbox row.
  if (patch.status === "deleted") {
    // Await async work before continuing.
    await deleteFn(item.id);
    // Return computed result to caller.
    return;
  }
  // Preserve existing conflict fields when the patch omits them.
  await putFn({
    // Spread remaining fields/props.
    ...item,
    // Field/property in this shape.
    status: patch.status,
    // Field/property in this shape.
    lastError: patch.lastError ?? item.lastError,
    // Field/property in this shape.
    conflictCode:
      // Assign value for subsequent use.
      patch.conflictCode !== undefined ? patch.conflictCode : item.conflictCode,
    // Field/property in this shape.
    conflictMessage:
      // Assign value for subsequent use.
      patch.conflictMessage !== undefined
        // Continue module logic.
        ? patch.conflictMessage
        // Continue multi-line list/arguments.
        : item.conflictMessage,
    // Field/property in this shape.
    conflictDetails:
      // Assign value for subsequent use.
      patch.conflictDetails !== undefined
        // Continue module logic.
        ? patch.conflictDetails
        // Continue multi-line list/arguments.
        : item.conflictDetails,
    // Field/property in this shape.
    retries: patch.retries ?? item.retries,
    // Spread remaining fields/props.
    ...(patch.body ? { body: patch.body } : {}),
    // Field/property in this shape.
    updatedAt: Date.now(),
  });
}

/**
 * Single-flight drain for the bound user. No-ops when already draining,
 * switching accounts, offline, or unbound.
 */
export async function drainQueue(deps: DrainQueueDeps = {}): Promise<void> {
  // Local constant binding.
  const activeUserId = getOfflineUser();
  // Single-flight + online + bound-user gates.
  if (isDraining() || isOfflineSwitching() || !navigator.onLine || !activeUserId) {
    // Return computed result to caller.
    return;
  }
  // Local constant binding.
  const listFn = deps.listQueueForUserFn ?? listQueueForUser;
  // Local constant binding.
  const putFn = deps.putQueuedActionFn ?? putQueuedAction;
  // Local constant binding.
  const deleteFn = deps.deleteQueuedActionFn ?? deleteQueuedAction;
  // Local constant binding.
  const revision = getOfflineBindingRevision();
  // Const arrow/function binding.
  const ownsBinding = () => stillBoundTo(activeUserId) && getOfflineBindingRevision() === revision;
  // Const arrow/function binding.
  const beforeAttempt = () => {
    // Conditional branch for this case.
    if (!ownsBinding()) throw new Error("Offline identity changed");
  };
  // Const arrow/function binding.
  const headersFn = () => {
    // Local constant binding.
    const headers = new Headers((deps.headersFn ?? authHeader)());
    // Server verifies this original owner against the actual cookie identity,
    // including when another tab changes cookies before our binding updates.
    headers.set("X-Offline-User", activeUserId);
    // Return computed result to caller.
    return headers;
  };
  // Local constant binding.
  const postJsonFn = deps.postJsonFn ?? ((url, body) => postJsonWithSessionRefresh(url, body, {
    // Field/property in this shape.
    fetchFn: deps.fetchFn,
    // List item in import/export/params.
    headersFn,
    // Field/property in this shape.
    refreshFn: deps.refreshFn,
    // List item in import/export/params.
    beforeAttempt,
  }));

  // Invoke helper or pass arguments.
  setDraining(true);
  // Invoke helper or pass arguments.
  notify("syncing");
  // Mutable local binding.
  let networkFailure = false;
  // Mutable local binding.
  let pendingRetry = false;
  // Local constant binding.
  const userId = activeUserId;
  // Guard fallible work.
  try {
    // Mutable local binding.
    let rows = await listFn(userId);
    // Crash recovery: stranded `sending` → `pending` before we claim work.
    const recovered = recoverOrphanedSending(rows);
    // Iterate collection / range.
    for (const row of recovered) {
      // Local constant binding.
      const original = rows.find((r) => r.id === row.id);
      // Conditional branch for this case.
      if (
        // Continue module logic.
        original &&
        // Assign value for subsequent use.
        original.status === "sending" &&
        // Assign value for subsequent use.
        row.status === "pending"
      // Open multi-line construct.
      ) {
        // Conditional branch for this case.
        if (!ownsBinding()) return;
        // Await async work before continuing.
        await putFn(row);
      }
    }
    // Assign value for subsequent use.
    rows = recovered;

    // Auto-drain only pending; conflict/failed wait for explicit Retry.
    const pending = rows
      // Arrow function / callback body.
      .filter((r) => r.status === "pending")
      // Invoke helper or pass arguments.
      .sort(compareQueuedActions);

    // Conditional branch for this case.
    if (pending.length === 0) {
      // Invoke helper or pass arguments.
      markReachable({ cancelCommandRetry: true });
      // Return computed result to caller.
      return;
    }

    // Keep each request within the API limit; leave later rows unclaimed until
    // their turn so an interrupted batch cannot lose the remaining work.
    for (let offset = 0; offset < pending.length; offset += 100) {
    // Conditional branch for this case.
    if (!ownsBinding()) return;
    // Local constant binding.
    const sending = await markSending(pending.slice(offset, offset + 100), putFn);

    // Conditional branch for this case.
    if (deps.afterClaim) {
      // Await async work before continuing.
      await deps.afterClaim();
    }

    // Dev/e2e only: pause after claim so Playwright can switch accounts before
    // any network send (same seam as unit-test `afterClaim`).
    // Optional chain: plain `tsx --test` has no Vite `import.meta.env`.
    if (import.meta.env?.DEV && typeof window !== "undefined") {
      // Const arrow/function binding.
      const e2eHook = (
        // Open multi-line construct.
        window as Window & {
          // Arrow function / callback body.
          __MERIDIAN_E2E_AFTER_DRAIN_CLAIM__?: () => void | Promise<void>;
        }
      // Close multi-line construct with trailing syntax.
      ).__MERIDIAN_E2E_AFTER_DRAIN_CLAIM__;
      // Conditional branch for this case.
      if (typeof e2eHook === "function") {
        // Await async work before continuing.
        await e2eHook();
      }
    }

    // Abort before any network if the account switched mid-drain.
    if (!ownsBinding()) {
      // Return computed result to caller.
      return;
    }

    // Prefer batch /sync/push when possible (refresh+retry on 401).
    try {
      // Local constant binding.
      const commands = sending.map((item) => ({
        // Field/property in this shape.
        commandId: item.commandId,
        // Field/property in this shape.
        type: item.type,
        // Field/property in this shape.
        payload: commandPayload(item),
        // Field/property in this shape.
        clientTime: new Date(item.createdAt).toISOString(),
      }));
      // Local constant binding.
      const identitySafeRefresh: RefreshFn = async () => {
        // Conditional branch for this case.
        if (!ownsBinding()) return "rejected";
        // Local constant binding.
        const refreshFn = deps.refreshFn ?? refreshAccessToken;
        // Local constant binding.
        const outcome = await refreshFn();
        // Return computed result to caller.
        return ownsBinding() ? outcome : "rejected";
      };
      // Local constant binding.
      const batch = await pushSyncBatch(commands, {
        // Field/property in this shape.
        fetchFn: deps.fetchFn,
        // List item in import/export/params.
        headersFn,
        // Field/property in this shape.
        refreshFn: identitySafeRefresh,
        // List item in import/export/params.
        beforeAttempt,
      });
      // Conditional branch for this case.
      if (!ownsBinding()) return;
      // Conditional branch for this case.
      if (batch.ok) {
        // Apply each per-command result (delete / conflict / retry).
        const seen = new Set<string>();
        // Iterate collection / range.
        for (const result of batch.results) {
          // Local constant binding.
          const item = sending.find((p) => p.commandId === result.commandId);
          // Conditional branch for this case.
          if (!item) continue;
          // Invoke helper or pass arguments.
          seen.add(item.commandId);
          // Await async work before continuing.
          await applySyncResult(item, result, ownsBinding, putFn, deleteFn);
        }
        // Missing per-command results must still advance retries (do not strand forever).
        for (const item of sending) {
          // Conditional branch for this case.
          if (seen.has(item.commandId)) continue;
          // Await async work before continuing.
          await applySyncResult(
            // List item in import/export/params.
            item,
            {
              // Field/property in this shape.
              commandId: item.commandId,
              // Field/property in this shape.
              status: "error",
              // Field/property in this shape.
              message: "Temporary command failure",
              // Field/property in this shape.
              retryable: true,
            },
            // List item in import/export/params.
            ownsBinding,
            // List item in import/export/params.
            putFn,
            // List item in import/export/params.
            deleteFn,
          );
        }
        // Local constant binding.
        const remaining = await listFn(userId);
        // Conditional branch for this case.
        if (!ownsBinding()) return;
        // Includes retryable failures (and any leftover sending recovered in finally).
        pendingRetry ||= sending.some(item => remaining.some(row =>
          // Assign value for subsequent use.
          row.id === item.id && (row.status === "pending" || row.status === "sending")));
        // Conditional branch for this case.
        if (pendingRetry) return;
        // Invoke helper or pass arguments.
        markReachable({ cancelCommandRetry: true });
        // Continue with next iteration.
        continue;
      }
      // Conditional branch for this case.
      if (batch.status === 401 || batch.status === 429) {
        // Refresh failed — keep outbox pending until the user signs in again.
        if (!ownsBinding()) return;
        // Iterate collection / range.
        for (const item of sending) {
          // Await async work before continuing.
          await putFn({
            // Spread remaining fields/props.
            ...item,
            // Field/property in this shape.
            status: "pending",
            // Field/property in this shape.
            updatedAt: Date.now(),
          });
        }
        // Conditional branch for this case.
        if (batch.status === 429) scheduleBackoff();
        // Assign value for subsequent use.
        notify(batch.status === 401 ? "offline" : "syncing");
        // Return computed result to caller.
        return;
      }
    // Open multi-line construct.
    } catch {
      // Assign value for subsequent use.
      networkFailure = true;
      /* fall through to per-item */
    }

    // Fallback: POST each original URL individually.
    for (const item of sending) {
      // Conditional branch for this case.
      if (!ownsBinding()) return;

      // Skip items already resolved by a partial batch (re-check store)
      const currentRows = await listFn(userId);
      // Local constant binding.
      const current = currentRows.find((r) => r.id === item.id);
      // Conditional branch for this case.
      if (!current || current.status !== "sending") continue;

      // Conditional branch for this case.
      if (!ownsBinding()) return;

      // Guard fallible work.
      try {
        // Await async work before continuing.
        await postJsonFn(item.url, item.body);
        // Conditional branch for this case.
        if (!ownsBinding()) return;
        // Await async work before continuing.
        await deleteFn(item.id);
      // Invoke helper or pass arguments.
      } catch (err) {
        // Conditional branch for this case.
        if (!ownsBinding()) return;
        // Const arrow/function binding.
        const status = (err as { status?: number }).status;
        // Local constant binding.
        const message = err instanceof Error ? err.message : "Sync failed";
        // Const arrow/function binding.
        const code = (err as { code?: string }).code;
        // Const arrow/function binding.
        const details = (err as { details?: unknown }).details;
        // Auth loss mid-drain — stop and wait for re-login.
        if (status === 401 || status === 429) {
          // Await async work before continuing.
          await putFn({
            // Spread remaining fields/props.
            ...item,
            // Field/property in this shape.
            status: "pending",
            // Field/property in this shape.
            updatedAt: Date.now(),
          });
          // Conditional branch for this case.
          if (status === 429) scheduleBackoff();
          // Assign value for subsequent use.
          notify(status === 401 ? "offline" : "syncing");
          // Return computed result to caller.
          return;
        }
        // Network/timeout — backoff; stop the loop to avoid stampede.
        if (status === undefined) {
          // Assign value for subsequent use.
          networkFailure = true;
          // Local constant binding.
          const retries = item.retries + 1;
          // Await async work before continuing.
          await putFn({
            // Spread remaining fields/props.
            ...item,
            // Field/property in this shape.
            status: retries >= MAX_RETRIES ? "failed" : "pending",
            // Field/property in this shape.
            lastError: message,
            // List item in import/export/params.
            retries,
            // Field/property in this shape.
            updatedAt: Date.now(),
          });
          // Exit switch/loop.
          break;
        }
        // 409 and domain reassignment 403s stay in the outbox as conflicts.
        if (
          // Assign value for subsequent use.
          status === 409 ||
          // Assign value for subsequent use.
          (status === 403 &&
            // Invoke helper or pass arguments.
            shouldTreatForbiddenAsConflict(code ?? null, message))
        // Open multi-line construct.
        ) {
          // Await async work before continuing.
          await putFn({
            // Spread remaining fields/props.
            ...item,
            // Field/property in this shape.
            status: "conflict",
            // Field/property in this shape.
            lastError: message,
            // Field/property in this shape.
            conflictCode: code ?? (status === 409 ? null : "assignee_conflict"),
            // Field/property in this shape.
            conflictMessage: message,
            // Field/property in this shape.
            conflictDetails: details ?? null,
            // Field/property in this shape.
            updatedAt: Date.now(),
          });
          // Continue with next iteration.
          continue;
        }
        // Other 4xx — permanent failed (validation / hard forbidden).
        if (status >= 400 && status < 500) {
          // Await async work before continuing.
          await putFn({
            // Spread remaining fields/props.
            ...item,
            // Field/property in this shape.
            status: "failed",
            // Field/property in this shape.
            lastError: message,
            // Field/property in this shape.
            conflictCode: null,
            // Field/property in this shape.
            conflictMessage: null,
            // Field/property in this shape.
            conflictDetails: null,
            // Field/property in this shape.
            retries: item.retries + 1,
            // Field/property in this shape.
            updatedAt: Date.now(),
          });
          // Continue with next iteration.
          continue;
        }
        // 5xx — retry later; break so we do not hammer a sick API.
        const retries = item.retries + 1;
        // Await async work before continuing.
        await putFn({
          // Spread remaining fields/props.
          ...item,
          // Field/property in this shape.
          status: retries >= MAX_RETRIES ? "failed" : "pending",
          // Field/property in this shape.
          lastError: message,
          // List item in import/export/params.
          retries,
          // Field/property in this shape.
          updatedAt: Date.now(),
        });
        // Conditional branch for this case.
        if (status >= 500) { networkFailure = true; break; }
      }
    }

    // Conditional branch for this case.
    if (networkFailure) {
      // Invoke helper or pass arguments.
      markUnreachable();
      // Invoke helper or pass arguments.
      scheduleBackoff();
      // Return computed result to caller.
      return;
    // Open multi-line construct.
    } else {
      // Conditional branch for this case.
      if (!pendingRetry) markReachable({ cancelCommandRetry: true });
    }
    }
  // Open multi-line construct.
  } catch {
    // Assign value for subsequent use.
    networkFailure = true;
    // Invoke helper or pass arguments.
    markUnreachable();
    // Invoke helper or pass arguments.
    scheduleBackoff();
  // Open multi-line construct.
  } finally {
    // Revert any leftover sending rows (crash / early break) back to pending.
    if (ownsBinding()) {
      // Guard fallible work.
      try {
        // Local constant binding.
        const leftover = await (deps.listQueueForUserFn ?? listQueueForUser)(
          // List item in import/export/params.
          userId,
        );
        // Iterate collection / range.
        for (const row of leftover) {
          // Conditional branch for this case.
          if (row.status === "sending") {
            // Await async work before continuing.
            await (deps.putQueuedActionFn ?? putQueuedAction)({
              // Spread remaining fields/props.
              ...row,
              // Field/property in this shape.
              status: "pending",
              // Field/property in this shape.
              updatedAt: Date.now(),
            });
          }
        }
      // Open multi-line construct.
      } catch {
        /* ignore cleanup errors */
      }
    }
    // Invoke helper or pass arguments.
    setDraining(false);
    // Conditional branch for this case.
    if (pendingRetry && ownsBinding() && navigator.onLine) {
      // Arrow function / callback body.
      scheduleBackoff(() => { if (ownsBinding()) void drainQueue(deps); }, undefined, { keepOnReachable: true });
    }
    // Final banner mode from browser + unreachable latch.
    if (!navigator.onLine) {
      // Invoke helper or pass arguments.
      notify("offline");
    // Invoke helper or pass arguments.
    } else if (isApiUnreachable()) {
      // Invoke helper or pass arguments.
      notify("unreachable");
    // Open multi-line construct.
    } else {
      // Invoke helper or pass arguments.
      notify();
    }
  }
}
