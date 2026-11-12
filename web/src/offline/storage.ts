/**
 * IndexedDB persistence for the per-user outbox and My Work cache.
 *
 * DB v2 rebuilds stores so legacy unscoped v1 rows cannot be attributed to a
 * user after a shared-device login (safer to drop than to guess ownership).
 */
export type QueueActionStatus =
  // Union/intersection type member.
  | "pending"
  // Union/intersection type member.
  | "sending"
  // Union/intersection type member.
  | "conflict"
  // Union/intersection type member.
  | "failed";

// Export type alias for consumers.
export type QueueCommandType =
  // Union/intersection type member.
  | "cleaning.start"
  // Union/intersection type member.
  | "cleaning.complete"
  // Union/intersection type member.
  | "ticket.start"
  // Union/intersection type member.
  | "ticket.wait"
  // Union/intersection type member.
  | "ticket.resume"
  // Union/intersection type member.
  | "ticket.resolve"
  // Union/intersection type member.
  | "ticket.report"
  // Union/intersection type member.
  | "ticket.assign"
  // Union/intersection type member.
  | "ticket.close"
  // Union/intersection type member.
  | "ticket.reopen";

/** One idempotent command waiting to sync (`commandId` is the server dedupe key). */
export type QueuedAction = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  userId: string;
  // Field/property in this shape.
  commandId: string;
  // Field/property in this shape.
  type: QueueCommandType;
  // Field/property in this shape.
  url: string;
  // Field/property in this shape.
  method: "POST";
  // Field/property in this shape.
  body: Record<string, unknown>;
  // Field/property in this shape.
  createdAt: number;
  // Field/property in this shape.
  updatedAt: number;
  // Field/property in this shape.
  status: QueueActionStatus;
  // Field/property in this shape.
  lastError: string | null;
  // Field/property in this shape.
  conflictCode: string | null;
  // Field/property in this shape.
  conflictMessage: string | null;
  // Field/property in this shape.
  conflictDetails: unknown;
  // Field/property in this shape.
  retries: number;
  /** Persisted insertion order, allocated atomically per user even for tied clocks. */
  sequence?: number;
};

/** Last-known My Work lists for offline UI when live fetches fail. */
export type MyWorkCachePayload = {
  // Field/property in this shape.
  tasks: unknown[];
  // Field/property in this shape.
  tickets: unknown[];
  // Field/property in this shape.
  savedAt: number;
  // Field/property in this shape.
  hotelDate: string;
};

// Local constant binding.
const DB_NAME = "meridian-offline";
// Local constant binding.
const DB_VERSION = 2;
// Local constant binding.
const QUEUE_STORE = "queue";
// Local constant binding.
const CACHE_STORE = "cache";

/** Cache store key so My Work snapshots stay per-user. */
function cacheKeyFor(userId: string): string {
  // Return computed result to caller.
  return `mywork:${userId}`;
}

