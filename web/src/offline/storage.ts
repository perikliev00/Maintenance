/**
 * IndexedDB persistence for the per-user outbox and My Work cache.
 *
 * DB v2 rebuilds stores so legacy unscoped v1 rows cannot be attributed to a
 * user after a shared-device login (safer to drop than to guess ownership).
 */
export type QueueActionStatus =
  | "pending"
  | "sending"
  | "conflict"
  | "failed";

export type QueueCommandType =
  | "cleaning.start"
  | "cleaning.complete"
  | "ticket.start"
  | "ticket.wait"
  | "ticket.resume"
  | "ticket.resolve"
  | "ticket.report"
  | "ticket.assign"
  | "ticket.close"
  | "ticket.reopen";

/** One idempotent command waiting to sync (`commandId` is the server dedupe key). */
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
  /** Persisted insertion order, allocated atomically per user even for tied clocks. */
  sequence?: number;
};

/** Last-known My Work lists for offline UI when live fetches fail. */
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

/** Cache store key so My Work snapshots stay per-user. */
function cacheKeyFor(userId: string): string {
  return `mywork:${userId}`;
}

/** Open (and upgrade) the offline IndexedDB; closes are owned by callers. */
function openDb(): Promise<IDBDatabase> {
  // Bare `indexedDB` throws ReferenceError in Node (tsx unit tests / SSR).
  const idb = globalThis.indexedDB;
  if (!idb) {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;

      // Fresh install: create scoped queue + cache stores.
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

/** Run one request inside a transaction and close the DB when it completes. */
async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let req: IDBRequest<T> | void;
    tx.oncomplete = () => {
      resolve(req ? (req.result as T) : undefined);
      db.close();
    };
    tx.onerror = tx.onabort = () => {
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
      db.close();
    };
    try { req = fn(store); }
    catch (error) { tx.abort(); db.close(); reject(error); }
  });
}

/** Upsert one outbox row (id is the primary key). */
export async function putQueuedAction(row: QueuedAction): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    const store = tx.objectStore(QUEUE_STORE);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error("IndexedDB transaction failed")); };
    const fail = (error: unknown) => { tx.abort(); db.close(); reject(error); };
    const existing = store.get(row.id);
    existing.onsuccess = () => {
      try {
      const previous = existing.result as QueuedAction | undefined;
      if (previous?.sequence !== undefined) {
        store.put({ ...row, sequence: previous.sequence });
        return;
      }
      const rows = store.index("userId").getAll(row.userId);
      rows.onsuccess = () => {
        try {
        const max = (rows.result as QueuedAction[]).reduce((value, item) => Math.max(value, item.sequence ?? 0), 0);
        store.put({ ...row, sequence: max + 1 });
        } catch (error) { fail(error); }
      };
      } catch (error) { fail(error); }
    };
  });
}

/** Legacy rows retain chronological ordering; new rows also order tied clocks. */
export function compareQueuedActions(a: QueuedAction, b: QueuedAction): number {
  if (a.sequence !== undefined && b.sequence !== undefined) return a.sequence - b.sequence;
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Remove one outbox row after successful sync or dismiss. */
export async function deleteQueuedAction(id: string): Promise<void> {
  await withStore(QUEUE_STORE, "readwrite", (store) => store.delete(id));
}

/** All queue rows for one user (caller filters by status). */
export async function listQueueForUser(userId: string): Promise<QueuedAction[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const store = tx.objectStore(QUEUE_STORE);
    // Index lookup — never scan other users' rows.
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

/** Wipe entire queue + cache stores (logout / account switch purge). */
export async function clearOfflineStores(): Promise<void> {
  await withStore(QUEUE_STORE, "readwrite", (store) => store.clear());
  await withStore(CACHE_STORE, "readwrite", (store) => store.clear());
}

/** Persist My Work snapshot under the per-user cache key. */
export async function writeMyWorkCache(
  userId: string,
  payload: MyWorkCachePayload,
): Promise<void> {
  await withStore(CACHE_STORE, "readwrite", (store) =>
    store.put({ key: cacheKeyFor(userId), ...payload }),
  );
}

/** Load My Work snapshot; strips the internal `key` field before returning. */
export async function readMyWorkCache(
  userId: string,
): Promise<MyWorkCachePayload | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readonly");
    const store = tx.objectStore(CACHE_STORE);
    const req = store.get(cacheKeyFor(userId));
    req.onsuccess = () => {
      const row = req.result as (MyWorkCachePayload & { key: string }) | undefined;
      if (!row) {
        resolve(null);
      } else {
        // Drop the store key so callers see only the payload shape.
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
