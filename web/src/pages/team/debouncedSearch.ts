/**
 * Debounced search text bridge for Team Directory / Existing.
 * Invalidates immediately when the trimmed query diverges from the committed
 * value; schedules the next fetch only after `debounceMs`.
 */

// Export type definition for consumers of this module.
export type DebouncedSearchTimers = {
  // Provide setTimeout field used by this structure.
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  // Provide clearTimeout field used by this structure.
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
};

// Export type definition for consumers of this module.
export type DebouncedSearchOptions = {
  // Provide debounceMs field used by this structure.
  debounceMs: number;
  /** Called immediately when trimmed input differs from the committed query. */
  onInvalidate: () => void;
  /** Called after debounce with the committed trimmed query (may refetch same). */
  onCommit: (committed: string) => void;
  // Support the surrounding logic for this step.
  timers?: DebouncedSearchTimers;
};

// Export type definition for consumers of this module.
export type DebouncedSearchBridge = {
  /** Current raw field value (for controlled inputs). */
  getInput: () => string;
  /** Last committed (debounced) trimmed query used for fetches. */
  getCommitted: () => string;
  /** True while waiting for debounce after a real query change. */
  isPending: () => boolean;
  /**
   * Handle search field changes. Triggers onInvalidate when the trimmed value
   * differs from committed (or while returning to committed during pending).
   */
  onInput: (raw: string) => void;
  /** Trimmed current input — use for Refresh during pending (never stale committed). */
  flushRefreshQuery: () => string;
  /**
   * Cancel debounce, commit current trimmed input, clear pending.
   * Used by Refresh so it never fetches with a stale committed query.
   */
  forceCommitFromInput: () => string;
  /** Cancel a pending timer (unmount). */
  dispose: () => void;
};

// Initialize an object holding related fields.
const defaultTimers: DebouncedSearchTimers = {
  // Provide setTimeout field used by this structure.
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  // Provide clearTimeout field used by this structure.
  clearTimeout: (id) => clearTimeout(id),
};

/**
 * Create a search-field bridge: immediate invalidate, delayed commit.
 */
export function createDebouncedSearch(
  // Provide options field used by this structure.
  options: DebouncedSearchOptions,
// Support the surrounding logic for this step.
): DebouncedSearchBridge {
  // Bind timers for use in the following logic.
  const timers = options.timers ?? defaultTimers;
  // Bind input for use in the following logic.
  let input = "";
  // Bind committed for use in the following logic.
  let committed = "";
  // Bind pending for use in the following logic.
  let pending = false;
  // Bind timer for use in the following logic.
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Define function clearTimer and its behavior.
  function clearTimer() {
    // Conditional branch for the case described by this guard.
    if (timer !== null) {
      // Invoke timers.clearTimeout to perform this step.
      timers.clearTimeout(timer);
      // Support the surrounding logic for this step.
      timer = null;
    }
  }

  // Define function scheduleCommit and its behavior.
  function scheduleCommit() {
    // Invoke clearTimer to perform this step.
    clearTimer();
    // Support the surrounding logic for this step.
    timer = timers.setTimeout(() => {
      // Support the surrounding logic for this step.
      timer = null;
      // Bind next for use in the following logic.
      const next = input.trim();
      // Support the surrounding logic for this step.
      committed = next;
      // Support the surrounding logic for this step.
      pending = false;
      // Invoke options.onCommit to perform this step.
      options.onCommit(committed);
    // Support the surrounding logic for this step.
    }, options.debounceMs);
  }

  // Return early result or rendered output from this path.
  return {
    // Provide getInput field used by this structure.
    getInput: () => input,
    // Provide getCommitted field used by this structure.
    getCommitted: () => committed,
    // Provide isPending field used by this structure.
    isPending: () => pending,
    // Provide flushRefreshQuery field used by this structure.
    flushRefreshQuery: () => input.trim(),

    // Invoke forceCommitFromInput to perform this step.
    forceCommitFromInput() {
      // Invoke clearTimer to perform this step.
      clearTimer();
      // Bind next for use in the following logic.
      const next = input.trim();
      // Support the surrounding logic for this step.
      committed = next;
      // Support the surrounding logic for this step.
      pending = false;
      // Return early result or rendered output from this path.
      return next;
    },

    // Invoke onInput to perform this step.
    onInput(raw: string) {
      // Support the surrounding logic for this step.
      input = raw;
      // Bind trimmed for use in the following logic.
      const trimmed = raw.trim();
      // Conditional branch for the case described by this guard.
      if (trimmed !== committed) {
        // Support the surrounding logic for this step.
        pending = true;
        // Invoke options.onInvalidate to perform this step.
        options.onInvalidate();
        // Invoke scheduleCommit to perform this step.
        scheduleCommit();
        // Return early result or rendered output from this path.
        return;
      }
      // Trimmed matches committed: either no-op, or finish a pending A→An→A path.
      if (pending) {
        // Invoke scheduleCommit to perform this step.
        scheduleCommit();
      }
    },

    // Invoke dispose to perform this step.
    dispose() {
      // Invoke clearTimer to perform this step.
      clearTimer();
    },
  };
}
