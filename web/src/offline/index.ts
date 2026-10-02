export type ConnMode = "online" | "offline" | "syncing";

export type QueueStats = {
  pending: number;
  failed: number;
};

export type QueuedAction = {
  id: string;
  commandId: string;
  type: "cleaning.start" | "cleaning.complete" | "ticket.resolve" | "ticket.start";
  url: string;
  method: "POST";
  body: Record<string, unknown>;
  createdAt: number;
  status: "pending" | "failed" | "done";
  lastError: string | null;
  retries: number;
};

export type MyWorkCachePayload = {
  tasks: unknown[];
  tickets: unknown[];
  savedAt: number;
  hotelDate: string;
};

const DB_NAME = "meridian-offline";
const DB_VERSION = 1;
const QUEUE_STORE = "queue";
const CACHE_STORE = "cache";

type Listener = (state: { conn: ConnMode; stats: QueueStats }) => void;

const listeners = new Set<Listener>();
let draining = false;

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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
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

function notify(conn?: ConnMode) {
  void getQueueStats().then((stats) => {
    const mode: ConnMode =
      conn ??
      (typeof navigator !== "undefined" && !navigator.onLine
        ? "offline"
        : draining || stats.pending > 0
          ? "syncing"
          : "online");
    for (const listener of listeners) {
      listener({ conn: mode, stats });
    }
  });
}

export function subscribeOffline(listener: Listener): () => void {
  listeners.add(listener);
  notify();
  const onOnline = () => {
    notify("syncing");
    void drainQueue();
  };
  const onOffline = () => notify("offline");
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
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const store = tx.objectStore(QUEUE_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = (req.result as QueuedAction[]) ?? [];
      resolve({
        pending: rows.filter((r) => r.status === "pending").length,
        failed: rows.filter((r) => r.status === "failed").length,
      });
      db.close();
    };
    req.onerror = () => {
      reject(req.error);
      db.close();
    };
  });
}

async function enqueue(action: Omit<QueuedAction, "id" | "createdAt" | "status" | "lastError" | "retries"> & {
  id?: string;
}): Promise<QueuedAction> {
  const row: QueuedAction = {
    id: action.id ?? crypto.randomUUID(),
    commandId: action.commandId,
    type: action.type,
    url: action.url,
    method: action.method,
    body: action.body,
    createdAt: Date.now(),
    status: "pending",
    lastError: null,
    retries: 0,
  };
  await withStore(QUEUE_STORE, "readwrite", (store) => store.put(row));
  notify(navigator.onLine ? "syncing" : "offline");
  if (navigator.onLine) void drainQueue();
  return row;
}

export async function saveMyWorkCache(payload: MyWorkCachePayload): Promise<void> {
  await withStore(CACHE_STORE, "readwrite", (store) =>
    store.put({ key: "mywork", ...payload }),
  );
}