/** Open (and upgrade) the offline IndexedDB; closes are owned by callers. */
function openDb(): Promise<IDBDatabase> {
  // Bare `indexedDB` throws ReferenceError in Node (tsx unit tests / SSR).
  const idb = globalThis.indexedDB;
  // Conditional branch for this case.
  if (!idb) {
    // Return computed result to caller.
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  // Return computed result to caller.
  return new Promise((resolve, reject) => {
    // Local constant binding.
    const req = idb.open(DB_NAME, DB_VERSION);
    // Arrow function / callback body.
    req.onupgradeneeded = (event) => {
      // Local constant binding.
      const db = req.result;
      // Local constant binding.
      const oldVersion = event.oldVersion;

      // Fresh install: create scoped queue + cache stores.
      if (oldVersion < 1) {
        // Conditional branch for this case.
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          // Local constant binding.
          const queue = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
          // Invoke helper or pass arguments.
          queue.createIndex("userId", "userId", { unique: false });
          // Open multi-line construct.
          queue.createIndex("userId_status", ["userId", "status"], {
            // Field/property in this shape.
            unique: false,
          });
        }
        // Conditional branch for this case.
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          // Invoke helper or pass arguments.
          db.createObjectStore(CACHE_STORE, { keyPath: "key" });
        }
      }

      // Conditional branch for this case.
      if (oldVersion > 0 && oldVersion < 2) {
        // Drop unscoped v1 data — ownership cannot be attributed safely.
        if (db.objectStoreNames.contains(QUEUE_STORE)) {
          // Invoke helper or pass arguments.
          db.deleteObjectStore(QUEUE_STORE);
        }
        // Conditional branch for this case.
        if (db.objectStoreNames.contains(CACHE_STORE)) {
          // Invoke helper or pass arguments.
          db.deleteObjectStore(CACHE_STORE);
        }
        // Local constant binding.
        const queue = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        // Invoke helper or pass arguments.
        queue.createIndex("userId", "userId", { unique: false });
        // Open multi-line construct.
        queue.createIndex("userId_status", ["userId", "status"], {
          // Field/property in this shape.
          unique: false,
        });
        // Invoke helper or pass arguments.
        db.createObjectStore(CACHE_STORE, { keyPath: "key" });
      }
    };
    // Arrow function / callback body.
    req.onsuccess = () => resolve(req.result);
    // Arrow function / callback body.
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

/** Run one request inside a transaction and close the DB when it completes. */
async function withStore<T>(
  // Field/property in this shape.
  storeName: string,
  // Field/property in this shape.
  mode: IDBTransactionMode,
  // Arrow function / callback body.
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
// Open multi-line construct.
): Promise<T | undefined> {
  // Local constant binding.
  const db = await openDb();
  // Return computed result to caller.
  return new Promise((resolve, reject) => {
    // Local constant binding.
    const tx = db.transaction(storeName, mode);
    // Local constant binding.
    const store = tx.objectStore(storeName);
    // Mutable local binding.
    let req: IDBRequest<T> | void;
    // Arrow function / callback body.
    tx.oncomplete = () => {
      // Invoke helper or pass arguments.
      resolve(req ? (req.result as T) : undefined);
      // Invoke helper or pass arguments.
      db.close();
    };
    // Arrow function / callback body.
    tx.onerror = tx.onabort = () => {
      // Invoke helper or pass arguments.
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
      // Invoke helper or pass arguments.
      db.close();
    };
    // Guard fallible work.
    try { req = fn(store); }
    // Handle failure from try block.
    catch (error) { tx.abort(); db.close(); reject(error); }
  });
}

/** Upsert one outbox row (id is the primary key). */
export async function putQueuedAction(row: QueuedAction): Promise<void> {
  // Local constant binding.
  const db = await openDb();
  // Return computed result to caller.
  return new Promise<void>((resolve, reject) => {
    // Local constant binding.
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    // Local constant binding.
    const store = tx.objectStore(QUEUE_STORE);
    // Arrow function / callback body.
    tx.oncomplete = () => { db.close(); resolve(); };
    // Arrow function / callback body.
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error("IndexedDB transaction failed")); };
    // Const arrow/function binding.
    const fail = (error: unknown) => { tx.abort(); db.close(); reject(error); };
    // Local constant binding.
    const existing = store.get(row.id);
    // Arrow function / callback body.
    existing.onsuccess = () => {
      // Guard fallible work.
      try {
      // Local constant binding.
      const previous = existing.result as QueuedAction | undefined;
      // Conditional branch for this case.
      if (previous?.sequence !== undefined) {
        // Invoke helper or pass arguments.
        store.put({ ...row, sequence: previous.sequence });
        // Return computed result to caller.
        return;
      }
      // Local constant binding.
      const rows = store.index("userId").getAll(row.userId);
      // Arrow function / callback body.
      rows.onsuccess = () => {
        // Guard fallible work.
        try {
        // Const arrow/function binding.
        const max = (rows.result as QueuedAction[]).reduce((value, item) => Math.max(value, item.sequence ?? 0), 0);
        // Invoke helper or pass arguments.
        store.put({ ...row, sequence: max + 1 });
        // Invoke helper or pass arguments.
        } catch (error) { fail(error); }
      };
      // Invoke helper or pass arguments.
      } catch (error) { fail(error); }
    };
  });
}

