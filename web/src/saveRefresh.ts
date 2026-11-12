/**
 * Shared save-then-refresh outcome helpers (BUG-06 / BUG-07 / BUG-09).
 * A successful mutation must not be presented as failure when only refresh fails.
 */

// Export type definition for consumers of this module.
export type SaveRefreshOutcome =
  // Support the surrounding logic for this step.
  | "saved"
  // Support the surrounding logic for this step.
  | "save_failed"
  // Support the surrounding logic for this step.
  | "saved_refresh_failed";

// Export type definition for consumers of this module.
export type MutationWithRefreshSuccess<T> = {
  // Provide ok field used by this structure.
  ok: true;
  // Provide value field used by this structure.
  value: T;
  // Provide outcome field used by this structure.
  outcome: Extract<SaveRefreshOutcome, "saved" | "saved_refresh_failed">;
  // Provide refreshOk field used by this structure.
  refreshOk: boolean;
  // Provide refreshError field used by this structure.
  refreshError: string | null;
};

// Export type definition for consumers of this module.
export type MutationWithRefreshFailure = {
  // Provide ok field used by this structure.
  ok: false;
  // Provide error field used by this structure.
  error: string;
  // Provide outcome field used by this structure.
  outcome: "save_failed";
  /** Original thrown value (for conflict / network classification). */
  cause?: unknown;
};

// Export type definition for consumers of this module.
export type MutationWithRefreshResult<T> =
  // Support the surrounding logic for this step.
  | MutationWithRefreshSuccess<T>
  // Support the surrounding logic for this step.
  | MutationWithRefreshFailure;

/** Classify mutation vs list-refresh results. */
export function classifySaveRefreshOutcome(input: {
  // Provide saveOk field used by this structure.
  saveOk: boolean;
  // Provide refreshOk field used by this structure.
  refreshOk: boolean;
// Support the surrounding logic for this step.
}): SaveRefreshOutcome {
  // Conditional branch for the case described by this guard.
  if (!input.saveOk) return "save_failed";
  // Conditional branch for the case described by this guard.
  if (!input.refreshOk) return "saved_refresh_failed";
  // Return early result or rendered output from this path.
  return "saved";
}

/**
 * After a confirmed mutation, keep the success message and surface a separate
 * refresh warning when the follow-up reload fails.
 */
export function mergeSavedWithRefreshFailure(input: {
  // Provide successMessage field used by this structure.
  successMessage: string;
  // Support the surrounding logic for this step.
  refreshError?: string | null;
// Support the surrounding logic for this step.
}): { message: string; refreshWarning: string | null } {
  // Return early result or rendered output from this path.
  return {
    // Provide message field used by this structure.
    message: input.successMessage,
    // Provide refreshWarning field used by this structure.
    refreshWarning: input.refreshError ?? null,
  };
}

/**
 * Framework-free mutate-then-refresh (no busy guard).
 * Used by useBusyMutation and by Permissions (per-role busy elsewhere).
 */
export async function executeMutationWithRefresh<T>(
  // Provide mutate field used by this structure.
  mutate: () => Promise<T>,
  // Support the surrounding logic for this step.
  refresh?: () => Promise<void>,
// Support the surrounding logic for this step.
): Promise<MutationWithRefreshResult<T>> {
  // Begin guarded block to catch runtime failures.
  try {
    // Bind value for use in the following logic.
    const value = await mutate();
    // Conditional branch for the case described by this guard.
    if (!refresh) {
      // Return early result or rendered output from this path.
      return {
        // Provide ok field used by this structure.
        ok: true,
        // Support the surrounding logic for this step.
        value,
        // Provide outcome field used by this structure.
        outcome: "saved",
        // Provide refreshOk field used by this structure.
        refreshOk: true,
        // Provide refreshError field used by this structure.
        refreshError: null,
      };
    }
    // Begin guarded block to catch runtime failures.
    try {
      // Wait for an async operation before continuing.
      await refresh();
      // Return early result or rendered output from this path.
      return {
        // Provide ok field used by this structure.
        ok: true,
        // Support the surrounding logic for this step.
        value,
        // Provide outcome field used by this structure.
        outcome: "saved",
        // Provide refreshOk field used by this structure.
        refreshOk: true,
        // Provide refreshError field used by this structure.
        refreshError: null,
      };
    // Support the surrounding logic for this step.
    } catch (err) {
      // Bind refreshError for use in the following logic.
      const refreshError =
        // Support the surrounding logic for this step.
        err instanceof Error ? err.message : "Refresh failed";
      // Return early result or rendered output from this path.
      return {
        // Provide ok field used by this structure.
        ok: true,
        // Support the surrounding logic for this step.
        value,
        // Provide outcome field used by this structure.
        outcome: "saved_refresh_failed",
        // Provide refreshOk field used by this structure.
        refreshOk: false,
        // Support the surrounding logic for this step.
        refreshError,
      };
    }
  // Support the surrounding logic for this step.
  } catch (err) {
    // Return early result or rendered output from this path.
    return {
      // Provide ok field used by this structure.
      ok: false,
      // Provide error field used by this structure.
      error: err instanceof Error ? err.message : "Action failed",
      // Provide outcome field used by this structure.
      outcome: "save_failed",
      // Provide cause field used by this structure.
      cause: err,
    };
  }
}
