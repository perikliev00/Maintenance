/**
 * Debounced search text bridge for Team Directory / Existing.
 * Invalidates immediately when the trimmed query diverges from the committed
 * value; schedules the next fetch only after `debounceMs`.
 */

export type DebouncedSearchTimers = {
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
};

export type DebouncedSearchOptions = {
  debounceMs: number;
  /** Called immediately when trimmed input differs from the committed query. */
  onInvalidate: () => void;
  /** Called after debounce with the committed trimmed query (may refetch same). */
  onCommit: (committed: string) => void;
  timers?: DebouncedSearchTimers;
};

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

const defaultTimers: DebouncedSearchTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

/**
 * Create a search-field bridge: immediate invalidate, delayed commit.
 */
export function createDebouncedSearch(
  options: DebouncedSearchOptions,
): DebouncedSearchBridge {
  const timers = options.timers ?? defaultTimers;
  let input = "";
  let committed = "";
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleCommit() {
    clearTimer();
    timer = timers.setTimeout(() => {
      timer = null;
      const next = input.trim();
      committed = next;
      pending = false;
      options.onCommit(committed);
    }, options.debounceMs);
  }

  return {
    getInput: () => input,
    getCommitted: () => committed,
    isPending: () => pending,
    flushRefreshQuery: () => input.trim(),

    forceCommitFromInput() {
      clearTimer();
      const next = input.trim();
      committed = next;
      pending = false;
      return next;
    },

    onInput(raw: string) {
      input = raw;
      const trimmed = raw.trim();
      if (trimmed !== committed) {
        pending = true;
        options.onInvalidate();
        scheduleCommit();
        return;
      }
      // Trimmed matches committed: either no-op, or finish a pending A→An→A path.
      if (pending) {
        scheduleCommit();
      }
    },

    dispose() {
      clearTimer();
    },
  };
}
