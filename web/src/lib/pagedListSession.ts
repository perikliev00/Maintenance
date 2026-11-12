/**
 * Shared cursor-paged list session: generation, abort, full reload, load-more.
 * Domain adapters supply state shape and begin/commit mappings (keep vs clear rows).
 */

export function isStaleGeneration(
  // Field/property in this shape.
  current: number,
  // Field/property in this shape.
  resultGeneration: number,
// Open multi-line construct.
): boolean {
  // Return computed result to caller.
  return resultGeneration !== current;
}

/** Append incoming rows without duplicating keys already present. */
export function mergeByKey<T>(
  // Field/property in this shape.
  existing: T[],
  // Field/property in this shape.
  incoming: T[],
  // Arrow function / callback body.
  key: (item: T) => string,
// Open multi-line construct.
): T[] {
  // Conditional branch for this case.
  if (existing.length === 0) return incoming.slice();
  // Local constant binding.
  const seen = new Set(existing.map(key));
  // Local constant binding.
  const next = existing.slice();
  // Iterate collection / range.
  for (const row of incoming) {
    // Local constant binding.
    const id = key(row);
    // Conditional branch for this case.
    if (seen.has(id)) continue;
    // Invoke helper or pass arguments.
    seen.add(id);
    // Invoke helper or pass arguments.
    next.push(row);
  }
  // Return computed result to caller.
  return next;
}

/** True when the fetch was aborted (signal or AbortError-shaped throw). */
export function isAbortError(err: unknown, signal: AbortSignal): boolean {
  // Return computed result to caller.
  return (
    // Continue module logic.
    signal.aborted ||
    // Assign value for subsequent use.
    (err instanceof DOMException && err.name === "AbortError") ||
    // Assign value for subsequent use.
    (err as { name?: string })?.name === "AbortError"
  );
}

// Export type alias for consumers.
export type PagedFetchOutcome<TPage> =
  // Union/intersection type member.
  | { ok: true; page: TPage }
  // Union/intersection type member.
  | { ok: false; error: string; aborted?: boolean };

/** Loading flags shared by all paged list view states. */
export type PagedListLoadingFields = {
  // Field/property in this shape.
  loadError: string | null;
  // Field/property in this shape.
  loading: boolean;
  // Field/property in this shape.
  loadingMore: boolean;
};

// Export type alias for consumers.
export type PagedListSessionApi<TPage, TState> = {
  // Arrow function / callback body.
  getGeneration: () => number;
  // Arrow function / callback body.
  isFullReloadInFlight: () => boolean;
  // Arrow function / callback body.
  isLoadMoreInFlight: () => boolean;
  // Arrow function / callback body.
  isSearchPending: () => boolean;
  // Arrow function / callback body.
  invalidatePendingSearch: () => void;
  // Arrow function / callback body.
  beginFullReload: () => { generation: number; signal: AbortSignal };
  // Field/property in this shape.
  beginLoadMore: (
    // Field/property in this shape.
    cursor: string | null,
  // Arrow function / callback body.
  ) => { generation: number; signal: AbortSignal; cursor: string } | null;
  // Field/property in this shape.
  commitFullReload: (
    // Field/property in this shape.
    generation: number,
    // Field/property in this shape.
    outcome: PagedFetchOutcome<TPage>,
  // Arrow function / callback body.
  ) => boolean;
  // Field/property in this shape.
  commitLoadMore: (
    // Field/property in this shape.
    generation: number,
    // Field/property in this shape.
    outcome: PagedFetchOutcome<TPage>,
  // Arrow function / callback body.
  ) => boolean;
  // Arrow function / callback body.
  dispose: () => void;
  // Arrow function / callback body.
  getState: () => TState;
};

// Export type alias for consumers.
export type CreatePagedListSessionOptions<
  // List item in import/export/params.
  TPage,
  // Continue multi-line list/arguments.
  TState extends PagedListLoadingFields,
