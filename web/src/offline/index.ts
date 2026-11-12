/**
 * Offline outbox public API (compat barrel).
 *
 * Prefer `./mutations` (queued writes) or `./session` (status/userScope) from
 * pages so Vite can split `queueDrain`. Import `./drainBoot` only from app boot.
 */
export type { ConnMode, QueueStats } from "./session";
// Re-export selected public symbols.
export {
  // List item in import/export/params.
  subscribeOffline,
  // List item in import/export/params.
  canRebaseConflict,
  // List item in import/export/params.
  parseConflictDetails,
  // List item in import/export/params.
  entityIdFromQueued,
  // List item in import/export/params.
  rebaseBodyWithCurrentVersion,
  // List item in import/export/params.
  clearAuthenticatedHttpCaches,
  // List item in import/export/params.
  clearPrivateOfflineState,
  // List item in import/export/params.
  getOfflineUser,
  // List item in import/export/params.
  isOfflineSwitching,
  // List item in import/export/params.
  purgePrivateOfflineData,
  // List item in import/export/params.
  setOfflineUser,
  // List item in import/export/params.
  whenOfflineUserSettled,
  // List item in import/export/params.
  postJsonWithSessionRefresh,
  // List item in import/export/params.
  getQueueStats,
  // List item in import/export/params.
  listQueuedActions,
  // List item in import/export/params.
  loadMyWorkCache,
  // List item in import/export/params.
  resolveQueuedAction,
  // List item in import/export/params.
  retryQueuedAction,
  // List item in import/export/params.
  saveMyWorkCache,
// Close multi-line construct with trailing syntax.
} from "./session";

// Export type alias for consumers.
export type {
  // List item in import/export/params.
  MyWorkCachePayload,
  // List item in import/export/params.
  QueueActionStatus,
  // List item in import/export/params.
  QueueCommandType,
  // List item in import/export/params.
  QueuedAction,
// Close multi-line construct with trailing syntax.
} from "./session";

// Export type alias for consumers.
export type { QueuedResult } from "./mutations";
// Re-export selected public symbols.
export {
  // List item in import/export/params.
  assignTicketQueued,
  // List item in import/export/params.
  closeTicketQueued,
  // List item in import/export/params.
  completeCleaningQueued,
  // List item in import/export/params.
  reportTicketQueued,
  // List item in import/export/params.
  reopenTicketQueued,
  // List item in import/export/params.
  resolveTicketQueued,
  // List item in import/export/params.
  resumeTicketQueued,
  // List item in import/export/params.
  startCleaningQueued,
  // List item in import/export/params.
  startTicketQueued,
  // List item in import/export/params.
  waitTicketQueued,
// Close multi-line construct with trailing syntax.
} from "./mutations";

// drainQueue lives in ./drainBoot (and ./queueDrain) — do not re-export here
// so page/barrel importers do not pull the drain chunk into the main graph.
