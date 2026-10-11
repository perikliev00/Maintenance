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
} from "./userScope";

export { postJsonWithSessionRefresh } from "./transport";

export {
  dismissQueuedAction,
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
