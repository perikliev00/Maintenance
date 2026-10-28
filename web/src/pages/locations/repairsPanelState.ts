/**
 * Pure helpers + request session for LocationRepairsPanel.
 * Every full reload bumps generation and aborts prior fetches so stale
 * responses cannot overwrite newer list/cursor/error/loading state.
 */
import type { MaintenanceTicket } from "../../api/client";

export const REPAIRS_PAGE_SIZE = 50;

export type TicketListPage = {
  items: MaintenanceTicket[];
  nextCursor: string | null;
  total: number;
};

export type RepairsListViewState = {
  tickets: MaintenanceTicket[];
  nextCursor: string | null;
  totalCount: number | null;
  loadError: string | null;
  loading: boolean;
  loadingMore: boolean;
};

export const EMPTY_REPAIRS_LIST_STATE: RepairsListViewState = {
  tickets: [],
  nextCursor: null,
  totalCount: null,
  loadError: null,
  loading: false,
  loadingMore: false,
};

/** Append page items without duplicating ids already present. */
export function mergeTicketPages(
  existing: MaintenanceTicket[],
  incoming: MaintenanceTicket[],
): MaintenanceTicket[] {
  if (existing.length === 0) return incoming.slice();
  const seen = new Set(existing.map((t) => t.id));
  const next = existing.slice();
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    next.push(row);
  }
  return next;
}

/** Ignore a fetch result when the panel generation has moved on. */
export function isStaleGeneration(
  current: number,
  resultGeneration: number,
): boolean {
  return resultGeneration !== current;
}

export type FetchTicketsPage = (args: {
  cursor?: string | null;
  signal: AbortSignal;
}) => Promise<TicketListPage>;

export type RepairsListSession = {
  /** Current generation (for tests / diagnostics). */
  getGeneration: () => number;
  /** True while a full reload is in flight for the current generation. */
  isFullReloadInFlight: () => boolean;
  /** True while load-more is in flight for the current generation. */
  isLoadMoreInFlight: () => boolean;
  /**
   * Start a full reload: bumps generation, aborts prior work, clears list
   * indicators for a fresh load. Returns request handles.
   */
  beginFullReload: () => { generation: number; signal: AbortSignal };
  /**
   * Start load-more for the given cursor. Returns null when blocked
   * (no cursor, full reload in flight, or load-more already running).
   */
  beginLoadMore: (
    cursor: string | null,
  ) => { generation: number; signal: AbortSignal; cursor: string } | null;
  /** Apply a full-reload outcome only if generation is still current. */
  commitFullReload: (
    generation: number,
    outcome:
      | { ok: true; page: TicketListPage }
      | { ok: false; error: string; aborted?: boolean },
  ) => boolean;
  /** Apply a load-more outcome only if generation is still current. */
  commitLoadMore: (
    generation: number,
    outcome:
      | { ok: true; page: TicketListPage }
      | { ok: false; error: string; aborted?: boolean },
  ) => boolean;
  /**
   * Invalidate all in-flight work (location change / unmount).
   * Subsequent commits are ignored.
   */
  dispose: () => void;
  /** Snapshot of view state managed by the session. */
  getState: () => RepairsListViewState;
};

/**
 * Create a list-fetch session that serializes generations across full reloads
 * and load-more. Callers still perform the network I/O; the session decides
 * whether results may mutate view state.
 */
export function createRepairsListSession(
  onChange?: (state: RepairsListViewState) => void,
): RepairsListSession {
  let generation = 0;
  let abortController: AbortController | null = null;
  let fullReloadInFlight = false;
  let loadMoreInFlight = false;
  let state: RepairsListViewState = { ...EMPTY_REPAIRS_LIST_STATE };

  function publish(next: RepairsListViewState) {
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
    getState: () => state,

    beginFullReload() {
      const handles = bumpAndAbort();
      fullReloadInFlight = true;
      loadMoreInFlight = false;
      publish({
        ...state,
        tickets: [],
        nextCursor: null,
        totalCount: null,
        loadError: null,
        loading: true,
        loadingMore: false,
      });
      return handles;
    },

    beginLoadMore(cursor) {
      if (!cursor || fullReloadInFlight || loadMoreInFlight) return null;
      // Share the current generation; abort with the same controller family.
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
      if (outcome.ok === false) {
        if (outcome.aborted) {
          // Aborted stale work should not clear a newer generation's loading.
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
        tickets: outcome.page.items,
        nextCursor: outcome.page.nextCursor,
        totalCount: outcome.page.total,
        loadError: null,
        loading: false,
        loadingMore: false,
      });
      return true;
    },

    commitLoadMore(resultGeneration, outcome) {
      if (isStaleGeneration(generation, resultGeneration)) return false;
      // A full reload for this generation supersedes load-more.
      if (fullReloadInFlight) return false;
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
        tickets: mergeTicketPages(state.tickets, outcome.page.items),
        nextCursor: outcome.page.nextCursor,
        totalCount: outcome.page.total,
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
      publish({ ...EMPTY_REPAIRS_LIST_STATE });
    },
  };
}

/**
 * Run a full reload through the session with the provided fetch function.
 * Safe to call concurrently — only the latest generation commits.
 */
export async function runFullReload(
  session: RepairsListSession,
  fetchPage: FetchTicketsPage,
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
    if (signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
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

/**
 * Run load-more through the session. No-op when beginLoadMore returns null.
 */
export async function runLoadMore(
  session: RepairsListSession,
  cursor: string | null,
  fetchPage: FetchTicketsPage,
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
    if (signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
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