export async function loadMyWorkCache(): Promise<MyWorkCachePayload | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readonly");
    const store = tx.objectStore(CACHE_STORE);
    const req = store.get("mywork");
    req.onsuccess = () => {
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

async function postJson(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
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
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function drainQueue(): Promise<void> {
  if (draining || !navigator.onLine) return;
  draining = true;
  notify("syncing");
  try {
    const db = await openDb();
    const rows: QueuedAction[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, "readonly");
      const req = tx.objectStore(QUEUE_STORE).getAll();
      req.onsuccess = () => {
        resolve((req.result as QueuedAction[]) ?? []);
        db.close();
      };
      req.onerror = () => {
        reject(req.error);
        db.close();
      };
    });

    const pending = rows
      .filter((r) => r.status === "pending" || r.status === "failed")
      .sort((a, b) => a.createdAt - b.createdAt);

    if (pending.length === 0) return;

    // Prefer batch /sync/push when possible
    try {
      const commands = pending.map((item) => ({
        commandId: item.commandId,
        type: item.type,
        payload: {
          ...item.body,
          ...(item.type === "cleaning.start"
            ? { taskId: item.url.split("/tasks/")[1]?.split("/")[0] }
            : {}),
          ...(item.type === "cleaning.complete"
            ? { sessionId: item.url.split("/sessions/")[1]?.split("/")[0] }
            : {}),
          ...(item.type.startsWith("ticket.")
            ? { ticketId: item.url.split("/tickets/")[1]?.split("/")[0] }
            : {}),
        },
        clientTime: new Date(item.createdAt).toISOString(),
      }));
      const res = await fetch(`${apiBase()}/sync/push`, {
        method: "POST",
        credentials: "include",
        headers: authHeader(),
        body: JSON.stringify({ commands }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        results?: Array<{ commandId: string; status: string; message?: string }>;
      };
      if (res.ok && Array.isArray(data.results)) {
        for (const result of data.results) {
          const item = pending.find((p) => p.commandId === result.commandId);
          if (!item) continue;
          if (result.status === "ok" || result.status === "conflict") {
            await withStore(QUEUE_STORE, "readwrite", (store) =>
              store.delete(item.id),
            );
          } else if (result.status === "forbidden") {
            await withStore(QUEUE_STORE, "readwrite", (store) =>
              store.put({
                ...item,
                status: "failed",
                lastError: result.message ?? "forbidden",
                retries: item.retries + 1,
              }),
            );
          } else {
            await withStore(QUEUE_STORE, "readwrite", (store) =>
              store.put({
                ...item,
                status: item.retries + 1 >= 8 ? "failed" : "pending",
                lastError: result.message ?? "error",
                retries: item.retries + 1,
              }),
            );
          }
        }
        return;
      }
      if (res.status === 401) {
        notify("offline");
        return;
      }
    } catch {
      /* fall through to per-item */
    }

    for (const item of pending) {
      try {
        await postJson(item.url, item.body);
        await withStore(QUEUE_STORE, "readwrite", (store) => store.delete(item.id));
      } catch (err) {
        const status = (err as { status?: number }).status;
        const message = err instanceof Error ? err.message : "Sync failed";
        if (status === 401) {
          notify("offline");
          break;
        }
        const next: QueuedAction = {
          ...item,
          retries: item.retries + 1,
          lastError: message,
          status:
            status !== undefined && status >= 400 && status < 500 && status !== 409
              ? "failed"
              : item.retries + 1 >= 8
                ? "failed"
                : "pending",
        };
        if (status === 409) {
          await withStore(QUEUE_STORE, "readwrite", (store) => store.delete(item.id));
          continue;
        }
        await withStore(QUEUE_STORE, "readwrite", (store) => store.put(next));
        if (status === undefined || status >= 500) {
          break;
        }
      }
    }
  } finally {
    draining = false;
    notify(navigator.onLine ? "online" : "offline");
  }
}

export type QueuedResult = { queued: boolean; data?: unknown };

export async function startCleaningQueued(
  taskId: string,
  expectedVersion?: number,
): Promise<QueuedResult> {
  const commandId = crypto.randomUUID();
  const url = `${apiBase()}/cleaning/tasks/${taskId}/start`;
  const body: Record<string, unknown> = { commandId, expectedVersion };
  if (!navigator.onLine) {
    await enqueue({
      commandId,
      type: "cleaning.start",
      url,
      method: "POST",
      body,
    });
    return { queued: true };
  }
  try {
    const data = await postJson(url, body);
    return { queued: false, data };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === undefined || status >= 500) {
      await enqueue({
        commandId,
        type: "cleaning.start",
        url,
        method: "POST",
        body,
      });
      return { queued: true };
    }
    throw err;
  }
}

export async function completeCleaningQueued(
  sessionId: string,
  notes?: string,
): Promise<QueuedResult> {
  const commandId = crypto.randomUUID();
  const url = `${apiBase()}/cleaning/sessions/${sessionId}/complete`;
  const body: Record<string, unknown> = {
    commandId,
    ...(notes?.trim() ? { notes: notes.trim() } : {}),
  };
  if (!navigator.onLine) {
    await enqueue({
      commandId,
      type: "cleaning.complete",
      url,
      method: "POST",
      body,
    });
    return { queued: true };
  }
  try {
    const data = await postJson(url, body);
    return { queued: false, data };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === undefined || status >= 500) {
      await enqueue({
        commandId,
        type: "cleaning.complete",
        url,
        method: "POST",
        body,
      });
      return { queued: true };
    }
    throw err;
  }
}

export async function resolveTicketQueued(
  ticketId: string,
  resolutionNotes?: string,
): Promise<QueuedResult> {
  const commandId = crypto.randomUUID();
  const url = `${apiBase()}/maintenance/tickets/${ticketId}/resolve`;
  const body: Record<string, unknown> = {
    ...(resolutionNotes?.trim()
      ? { resolutionNotes: resolutionNotes.trim() }
      : {}),
    commandId,
  };
  if (!navigator.onLine) {
    await enqueue({
      commandId,
      type: "ticket.resolve",
      url,
      method: "POST",
      body,
    });
    return { queued: true };
  }
  try {
    const data = await postJson(url, body);
    return { queued: false, data };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === undefined || status >= 500) {
      await enqueue({
        commandId,
        type: "ticket.resolve",
        url,
        method: "POST",
        body,
      });
      return { queued: true };
    }
    throw err;
  }
}

/** Kick initial drain when module loads in browser. */
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void drainQueue();
  });
  if (navigator.onLine) {
    void drainQueue();
  }
}
