/**
 * Wire types for offline sync push batches and per-command outcomes.
 */

/** One client-originated mutation; commandId is the idempotency key. */
export type SyncCommand = {
  // Set commandId on the structure being built.
  commandId: string;
  // Set type on the structure being built.
  type: string;
  // Set payload on the structure being built.
  payload: Record<string, unknown>;
  // Run next step: clientTime?: string;
  clientTime?: string;
};

/**
 * Per-command result. `conflict` is for state/version races (including access
 * loss after reassignment); `forbidden` is a true missing-permission denial.
 */
export type SyncCommandResult = {
  // Set commandId on the structure being built.
  commandId: string;
  // Set status on the structure being built.
  status: "ok" | "conflict" | "forbidden" | "error";
  // Run next step: message?: string;
  message?: string;
  // Run next step: code?: string;
  code?: string;
  // Run next step: details?: unknown;
  details?: unknown;
  // Run next step: retryable?: boolean;
  retryable?: boolean;
  // Run next step: data?: unknown;
  data?: unknown;
};