// Assign value for subsequent use.
> = {
  // Field/property in this shape.
  emptyState: TState;
  /** When true, expose search-pending invalidation that blocks load-more. */
  enableSearchPending?: boolean;
  /**
   * Patch applied when search text changes before the debounced reload starts.
   * Required when `enableSearchPending` is true.
   */
  beginSearchPendingState?: (prev: TState) => TState;
  // Arrow function / callback body.
  beginFullReloadState: (prev: TState) => TState;
  // Arrow function / callback body.
  commitFullReloadSuccess: (page: TPage) => TState;
  // Arrow function / callback body.
  commitLoadMoreSuccess: (prev: TState, page: TPage) => TState;
  // Arrow function / callback body.
  onChange?: (state: TState) => void;
};

/**
 * Create a list-fetch session that serializes generations across full reloads
 * and load-more. Callers perform network I/O; the session decides commits.
 */
export function createPagedListSession<
  // List item in import/export/params.
  TPage,
  // Continue multi-line list/arguments.
  TState extends PagedListLoadingFields,
// Open multi-line construct.
>(
  // Field/property in this shape.
  options: CreatePagedListSessionOptions<TPage, TState>,
// Open multi-line construct.
): PagedListSessionApi<TPage, TState> {
  // Local constant binding.
  const enableSearchPending = Boolean(options.enableSearchPending);
  // Mutable local binding.
  let generation = 0;
  // Mutable local binding.
  let abortController: AbortController | null = null;
  // Mutable local binding.
  let fullReloadInFlight = false;
  // Mutable local binding.
  let loadMoreInFlight = false;
  // Mutable local binding.
  let searchPending = false;
  // Mutable local binding.
  let state: TState = { ...options.emptyState };

  // Function definition.
  function publish(next: TState) {
    // Assign value for subsequent use.
    state = next;
    // Invoke helper or pass arguments.
    options.onChange?.(state);
  }

  // Function definition.
  function bumpAndAbort() {
    // Assign value for subsequent use.
    generation += 1;
    // Invoke helper or pass arguments.
    abortController?.abort();
    // Assign value for subsequent use.
    abortController = new AbortController();
    // Assign value for subsequent use.
    fullReloadInFlight = false;
    // Assign value for subsequent use.
    loadMoreInFlight = false;
    // Return computed result to caller.
    return { generation, signal: abortController.signal };
  }

  // Return computed result to caller.
  return {
    // Arrow function / callback body.
    getGeneration: () => generation,
    // Arrow function / callback body.
    isFullReloadInFlight: () => fullReloadInFlight,
    // Arrow function / callback body.
    isLoadMoreInFlight: () => loadMoreInFlight,
    // Arrow function / callback body.
    isSearchPending: () => searchPending,
    // Arrow function / callback body.
    getState: () => state,

    // Invoke helper or pass arguments.
    invalidatePendingSearch() {
      // Conditional branch for this case.
      if (!enableSearchPending || !options.beginSearchPendingState) {
        // Abort with an error for the caller.
        throw new Error(
          // Continue multi-line list/arguments.
          "invalidatePendingSearch requires enableSearchPending + beginSearchPendingState",
        );
      }
      // Invoke helper or pass arguments.
      bumpAndAbort();
      // Assign value for subsequent use.
      searchPending = true;
      // Assign value for subsequent use.
      fullReloadInFlight = false;
      // Assign value for subsequent use.
      loadMoreInFlight = false;
      // Invoke helper or pass arguments.
      publish(options.beginSearchPendingState(state));
    },

    // Invoke helper or pass arguments.
    beginFullReload() {
      // Local constant binding.
      const handles = bumpAndAbort();
      // Assign value for subsequent use.
      searchPending = false;
      // Assign value for subsequent use.
      fullReloadInFlight = true;
      // Assign value for subsequent use.
      loadMoreInFlight = false;
      // Invoke helper or pass arguments.
      publish(options.beginFullReloadState(state));
      // Return computed result to caller.
      return handles;
    },

    // Invoke helper or pass arguments.
    beginLoadMore(cursor) {
      // Conditional branch for this case.
      if (
        // Continue module logic.
        !cursor ||
        // Continue module logic.
        fullReloadInFlight ||
        // Continue module logic.
        loadMoreInFlight ||
        // Invoke helper or pass arguments.
        (enableSearchPending && searchPending)
      // Open multi-line construct.
      ) {
        // Return computed result to caller.
        return null;
      }
      // Conditional branch for this case.
      if (!abortController) {
        // Assign value for subsequent use.
        abortController = new AbortController();
      }
      // Assign value for subsequent use.
      loadMoreInFlight = true;
      // Invoke helper or pass arguments.
      publish({ ...state, loadingMore: true, loadError: null });
      // Return computed result to caller.
      return {
        // List item in import/export/params.
        generation,
        // Field/property in this shape.
        signal: abortController.signal,
        // List item in import/export/params.
        cursor,
      };
    },

    // Invoke helper or pass arguments.
    commitFullReload(resultGeneration, outcome) {
      // Conditional branch for this case.
      if (isStaleGeneration(generation, resultGeneration)) return false;
      // Assign value for subsequent use.
      fullReloadInFlight = false;
      // Assign value for subsequent use.
      searchPending = false;
      // Conditional branch for this case.
      if (outcome.ok === false) {
        // Conditional branch for this case.
        if (outcome.aborted) {
          // Return computed result to caller.
          return false;
        }
        // Open multi-line construct.
        publish({
          // Spread remaining fields/props.
          ...state,
          // Field/property in this shape.
          loading: false,
          // Field/property in this shape.
          loadingMore: false,
          // Field/property in this shape.
          loadError: outcome.error,
        });
        // Return computed result to caller.
        return true;
      }
      // Invoke helper or pass arguments.
      publish(options.commitFullReloadSuccess(outcome.page));
      // Return computed result to caller.
      return true;
    },

    // Invoke helper or pass arguments.
    commitLoadMore(resultGeneration, outcome) {
      // Conditional branch for this case.
      if (isStaleGeneration(generation, resultGeneration)) return false;
      // Conditional branch for this case.
      if (fullReloadInFlight || (enableSearchPending && searchPending)) {
        // Return computed result to caller.
        return false;
      }
      // Assign value for subsequent use.
      loadMoreInFlight = false;
      // Conditional branch for this case.
      if (outcome.ok === false) {
        // Conditional branch for this case.
        if (outcome.aborted) {
          // Invoke helper or pass arguments.
          publish({ ...state, loadingMore: false });
          // Return computed result to caller.
          return true;
        }
        // Open multi-line construct.
        publish({
          // Spread remaining fields/props.
          ...state,
          // Field/property in this shape.
          loadingMore: false,
          // Field/property in this shape.
          loadError: outcome.error,
        });
        // Return computed result to caller.
        return true;
      }
      // Invoke helper or pass arguments.
      publish(options.commitLoadMoreSuccess(state, outcome.page));
      // Return computed result to caller.
      return true;
    },

    // Invoke helper or pass arguments.
    dispose() {
      // Assign value for subsequent use.
      generation += 1;
      // Invoke helper or pass arguments.
      abortController?.abort();
      // Assign value for subsequent use.
      abortController = null;
      // Assign value for subsequent use.
      fullReloadInFlight = false;
      // Assign value for subsequent use.
      loadMoreInFlight = false;
      // Assign value for subsequent use.
      searchPending = false;
      // Invoke helper or pass arguments.
      publish({ ...options.emptyState });
    },
  };
}

