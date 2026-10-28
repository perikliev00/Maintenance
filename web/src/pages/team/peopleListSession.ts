/**
 * Pure helpers + request session for Team people lists (directory / Existing).
 * Full reload bumps generation and aborts prior fetches so stale replace/append
 * cannot mix filters, cursors, errors, or loading flags.
 */
import type { Person } from "../../api/client";

export type PeopleListPage = {
  items: Person[];
  nextCursor: string | null;
};

export type PeopleListViewState = {
  people: Person[];
  nextCursor: string | null;
  loadError: string | null;
  loading: boolean;
  loadingMore: boolean;
};

export const EMPTY_PEOPLE_LIST_STATE: PeopleListViewState = {
  people: [],
  nextCursor: null,
  loadError: null,
  loading: false,
  loadingMore: false,
};

/** Append page items without duplicating employeeId already present. */
export function mergePeoplePages(
  existing: Person[],
  incoming: Person[],
): Person[] {
  if (existing.length === 0) return incoming.slice();
  const seen = new Set(existing.map((p) => p.employeeId));
  const next = existing.slice();
  for (const row of incoming) {
    if (seen.has(row.employeeId)) continue;
    seen.add(row.employeeId);
    next.push(row);
  }
  return next;
}

/** Ignore a fetch result when the list generation has moved on. */
export function isStaleGeneration(
  current: number,
  resultGeneration: number,
): boolean {
  return resultGeneration !== current;
}

export type FetchPeopleListPage = (args: {
  cursor?: string | null;
  signal: AbortSignal;
}) => Promise<PeopleListPage>;

export type PeopleListSession = {
  getGeneration: () => number;
  isFullReloadInFlight: () => boolean;
  isLoadMoreInFlight: () => boolean;
  /** True after search text changed and before the debounced reload starts. */
  isSearchPending: () => boolean;
  /**
   * Invalidate in-flight work immediately when search text changes, without
   * starting a fetch yet (debounce still owns the next request).
   */
  invalidatePendingSearch: () => void;
  beginFullReload: () => { generation: number; signal: AbortSignal };
  beginLoadMore: (
    cursor: string | null,
  ) => { generation: number; signal: AbortSignal; cursor: string } | null;
  commitFullReload: (
    generation: number,
    outcome:
      | { ok: true; page: PeopleListPage }
      | { ok: false; error: string; aborted?: boolean },
  ) => boolean;
  commitLoadMore: (
    generation: number,
    outcome:
      | { ok: true; page: PeopleListPage }
      | { ok: false; error: string; aborted?: boolean },
  ) => boolean;
  dispose: () => void;
  getState: () => PeopleListViewState;
};

/**
 * Create a list-fetch session that serializes generations across full reloads
 * and load-more. Callers perform network I/O; the session decides commits.
 */
export function createPeopleListSession(
  onChange?: (state: PeopleListViewState) => void,
): PeopleListSession {
  let generation = 0;
  let abortController: AbortController | null = null;
  let fullReloadInFlight = false;
  let loadMoreInFlight = false;
  let searchPending = false;
  let state: PeopleListViewState = { ...EMPTY_PEOPLE_LIST_STATE };

  function publish(next: PeopleListViewState) {
    state = next;
    onChange?.(state);
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
      bumpAndAbort();
      searchPending = true;
      fullReloadInFlight = false;
      loadMoreInFlight = false;
      publish({
        ...state,
        nextCursor: null,
        loadError: null,
        loading: true,
        loadingMore: false,
      });
    },

    beginFullReload() {
      const handles = bumpAndAbort();
      searchPending = false;
      fullReloadInFlight = true;
      loadMoreInFlight = false;
      publish({
        ...state,
        // Keep previous rows visible until the new page lands (Team UX),
        // but clear cursor so Load more cannot use a stale continuation.
        nextCursor: null,
        loadError: null,
        loading: true,
        loadingMore: false,
      });
      return handles;
    },

    beginLoadMore(cursor) {
      if (!cursor || fullReloadInFlight || loadMoreInFlight || searchPending) {
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
      publish({
        people: outcome.page.items,
        nextCursor: outcome.page.nextCursor,
        loadError: null,
        loading: false,
        loadingMore: false,
      });
      return true;
    },

    commitLoadMore(resultGeneration, outcome) {
      if (isStaleGeneration(generation, resultGeneration)) return false;
      if (fullReloadInFlight || searchPending) return false;
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
      publish({
        ...state,
        people: mergePeoplePages(state.people, outcome.page.items),
        nextCursor: outcome.page.nextCursor,
        loadError: null,
        loadingMore: false,
      });
      return true;
    },

    dispose() {
      generation += 1;
      abortController?.abort();
      abortController = null;
      fullReloadInFlight = false;
      loadMoreInFlight = false;
      searchPending = false;
      publish({ ...EMPTY_PEOPLE_LIST_STATE });
    },
  };
}

/** Run a full reload through the session. Only the latest generation commits. */
export async function runPeopleFullReload(
  session: PeopleListSession,
  fetchPage: FetchPeopleListPage,
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
    if (
      signal.aborted ||
      (err instanceof DOMException && err.name === "AbortError") ||
      (err as { name?: string })?.name === "AbortError"
    ) {
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
export async function runPeopleLoadMore(
  session: PeopleListSession,
  cursor: string | null,
  fetchPage: FetchPeopleListPage,
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
    if (
      signal.aborted ||
      (err instanceof DOMException && err.name === "AbortError") ||
      (err as { name?: string })?.name === "AbortError"
    ) {
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
