import { notify, triggerDrain } from "./connState";
import { clearOfflineStores } from "./storage";

let activeUserId: string | null = null;
/** True while account-switch purge/lock is in progress — blocks reads/writes. */
let switching = false;
/** Serialize setOfflineUser so concurrent logout/login cannot interleave. */
let switchChain: Promise<void> = Promise.resolve();

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
    await clearOfflineStores();
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
    triggerDrain();
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