// Export type alias for consumers.
export type FetchPagedPage<TPage> = (args: {
  // Field/property in this shape.
  cursor?: string | null;
  // Field/property in this shape.
  signal: AbortSignal;
// Arrow function / callback body.
}) => Promise<TPage>;

/** Run a full reload through the session. Only the latest generation commits. */
export async function runPagedFullReload<TPage, TState>(
  // Field/property in this shape.
  session: Pick<
    // Continue multi-line list/arguments.
    PagedListSessionApi<TPage, TState>,
    // Continue module logic.
    "beginFullReload" | "commitFullReload"
  // Continue multi-line list/arguments.
  >,
  // Field/property in this shape.
  fetchPage: FetchPagedPage<TPage>,
  // Arrow function / callback body.
  mapError: (err: unknown) => string,
// Open multi-line construct.
): Promise<void> {
  // Assign value for subsequent use.
  const { generation, signal } = session.beginFullReload();
  // Guard fallible work.
  try {
    // Local constant binding.
    const page = await fetchPage({ signal });
    // Conditional branch for this case.
    if (signal.aborted) {
      // Open multi-line construct.
      session.commitFullReload(generation, {
        // Field/property in this shape.
        ok: false,
        // Field/property in this shape.
        error: "",
        // Field/property in this shape.
        aborted: true,
      });
      // Return computed result to caller.
      return;
    }
    // Invoke helper or pass arguments.
    session.commitFullReload(generation, { ok: true, page });
  // Invoke helper or pass arguments.
  } catch (err) {
    // Conditional branch for this case.
    if (isAbortError(err, signal)) {
      // Open multi-line construct.
      session.commitFullReload(generation, {
        // Field/property in this shape.
        ok: false,
        // Field/property in this shape.
        error: "",
        // Field/property in this shape.
        aborted: true,
      });
      // Return computed result to caller.
      return;
    }
    // Open multi-line construct.
    session.commitFullReload(generation, {
      // Field/property in this shape.
      ok: false,
      // Field/property in this shape.
      error: mapError(err),
    });
  }
}

