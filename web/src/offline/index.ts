import {
  canRebaseConflict,
  decideSyncResult,
  rebaseBodyWithCurrentVersion,
  shouldTreatForbiddenAsConflict,
} from "./conflict";

export type ConnMode = "online" | "offline" | "syncing" | "unreachable";

export type QueueActionStatus =
  | "pending"
  | "sending"
  | "conflict"
  | "failed";

export {
  canRebaseConflict,
  parseConflictDetails,
  entityIdFromQueued,
  rebaseBodyWithCurrentVersion,
} from "./conflict";

export type QueueStats = {
  pending: number;
  sending: number;
  conflict: number;
  failed: number;
};

export type QueueCommandType =
  | "cleaning.start"
  | "cleaning.complete"
  | "ticket.start"
  | "ticket.wait"
  | "ticket.resume"
  | "ticket.resolve"
  | "ticket.report";

export type QueuedAction = {
  id: string;
  userId: string;
  commandId: string;
  type: QueueCommandType;
  url: string;
  method: "POST";
  body: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  status: QueueActionStatus;
  lastError: string | null;
  conflictCode: string | null;
  conflictMessage: string | null;
  conflictDetails: unknown;
  retries: number;
};

export type MyWorkCachePayload = {
  tasks: unknown[];
  tickets: unknown[];
  savedAt: number;
  hotelDate: string;
};

const DB_NAME = "meridian-offline";
const DB_VERSION = 2;
const QUEUE_STORE = "queue";
const CACHE_STORE = "cache";
const REQUEST_TIMEOUT_MS = 8000;
const BACKOFF_MS = [2000, 5000, 15000] as const;
const MAX_RETRIES = 8;

type Listener = (state: { conn: ConnMode; stats: QueueStats }) => void;

const listeners = new Set<Listener>();
let draining = false;
let apiUnreachable = false;
let backoffAttempt = 0;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;
let activeUserId: string | null = null;
/** True while account-switch purge/lock is in progress — blocks reads/writes. */
let switching = false;
/** Serialize setOfflineUser so concurrent logout/login cannot interleave. */
let switchChain: Promise<void> = Promise.resolve();

function apiBase(): string {
  return import.meta.env.VITE_API_URL ?? "/api";
}

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|; )csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function authHeader(): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}

