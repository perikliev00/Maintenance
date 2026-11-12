/**
 * Shared save-then-refresh outcome helpers (BUG-06 / BUG-07 / BUG-09).
 * A successful mutation must not be presented as failure when only refresh fails.
 */

export type SaveRefreshOutcome =
  | "saved"
  | "save_failed"
  | "saved_refresh_failed";

export type MutationWithRefreshSuccess<T> = {
  ok: true;
  value: T;
  outcome: Extract<SaveRefreshOutcome, "saved" | "saved_refresh_failed">;
  refreshOk: boolean;
  refreshError: string | null;
};

export type MutationWithRefreshFailure = {
  ok: false;
  error: string;
  outcome: "save_failed";
  /** Original thrown value (for conflict / network classification). */
  cause?: unknown;
};

export type MutationWithRefreshResult<T> =
  | MutationWithRefreshSuccess<T>
  | MutationWithRefreshFailure;

/** Classify mutation vs list-refresh results. */
export function classifySaveRefreshOutcome(input: {
  saveOk: boolean;
  refreshOk: boolean;
}): SaveRefreshOutcome {
  if (!input.saveOk) return "save_failed";
  if (!input.refreshOk) return "saved_refresh_failed";
  return "saved";
}

/**
 * After a confirmed mutation, keep the success message and surface a separate
 * refresh warning when the follow-up reload fails.
 */
export function mergeSavedWithRefreshFailure(input: {
  successMessage: string;
  refreshError?: string | null;
}): { message: string; refreshWarning: string | null } {
  return {
    message: input.successMessage,
    refreshWarning: input.refreshError ?? null,
  };
}

/**
 * Framework-free mutate-then-refresh (no busy guard).
 * Used by useBusyMutation and by Permissions (per-role busy elsewhere).
 */
export async function executeMutationWithRefresh<T>(
  mutate: () => Promise<T>,
  refresh?: () => Promise<void>,
): Promise<MutationWithRefreshResult<T>> {
  try {
    const value = await mutate();
    if (!refresh) {
      return {
        ok: true,
        value,
        outcome: "saved",
        refreshOk: true,
        refreshError: null,
      };
    }
    try {
      await refresh();
      return {
        ok: true,
        value,
        outcome: "saved",
        refreshOk: true,
        refreshError: null,
      };
    } catch (err) {
      const refreshError =
        err instanceof Error ? err.message : "Refresh failed";
      return {
        ok: true,
        value,
        outcome: "saved_refresh_failed",
        refreshOk: false,
        refreshError,
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Action failed",
      outcome: "save_failed",
      cause: err,
    };
  }
}