/** Legacy rows retain chronological ordering; new rows also order tied clocks. */
export function compareQueuedActions(a: QueuedAction, b: QueuedAction): number {
  // Conditional branch for this case.
  if (a.sequence !== undefined && b.sequence !== undefined) return a.sequence - b.sequence;
  // Return computed result to caller.
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Remove one outbox row after successful sync or dismiss. */
export async function deleteQueuedAction(id: string): Promise<void> {
  // Await async work before continuing.
  await withStore(QUEUE_STORE, "readwrite", (store) => store.delete(id));
}

/** All queue rows for one user (caller filters by status). */
export async function listQueueForUser(userId: string): Promise<QueuedAction[]> {
  // Local constant binding.
  const db = await openDb();
  // Return computed result to caller.
  return new Promise((resolve, reject) => {
    // Local constant binding.
    const tx = db.transaction(QUEUE_STORE, "readonly");
    // Local constant binding.
    const store = tx.objectStore(QUEUE_STORE);
    // Index lookup — never scan other users' rows.
    const index = store.index("userId");
    // Local constant binding.
    const req = index.getAll(userId);
    // Arrow function / callback body.
    req.onsuccess = () => {
      // Invoke helper or pass arguments.
      resolve((req.result as QueuedAction[]) ?? []);
      // Invoke helper or pass arguments.
      db.close();
    };
    // Arrow function / callback body.
    req.onerror = () => {
      // Invoke helper or pass arguments.
      reject(req.error);
      // Invoke helper or pass arguments.
      db.close();
    };
  });
}

/** Wipe entire queue + cache stores (logout / account switch purge). */
export async function clearOfflineStores(): Promise<void> {
  // Await async work before continuing.
  await withStore(QUEUE_STORE, "readwrite", (store) => store.clear());
  // Await async work before continuing.
  await withStore(CACHE_STORE, "readwrite", (store) => store.clear());
}

/** Persist My Work snapshot under the per-user cache key. */
export async function writeMyWorkCache(
  // Field/property in this shape.
  userId: string,
  // Field/property in this shape.
  payload: MyWorkCachePayload,
// Open multi-line construct.
): Promise<void> {
  // Await async work before continuing.
  await withStore(CACHE_STORE, "readwrite", (store) =>
    // Invoke helper or pass arguments.
    store.put({ key: cacheKeyFor(userId), ...payload }),
  );
}

/** Load My Work snapshot; strips the internal `key` field before returning. */
export async function readMyWorkCache(
  // Field/property in this shape.
  userId: string,
// Open multi-line construct.
): Promise<MyWorkCachePayload | null> {
  // Local constant binding.
  const db = await openDb();
  // Return computed result to caller.
  return new Promise((resolve, reject) => {
    // Local constant binding.
    const tx = db.transaction(CACHE_STORE, "readonly");
    // Local constant binding.
    const store = tx.objectStore(CACHE_STORE);
    // Local constant binding.
    const req = store.get(cacheKeyFor(userId));
    // Arrow function / callback body.
    req.onsuccess = () => {
      // Local constant binding.
      const row = req.result as (MyWorkCachePayload & { key: string }) | undefined;
      // Conditional branch for this case.
      if (!row) {
        // Invoke helper or pass arguments.
        resolve(null);
      // Open multi-line construct.
      } else {
        // Drop the store key so callers see only the payload shape.
        const { key: _k, ...rest } = row;
        // Invoke helper or pass arguments.
        resolve(rest);
      }
      // Invoke helper or pass arguments.
      db.close();
    };
    // Arrow function / callback body.
    req.onerror = () => {
      // Invoke helper or pass arguments.
      reject(req.error);
      // Invoke helper or pass arguments.
      db.close();
    };
  });
}