function cacheKeyFor(userId: string): string {
  return `mywork:${userId}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          const queue = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
          queue.createIndex("userId", "userId", { unique: false });
          queue.createIndex("userId_status", ["userId", "status"], {
            unique: false,
          });
        }
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE, { keyPath: "key" });
        }
      }

      if (oldVersion > 0 && oldVersion < 2) {
        // Drop unscoped v1 data — ownership cannot be attributed safely.
        if (db.objectStoreNames.contains(QUEUE_STORE)) {
          db.deleteObjectStore(QUEUE_STORE);
        }
        if (db.objectStoreNames.contains(CACHE_STORE)) {
          db.deleteObjectStore(CACHE_STORE);
        }
        const queue = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        queue.createIndex("userId", "userId", { unique: false });
        queue.createIndex("userId_status", ["userId", "status"], {
          unique: false,
        });
        db.createObjectStore(CACHE_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    tx.oncomplete = () => {
      resolve(req ? (req.result as T) : undefined);
      db.close();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
      db.close();
    };
  });
}

async function putQueuedAction(row: QueuedAction): Promise<void> {
  await withStore(QUEUE_STORE, "readwrite", (store) => store.put(row));
}

async function deleteQueuedAction(id: string): Promise<void> {
  await withStore(QUEUE_STORE, "readwrite", (store) => store.delete(id));
}

async function listQueueForUser(userId: string): Promise<QueuedAction[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const store = tx.objectStore(QUEUE_STORE);
    const index = store.index("userId");
    const req = index.getAll(userId);
    req.onsuccess = () => {
      resolve((req.result as QueuedAction[]) ?? []);
      db.close();
    };
    req.onerror = () => {
      reject(req.error);
      db.close();
    };
  });
}

function resolveConn(conn?: ConnMode, stats?: QueueStats): ConnMode {
  if (conn) return conn;
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  if (apiUnreachable) return "unreachable";
  const inflight = (stats?.pending ?? 0) + (stats?.sending ?? 0);
  if (draining || inflight > 0) return "syncing";
  return "online";
}

function notify(conn?: ConnMode) {
  void getQueueStats().then((stats) => {
    const mode = resolveConn(conn, stats);
    for (const listener of listeners) {
      listener({ conn: mode, stats });
    }
  });
}

function markReachable() {
  apiUnreachable = false;
  backoffAttempt = 0;
  if (backoffTimer) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
}

function markUnreachable() {
  apiUnreachable = true;
  notify("unreachable");
}

function scheduleBackoff() {
  if (backoffTimer || typeof window === "undefined") return;
  const delay = BACKOFF_MS[Math.min(backoffAttempt, BACKOFF_MS.length - 1)]!;
  backoffAttempt += 1;
  backoffTimer = setTimeout(() => {
    backoffTimer = null;
    void drainQueue();
  }, delay);
}

function isQueueableError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status === undefined) return true;
  return status >= 500;
}

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

/** Clear shared Cache Storage entries that may hold authenticated GET bodies. */
export async function clearAuthenticatedHttpCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k === "api-get" || k.startsWith("api-get-"))
        .map((k) => caches.delete(k)),
    );
  } catch {
    /* best-effort */
  }
}

/** Wipe all private IndexedDB outbox + My Work cache rows (shared-device safe). */
export async function purgePrivateOfflineData(): Promise<void> {
  try {
    await withStore(QUEUE_STORE, "readwrite", (store) => store.clear());
    await withStore(CACHE_STORE, "readwrite", (store) => store.clear());
  } catch {
    /* best-effort */
  }
}

async function applyOfflineUser(userId: string | null): Promise<void> {
  if (activeUserId === userId && !switching) return;

  const previous = activeUserId;
  switching = true;
  try {
    await clearAuthenticatedHttpCaches();
    // Purge when leaving a user (logout or A→B). Skip on initial bind null→id
    // so a reload does not wipe the signed-in user's own offline data.
    if (previous !== null && previous !== userId) {
      await purgePrivateOfflineData();
    }
    activeUserId = userId;
  } finally {
    switching = false;
  }

  if (userId && typeof navigator !== "undefined" && navigator.onLine) {
    void drainQueue();
  }
  notify();
}

/**
 * Bind offline stores to a stable userId. On change: lock, clear shared HTTP
 * caches, purge private IndexedDB when leaving a previous user, then unlock.
 */
export function setOfflineUser(userId: string | null): void {
  switchChain = switchChain
    .then(() => applyOfflineUser(userId))
    .catch(() => {
      switching = false;
    });
  void switchChain;
}

/**
 * Logout / session clear: always purge private IndexedDB + HTTP caches and
 * clear active user (even if already null — covers killed-tab residue).
 */
export function clearPrivateOfflineState(): void {
  switchChain = switchChain
    .then(async () => {
      switching = true;
      try {
        await clearAuthenticatedHttpCaches();
        await purgePrivateOfflineData();
        activeUserId = null;
      } finally {
        switching = false;
      }
      notify();
    })
    .catch(() => {
      switching = false;
    });
  void switchChain;
}

export function getOfflineUser(): string | null {
  return activeUserId;
}

export function isOfflineSwitching(): boolean {
  return switching;
}

export function subscribeOffline(listener: Listener): () => void {
  listeners.add(listener);
  notify();
  const onOnline = () => {
    markReachable();
    notify("syncing");
    void drainQueue();
  };
  const onOffline = () => {
    markReachable();
    apiUnreachable = false;
    notify("offline");
  };
  const onVis = () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      void drainQueue();
    }
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVis);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVis);
  };
}

export async function getQueueStats(): Promise<QueueStats> {
  if (switching || !activeUserId) return emptyStats();
  const rows = await listQueueForUser(activeUserId);
  return statsFromRows(rows);
}

export async function listQueuedActions(
  statuses?: QueueActionStatus[],
): Promise<QueuedAction[]> {
  if (switching || !activeUserId) return [];
  const rows = await listQueueForUser(activeUserId);
  const filtered = statuses
    ? rows.filter((r) => statuses.includes(r.status))
    : rows;
  return filtered.sort((a, b) => a.createdAt - b.createdAt);
}

async function enqueue(
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
  if (switching || !activeUserId) {
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
    !navigator.onLine ? "offline" : apiUnreachable ? "unreachable" : "syncing",
  );
  if (navigator.onLine) void drainQueue();
  return row;
}

export async function saveMyWorkCache(
  payload: MyWorkCachePayload,
): Promise<void> {
  if (switching || !activeUserId) return;
  await withStore(CACHE_STORE, "readwrite", (store) =>
    store.put({ key: cacheKeyFor(activeUserId!), ...payload }),
  );
}

export async function loadMyWorkCache(): Promise<MyWorkCachePayload | null> {
  if (switching || !activeUserId) return null;
  const userId = activeUserId;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readonly");
    const store = tx.objectStore(CACHE_STORE);
    const req = store.get(cacheKeyFor(userId));
    req.onsuccess = () => {
      // Drop result if account switched mid-read.
      if (switching || activeUserId !== userId) {
        resolve(null);
        db.close();
        return;
      }
      const row = req.result as (MyWorkCachePayload & { key: string }) | undefined;
      if (!row) {
        resolve(null);
      } else {
        const { key: _k, ...rest } = row;
        resolve(rest);
      }
      db.close();
    };
    req.onerror = () => {
      reject(req.error);
      db.close();
    };
  });
}

export async function dismissQueuedAction(id: string): Promise<void> {
  await resolveQueuedAction(id, { mode: "dismiss" });
}

/**
 * Blind retry (same payload). Prefer `resolveQueuedAction({ mode: "rebase" })`
 * for version_conflict so expectedVersion is advanced.
 */
export async function retryQueuedAction(id: string): Promise<void> {
  if (switching || !activeUserId) return;
  const rows = await listQueueForUser(activeUserId);
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
  if (navigator.onLine) void drainQueue();
}

export async function resolveQueuedAction(
  id: string,
  opts: { mode: "rebase" | "dismiss" },
): Promise<boolean> {
  if (switching || !activeUserId) return false;
  const rows = await listQueueForUser(activeUserId);
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
  if (navigator.onLine) void drainQueue();
  return true;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      const timeoutErr = new Error("Request timed out") as Error & {
        status?: number;
      };
      timeoutErr.status = undefined;
      throw timeoutErr;
    }
    const networkErr = new Error(
      err instanceof Error ? err.message : "Network error",
    ) as Error & { status?: number };
    networkErr.status = undefined;
    throw networkErr;
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(url: string, body: Record<string, unknown>) {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    credentials: "include",
    headers: authHeader(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (data as { message?: string; error?: string }).message ??
      (data as { error?: string }).error ??
      `HTTP ${res.status}`;
    const err = new Error(message) as Error & {
      status?: number;
      code?: string;
      details?: unknown;
    };
    err.status = res.status;
    err.code = (data as { error?: string }).error;
    err.details = (data as { details?: unknown }).details;
    throw err;
  }
  markReachable();
  return data;
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

function recoverOrphanedSending(rows: QueuedAction[]): QueuedAction[] {
  const now = Date.now();
  return rows.map((row) => {
    if (row.status === "sending") {
      return { ...row, status: "pending" as const, updatedAt: now };
    }
    return row;
  });
}

type SyncPushResult = {
  commandId: string;
  status: string;
  message?: string;
  code?: string;
  details?: unknown;
};

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
  if (draining || switching || !navigator.onLine || !activeUserId) return;
  draining = true;
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

    // Prefer batch /sync/push when possible
    try {
      const commands = sending.map((item) => ({
        commandId: item.commandId,
        type: item.type,
        payload: commandPayload(item),
        clientTime: new Date(item.createdAt).toISOString(),
      }));
      const res = await fetchWithTimeout(`${apiBase()}/sync/push`, {
        method: "POST",
        credentials: "include",
        headers: authHeader(),
        body: JSON.stringify({ commands }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        results?: SyncPushResult[];
      };
      if (res.ok && Array.isArray(data.results)) {
        for (const result of data.results) {
          const item = sending.find((p) => p.commandId === result.commandId);
          if (!item) continue;
          await applySyncResult(item, result);
        }
        markReachable();
        return;
      }
      if (res.status === 401) {
        // Revert sending → pending so they can retry after re-auth
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
    if (activeUserId === userId) {
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
    draining = false;
    if (!navigator.onLine) {
      notify("offline");
    } else if (apiUnreachable) {
      notify("unreachable");
    } else {
      notify();
    }
  }
}

export type QueuedResult = { queued: boolean; data?: unknown };

async function runOrEnqueue(
  type: QueueCommandType,
  url: string,
  body: Record<string, unknown>,
): Promise<QueuedResult> {
  const commandId = String(body.commandId ?? crypto.randomUUID());
  const payload = { ...body, commandId };
  if (!navigator.onLine || apiUnreachable) {
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
  return runOrEnqueue(
    "cleaning.start",
    `${apiBase()}/cleaning/tasks/${taskId}/start`,
    { commandId: crypto.randomUUID(), expectedVersion },
  );
}

export async function completeCleaningQueued(
  sessionId: string,
  notes?: string,
  expectedVersion?: number,
): Promise<QueuedResult> {
  return runOrEnqueue(
    "cleaning.complete",
    `${apiBase()}/cleaning/sessions/${sessionId}/complete`,
    {
      commandId: crypto.randomUUID(),
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    },
  );
}

export async function startTicketQueued(ticketId: string): Promise<QueuedResult> {
  return runOrEnqueue(
    "ticket.start",
    `${apiBase()}/maintenance/tickets/${ticketId}/start`,
    { commandId: crypto.randomUUID() },
  );
}

export async function waitTicketQueued(
  ticketId: string,
  reason?: string,
): Promise<QueuedResult> {
  return runOrEnqueue(
    "ticket.wait",
    `${apiBase()}/maintenance/tickets/${ticketId}/wait`,
    {
      commandId: crypto.randomUUID(),
      ...(reason?.trim() ? { reason: reason.trim() } : {}),
    },
  );
}

export async function resumeTicketQueued(
  ticketId: string,
): Promise<QueuedResult> {
  return runOrEnqueue(
    "ticket.resume",
    `${apiBase()}/maintenance/tickets/${ticketId}/resume`,
    { commandId: crypto.randomUUID() },
  );
}

export async function resolveTicketQueued(
  ticketId: string,
  resolutionNotes?: string,
): Promise<QueuedResult> {
  return runOrEnqueue(
    "ticket.resolve",
    `${apiBase()}/maintenance/tickets/${ticketId}/resolve`,
    {
      commandId: crypto.randomUUID(),
      ...(resolutionNotes?.trim()
        ? { resolutionNotes: resolutionNotes.trim() }
        : {}),
    },
  );
}

export async function reportTicketQueued(input: {
  locationId: string;
  title?: string;
  issueOptionId?: string;
  categoryId?: string;
  priority?: string;
  blocksRoom: boolean;
}): Promise<QueuedResult> {
  return runOrEnqueue("ticket.report", `${apiBase()}/maintenance/tickets`, {
    commandId: crypto.randomUUID(),
    locationId: input.locationId,
    blocksRoom: input.blocksRoom,
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    ...(input.issueOptionId ? { issueOptionId: input.issueOptionId } : {}),
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
  });
}

/** Kick initial drain when module loads in browser. */
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    markReachable();
    void drainQueue();
  });
  if (navigator.onLine) {
    void drainQueue();
  }
}
