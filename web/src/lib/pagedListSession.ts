/**
 * Shared cursor-paged list session: generation, abort, full reload, load-more.
 * Domain adapters supply state shape and begin/commit mappings (keep vs clear rows).
 */

export function isStaleGeneration(
  current: number,
  resultGeneration: number,
): boolean {
  return resultGeneration !== current;
}

/** Append incoming rows without duplicating keys already present. */
export function mergeByKey<T>(
  existing: T[],
  incoming: T[],
  key: (item: T) => string,
): T[] {
  if (existing.length === 0) return incoming.slice();
  const seen = new Set(existing.map(key));
  const next = existing.slice();
  for (const row of incoming) {
    const id = key(row);
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(row);
  }
  return next;
}

/** True when the fetch was aborted (signal or AbortError-shaped throw). */
export function isAbortError(err: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (err instanceof DOMException && err.name === "AbortError") ||
    (err as { name?: string })?.name === "AbortError"
  );
}

export type PagedFetchOutcome<TPage> =
  | { ok: true; page: TPage }
  | { ok: false; error: string; aborted?: boolean };

/** Loading flags shared by all paged list view states. */
export type PagedListLoadingFields = {
  loadError: string | null;
  loading: boolean;
  loadingMore: boolean;
};

export type PagedListSessionApi<TPage, TState> = {
  getGeneration: () => number;
  isFullReloadInFlight: () => boolean;
  isLoadMoreInFlight: () => boolean;
  isSearchPending: () => boolean;
  invalidatePendingSearch: () => void;
  beginFullReload: () => { generation: number; signal: AbortSignal };
  beginLoadMore: (
    cursor: string | null,
  ) => { generation: number; signal: AbortSignal; cursor: string } | null;
  commitFullReload: (
    generation: number,
    outcome: PagedFetchOutcome<TPage>,
  ) => boolean;
  commitLoadMore: (
    generation: number,
    outcome: PagedFetchOutcome<TPage>,
  ) => boolean;
  dispose: () => void;
  getState: () => TState;
};

export type CreatePagedListSessionOptions<
  TPage,
  TState extends PagedListLoadingFields,
> = {
  emptyState: TState;
  /** When true, expose search-pending invalidation that blocks load-more. */
  enableSearchPending?: boolean;
  /**
   * Patch applied when search text changes before the debounced reload starts.
   * Required when `enableSearchPending` is true.
   */
  beginSearchPendingState?: (prev: TState) => TState;
  beginFullReloadState: (prev: TState) => TState;
  commitFullReloadSuccess: (page: TPage) => TState;
  commitLoadMoreSuccess: (prev: TState, page: TPage) => TState;
  onChange?: (state: TState) => void;
};

/**
 * Create a list-fetch session that serializes generations across full reloads
 * and load-more. Callers perform network I/O; the session decides commits.
 */
export function createPagedListSession<
  TPage,
  TState extends PagedListLoadingFields,