/** Run load-more through the session. No-op when beginLoadMore returns null. */
export async function runPagedLoadMore<TPage, TState>(
  // Field/property in this shape.
  session: Pick<
    // Continue multi-line list/arguments.
    PagedListSessionApi<TPage, TState>,
    // Continue module logic.
    "beginLoadMore" | "commitLoadMore"
  // Continue multi-line list/arguments.
  >,
  // Field/property in this shape.
  cursor: string | null,
  // Field/property in this shape.
  fetchPage: FetchPagedPage<TPage>,
  // Arrow function / callback body.
  mapError: (err: unknown) => string,
// Open multi-line construct.
): Promise<boolean> {
  // Local constant binding.
  const started = session.beginLoadMore(cursor);
  // Conditional branch for this case.
  if (!started) return false;
  // Assign value for subsequent use.
  const { generation, signal, cursor: pageCursor } = started;
  // Guard fallible work.
  try {
    // Local constant binding.
    const page = await fetchPage({ cursor: pageCursor, signal });
    // Conditional branch for this case.
    if (signal.aborted) {
      // Open multi-line construct.
      session.commitLoadMore(generation, {
        // Field/property in this shape.
        ok: false,
        // Field/property in this shape.
        error: "",
        // Field/property in this shape.
        aborted: true,
      });
      // Return computed result to caller.
      return true;
    }
    // Invoke helper or pass arguments.
    session.commitLoadMore(generation, { ok: true, page });
  // Invoke helper or pass arguments.
  } catch (err) {
    // Conditional branch for this case.
    if (isAbortError(err, signal)) {
      // Open multi-line construct.
      session.commitLoadMore(generation, {
        // Field/property in this shape.
        ok: false,
        // Field/property in this shape.
        error: "",
        // Field/property in this shape.
        aborted: true,
      });
      // Return computed result to caller.
      return true;
    }
    // Open multi-line construct.
    session.commitLoadMore(generation, {
      // Field/property in this shape.
      ok: false,
      // Field/property in this shape.
      error: mapError(err),
    });
  }
  // Return computed result to caller.
  return true;
}
