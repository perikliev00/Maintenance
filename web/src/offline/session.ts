/**
 * Offline session/status helpers without the drain side-effect module.
 */
export type { ConnMode, QueueStats } from "./connState";
// Re-export selected public symbols.
export { subscribeOffline } from "./connState";

export type {
  MyWorkCachePayload,
  QueueActionStatus,
  QueueCommandType,
  QueuedAction,
} from "./storage";

// Re-export selected public symbols.
export {
  canRebaseConflict,
  parseConflictDetails,
  entityIdFromQueued,
  rebaseBodyWithCurrentVersion,
} from "./conflict";

// Re-export selected public symbols.
export {
  clearAuthenticatedHttpCaches,
  clearPrivateOfflineState,
  getOfflineUser,
  isOfflineSwitching,
  purgePrivateOfflineData,
  setOfflineUser,
  whenOfflineUserSettled,
} from "./userScope";

// Re-export selected public symbols.
export { postJsonWithSessionRefresh } from "./transport";

// Re-export selected public symbols.
export {
  getQueueStats,
  listQueuedActions,
  loadMyWorkCache,
  resolveQueuedAction,
  retryQueuedAction,
  saveMyWorkCache,
} from "./queueOps";
