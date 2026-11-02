/**
 * Offline session/status helpers without the drain side-effect module.
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
