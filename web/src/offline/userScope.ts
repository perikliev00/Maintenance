/**
 * Bind IndexedDB outbox/cache to the signed-in userId.
 *
 * On account change, lock writes, clear SW HTTP caches that may hold another
 * user's GETs, and purge private stores when leaving a previous user — so a
 * shared kiosk cannot show or sync the prior employee's offline work.
 */
import { notify, triggerDrain } from "./connState";
// Import dependency used by this module.
import { clearOfflineStores } from "./storage";

// Mutable local binding.
let activeUserId: string | null = null;
// A drain started before an account transition must not resume after A→B→A.
let bindingRevision = 0;

// Exported function entry point.
export function getOfflineBindingRevision(): number {
  // Return computed result to caller.
  return bindingRevision;
}
/** True while account-switch purge/lock is in progress — blocks reads/writes. */
let switching = false;
// Mutable local binding.
let pendingSwitches = 0;
/** Serialize setOfflineUser so concurrent logout/login cannot interleave. */
let switchChain: Promise<void> = Promise.resolve();

/** Clear shared Cache Storage entries that may hold authenticated GET bodies. */
export async function clearAuthenticatedHttpCaches(): Promise<void> {
  // Cache Storage may be missing in some test / non-secure contexts.
  if (typeof caches === "undefined") return;
  // Guard fallible work.
  try {
    // Local constant binding.
    const keys = await caches.keys();
    // Await async work before continuing.
    await Promise.all(
      // Identifier continuation in list.
      keys
        // Arrow function / callback body.
        .filter((k) => k === "api-get" || k.startsWith("api-get-"))
        // Arrow function / callback body.
        .map((k) => caches.delete(k)),
    );
  // Open multi-line construct.
  } catch {
    /* best-effort */
  }
}

/** Wipe all private IndexedDB outbox + My Work cache rows (shared-device safe). */
export async function purgePrivateOfflineData(): Promise<void> {
  // Guard fallible work.
  try {
    // Await async work before continuing.
    await clearOfflineStores();
  // Open multi-line construct.
  } catch {
    /* best-effort */
  }
}

/** Internal bind after serialization; locks writes for the duration of purge. */
async function applyOfflineUser(userId: string | null): Promise<void> {
  // No-op when already bound to the same user (avoids wipe on every render).
  if (activeUserId === userId && !switching) return;

  // Local constant binding.
  const previous = activeUserId;
  // Assign value for subsequent use.
  switching = true;
  // Guard fallible work.
  try {
    // Await async work before continuing.
    await clearAuthenticatedHttpCaches();
    // Purge when leaving a user (logout or A→B). Skip on initial bind null→id
    // so a reload does not wipe the signed-in user's own offline data.
    if (previous !== null && previous !== userId) {
      // Await async work before continuing.
      await purgePrivateOfflineData();
    }
    // Assign value for subsequent use.
    activeUserId = userId;
  // Open multi-line construct.
  } finally {
    // Assign value for subsequent use.
    switching = false;
  }

  // New user online → kick drain for any leftover same-user queue (rare).
  if (userId && typeof navigator !== "undefined" && navigator.onLine) {
    // Invoke helper or pass arguments.
    triggerDrain();
  }
  // Invoke helper or pass arguments.
  notify();
}

/**
 * Bind offline stores to a stable userId. On change: lock, clear shared HTTP
 * caches, purge private IndexedDB when leaving a previous user, then unlock.
 */
export function setOfflineUser(userId: string | null): void {
  // Conditional branch for this case.
  if (userId !== activeUserId || switching) bindingRevision++;
  // Lock immediately, before the serialized purge gets its first microtask.
  pendingSwitches++;
  // Serialize concurrent logout/login so purges cannot interleave.
  switchChain = switchChain
    // Arrow function / callback body.
    .then(() => applyOfflineUser(userId))
    // Arrow function / callback body.
    .catch(() => {
      // Assign value for subsequent use.
      switching = false;
    })
    // Arrow function / callback body.
    .finally(() => { pendingSwitches--; });
  // Fire-and-forget async/side effect.
  void switchChain;
}

/**
 * Logout / session clear: always purge private IndexedDB + HTTP caches and
 * clear active user (even if already null — covers killed-tab residue).
 */
export function clearPrivateOfflineState(): void {
  // Continue module logic.
  bindingRevision++;
  // Continue module logic.
  pendingSwitches++;
  // Assign value for subsequent use.
  switchChain = switchChain
    // Arrow function / callback body.
    .then(async () => {
      // Assign value for subsequent use.
      switching = true;
      // Guard fallible work.
      try {
        // Await async work before continuing.
        await clearAuthenticatedHttpCaches();
        // Await async work before continuing.
        await purgePrivateOfflineData();
        // Assign value for subsequent use.
        activeUserId = null;
      // Open multi-line construct.
      } finally {
        // Assign value for subsequent use.
        switching = false;
      }
      // Invoke helper or pass arguments.
      notify();
    })
    // Arrow function / callback body.
    .catch(() => {
      // Assign value for subsequent use.
      switching = false;
    })
    // Arrow function / callback body.
    .finally(() => { pendingSwitches--; });
  // Fire-and-forget async/side effect.
  void switchChain;
}

/** Currently bound user id for outbox scoping (null when logged out). */
export function getOfflineUser(): string | null {
  // Return computed result to caller.
  return activeUserId;
}

/** True while purge/bind is in flight — queueOps must refuse reads/writes. */
export function isOfflineSwitching(): boolean {
  // Return computed result to caller.
  return switching || pendingSwitches > 0;
}

/** Await the serialized switch chain (tests / callers that need settled bind). */
export function whenOfflineUserSettled(): Promise<void> {
  // Return computed result to caller.
  return switchChain;
}
