/**
 * Offline outbox public API (compat barrel).
 *
 * Prefer `./mutations` (queued writes) or `./session` (status/userScope) from
 * pages so Vite can split `queueDrain`. Import `./drainBoot` only from app boot.
 */
export type { ConnMode, QueueStats } from "./session";
// Re-export selected public symbols.
export {
  subscribeOffline,
  canRebaseConflict,
  parseConflictDetails,
  entityIdFromQueued,
  rebaseBodyWithCurrentVersion,
  clearAuthenticatedHttpCaches,
  clearPrivateOfflineState,
  getOfflineUser,
  isOfflineSwitching,
  purgePrivateOfflineData,
  setOfflineUser,
  whenOfflineUserSettled,
  postJsonWithSessionRefresh,
  getQueueStats,
  listQueuedActions,
  loadMyWorkCache,
  resolveQueuedAction,
  retryQueuedAction,
  saveMyWorkCache,
} from "./session";

export type {
  MyWorkCachePayload,
  QueueActionStatus,
  QueueCommandType,
  QueuedAction,
} from "./session";

export type { QueuedResult } from "./mutations";
// Re-export selected public symbols.
export {
  assignTicketQueued,
  closeTicketQueued,
  completeCleaningQueued,
  reportTicketQueued,
  reopenTicketQueued,
  resolveTicketQueued,
  resumeTicketQueued,
  startCleaningQueued,
  startTicketQueued,
  waitTicketQueued,
} from "./mutations";

// drainQueue lives in ./drainBoot (and ./queueDrain) — do not re-export here
// so page/barrel importers do not pull the drain chunk into the main graph.
