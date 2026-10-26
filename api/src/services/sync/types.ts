/**
 * Wire types for offline sync push batches and per-command outcomes.
 */

/** One client-originated mutation; commandId is the idempotency key. */
export type SyncCommand = {
  commandId: string;
  type: string;
  payload: Record<string, unknown>;
  clientTime?: string;
};

/**
 * Per-command result. `conflict` is for state/version races (including access
 * loss after reassignment); `forbidden` is a true missing-permission denial.
 */
export type SyncCommandResult = {
  commandId: string;
  status: "ok" | "conflict" | "forbidden" | "error";
  message?: string;
  code?: string;
  details?: unknown;
  retryable?: boolean;
  data?: unknown;
};