>(
  options: CreatePagedListSessionOptions<TPage, TState>,
): PagedListSessionApi<TPage, TState> {
  const enableSearchPending = Boolean(options.enableSearchPending);
  let generation = 0;
  let abortController: AbortController | null = null;
  let fullReloadInFlight = false;
  let loadMoreInFlight = false;
  let searchPending = false;
  let state: TState = { ...options.emptyState };

  function publish(next: TState) {
    state = next;
    options.onChange?.(state);
  }

  function bumpAndAbort() {
    generation += 1;
    abortController?.abort();
    abortController = new AbortController();
    fullReloadInFlight = false;
    loadMoreInFlight = false;
    return { generation, signal: abortController.signal };
  }

  return {
    getGeneration: () => generation,
    isFullReloadInFlight: () => fullReloadInFlight,
    isLoadMoreInFlight: () => loadMoreInFlight,
    isSearchPending: () => searchPending,
    getState: () => state,

    invalidatePendingSearch() {
      if (!enableSearchPending || !options.beginSearchPendingState) {
        throw new Error(
          "invalidatePendingSearch requires enableSearchPending + beginSearchPendingState",
        );
      }
      bumpAndAbort();
      searchPending = true;
      fullReloadInFlight = false;
      loadMoreInFlight = false;
      publish(options.beginSearchPendingState(state));
    },

    beginFullReload() {
      const handles = bumpAndAbort();
      searchPending = false;
      fullReloadInFlight = true;
      loadMoreInFlight = false;
      publish(options.beginFullReloadState(state));
      return handles;
    },

    beginLoadMore(cursor) {
      if (
        !cursor ||
        fullReloadInFlight ||
        loadMoreInFlight ||
        (enableSearchPending && searchPending)
      ) {
        return null;
      }
      if (!abortController) {
        abortController = new AbortController();
      }
      loadMoreInFlight = true;
      publish({ ...state, loadingMore: true, loadError: null });
      return {
        generation,
        signal: abortController.signal,
        cursor,
      };
    },

    commitFullReload(resultGeneration, outcome) {
      if (isStaleGeneration(generation, resultGeneration)) return false;
      fullReloadInFlight = false;
      searchPending = false;
      if (outcome.ok === false) {
        if (outcome.aborted) {
          return false;
        }
        publish({
          ...state,
          loading: false,
          loadingMore: false,
          loadError: outcome.error,
        });
        return true;
      }
      publish(options.commitFullReloadSuccess(outcome.page));
      return true;
    },

    commitLoadMore(resultGeneration, outcome) {
      if (isStaleGeneration(generation, resultGeneration)) return false;
      if (fullReloadInFlight || (enableSearchPending && searchPending)) {
        return false;
      }
      loadMoreInFlight = false;
      if (outcome.ok === false) {
        if (outcome.aborted) {
          publish({ ...state, loadingMore: false });
          return true;
        }
        publish({
          ...state,
          loadingMore: false,
          loadError: outcome.error,
        });
        return true;
      }
      publish(options.commitLoadMoreSuccess(state, outcome.page));
      return true;
    },

    dispose() {
      generation += 1;
      abortController?.abort();
      abortController = null;
      fullReloadInFlight = false;
      loadMoreInFlight = false;
      searchPending = false;
      publish({ ...options.emptyState });
    },
  };
}

export type FetchPagedPage<TPage> = (args: {
  cursor?: string | null;
  signal: AbortSignal;
}) => Promise<TPage>;

/** Run a full reload through the session. Only the latest generation commits. */
export async function runPagedFullReload<TPage, TState>(
  session: Pick<
    PagedListSessionApi<TPage, TState>,
    "beginFullReload" | "commitFullReload"
  >,
  fetchPage: FetchPagedPage<TPage>,
  mapError: (err: unknown) => string,
): Promise<void> {
  const { generation, signal } = session.beginFullReload();
  try {
    const page = await fetchPage({ signal });
    if (signal.aborted) {
      session.commitFullReload(generation, {
        ok: false,
        error: "",
        aborted: true,
      });
      return;
    }
    session.commitFullReload(generation, { ok: true, page });
  } catch (err) {
    if (isAbortError(err, signal)) {
      session.commitFullReload(generation, {
        ok: false,
        error: "",
        aborted: true,
      });
      return;
    }
    session.commitFullReload(generation, {
      ok: false,
      error: mapError(err),
    });
  }
}

/** Run load-more through the session. No-op when beginLoadMore returns null. */
export async function runPagedLoadMore<TPage, TState>(
  session: Pick<
    PagedListSessionApi<TPage, TState>,
    "beginLoadMore" | "commitLoadMore"
  >,
  cursor: string | null,
  fetchPage: FetchPagedPage<TPage>,
  mapError: (err: unknown) => string,
): Promise<boolean> {
  const started = session.beginLoadMore(cursor);
  if (!started) return false;
  const { generation, signal, cursor: pageCursor } = started;
  try {
    const page = await fetchPage({ cursor: pageCursor, signal });
    if (signal.aborted) {
      session.commitLoadMore(generation, {
        ok: false,
        error: "",
        aborted: true,
      });
      return true;
    }
    session.commitLoadMore(generation, { ok: true, page });
  } catch (err) {
    if (isAbortError(err, signal)) {
      session.commitLoadMore(generation, {
        ok: false,
        error: "",
        aborted: true,
      });
      return true;
    }
    session.commitLoadMore(generation, {
      ok: false,
      error: mapError(err),
    });
  }
  return true;
}
