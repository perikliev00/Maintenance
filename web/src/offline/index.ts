/**
 * Offline outbox public API.
 *
 * Housekeeping/ticket mutations can enqueue into IndexedDB when offline or when
 * the API is unreachable, then drain via `/sync/push` (or per-item POST) once
 * connectivity returns. Bind the active user with `setOfflineUser` so queues
 * never leak across accounts on a shared device.
 */
export type { ConnMode, QueueStats } from "./connState";
export { subscribeOffline } from "./connState";

export type {
  MyWorkCachePayload,
  QueueActionStatus,
  QueueCommandType,
  QueuedAction,
} from "./storage";

export {
  canRebaseConflict,
  parseConflictDetails,
  entityIdFromQueued,
  rebaseBodyWithCurrentVersion,
} from "./conflict";

export {
  clearAuthenticatedHttpCaches,
  clearPrivateOfflineState,
  getOfflineUser,
  isOfflineSwitching,
  purgePrivateOfflineData,
  setOfflineUser,
  whenOfflineUserSettled,
} from "./userScope";

export { postJsonWithSessionRefresh } from "./transport";

export {
  getQueueStats,
  listQueuedActions,
  loadMyWorkCache,
  resolveQueuedAction,
  retryQueuedAction,
  saveMyWorkCache,
} from "./queueOps";

export { drainQueue } from "./queueDrain";

export type { QueuedResult } from "./runOrEnqueue";
export {
  completeCleaningQueued,
  reportTicketQueued,
  resolveTicketQueued,
  resumeTicketQueued,
  startCleaningQueued,
  startTicketQueued,
  waitTicketQueued,
} from "./runOrEnqueue";

import { markReachable } from "./connState";
import { drainQueue } from "./queueDrain";

/**
 * Kick an initial drain when this module loads in the browser.
 * Also re-drains on `online` so queued work resumes without waiting for UI.
 */
// Browser-only side effect: wire connectivity → outbox drain (no-op under SSR).
if (typeof window !== "undefined") {
  // Resume drain whenever the browser reports connectivity restored.
  window.addEventListener("online", () => {
    markReachable();
    void drainQueue();
  });
  // Kick an initial drain if we already appear online at module load.
  if (navigator.onLine) {
    void drainQueue();
  }
}
