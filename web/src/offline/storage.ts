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

export async function putQueuedAction(row: QueuedAction): Promise<void> {
  await withStore(QUEUE_STORE, "readwrite", (store) => store.put(row));
}

export async function deleteQueuedAction(id: string): Promise<void> {
  await withStore(QUEUE_STORE, "readwrite", (store) => store.delete(id));
}

export async function listQueueForUser(userId: string): Promise<QueuedAction[]> {
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

export async function clearOfflineStores(): Promise<void> {
  await withStore(QUEUE_STORE, "readwrite", (store) => store.clear());
  await withStore(CACHE_STORE, "readwrite", (store) => store.clear());
}

export async function writeMyWorkCache(
  userId: string,
  payload: MyWorkCachePayload,
): Promise<void> {
  await withStore(CACHE_STORE, "readwrite", (store) =>
    store.put({ key: cacheKeyFor(userId), ...payload }),
  );
}

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
