/**
 * Bind IndexedDB outbox/cache to the signed-in userId.
 *
 * On account change, lock writes, clear SW HTTP caches that may hold another
 * user's GETs, and purge private stores when leaving a previous user — so a
 * shared kiosk cannot show or sync the prior employee's offline work.
 */
import { notify, triggerDrain } from "./connState";
import { clearOfflineStores } from "./storage";

let activeUserId: string | null = null;
// A drain started before an account transition must not resume after A→B→A.
let bindingRevision = 0;

export function getOfflineBindingRevision(): number {
  return bindingRevision;
}
/** True while account-switch purge/lock is in progress — blocks reads/writes. */
let switching = false;
let pendingSwitches = 0;
/** Serialize setOfflineUser so concurrent logout/login cannot interleave. */
let switchChain: Promise<void> = Promise.resolve();

/** Clear shared Cache Storage entries that may hold authenticated GET bodies. */
export async function clearAuthenticatedHttpCaches(): Promise<void> {
  // Cache Storage may be missing in some test / non-secure contexts.
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

/** Internal bind after serialization; locks writes for the duration of purge. */
async function applyOfflineUser(userId: string | null): Promise<void> {
  // No-op when already bound to the same user (avoids wipe on every render).
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

  // New user online → kick drain for any leftover same-user queue (rare).
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
  if (userId !== activeUserId || switching) bindingRevision++;
  // Lock immediately, before the serialized purge gets its first microtask.
  pendingSwitches++;
  // Serialize concurrent logout/login so purges cannot interleave.
  switchChain = switchChain
    .then(() => applyOfflineUser(userId))
    .catch(() => {
      switching = false;
    })
    .finally(() => { pendingSwitches--; });
  void switchChain;
}

/**
 * Logout / session clear: always purge private IndexedDB + HTTP caches and
 * clear active user (even if already null — covers killed-tab residue).
 */
export function clearPrivateOfflineState(): void {
  bindingRevision++;
  pendingSwitches++;
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
    })
    .finally(() => { pendingSwitches--; });
  void switchChain;
}

/** Currently bound user id for outbox scoping (null when logged out). */
export function getOfflineUser(): string | null {
  return activeUserId;
}

/** True while purge/bind is in flight — queueOps must refuse reads/writes. */
export function isOfflineSwitching(): boolean {
  return switching || pendingSwitches > 0;
}

/** Await the serialized switch chain (tests / callers that need settled bind). */
export function whenOfflineUserSettled(): Promise<void> {
  return switchChain;
}
