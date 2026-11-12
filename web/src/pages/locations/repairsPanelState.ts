/**
 * LocationRepairsPanel list session adapter.
 * Clears rows on full reload and tracks totalCount from each page.
 */
import type { MaintenanceTicket } from "../../api/client";
import {
  createPagedListSession,
  isStaleGeneration,
  mergeByKey,
  runPagedFullReload,
  runPagedLoadMore,
  type PagedListSessionApi,
} from "../../lib/pagedListSession";

export { isStaleGeneration };

// Export REPAIRS_PAGE_SIZE for use by other modules.
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

// Export EMPTY_REPAIRS_LIST_STATE for use by other modules.
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
  return mergeByKey(existing, incoming, (t) => t.id);
}

export type FetchTicketsPage = (args: {
  cursor?: string | null;
  signal: AbortSignal;
}) => Promise<TicketListPage>;

export type RepairsListSession = Omit<
  PagedListSessionApi<TicketListPage, RepairsListViewState>,
  "isSearchPending" | "invalidatePendingSearch"
> & {
  /** Current generation (for tests / diagnostics). */
  getGeneration: () => number;
  /** True while a full reload is in flight for the current generation. */
  isFullReloadInFlight: () => boolean;
  /** True while load-more is in flight for the current generation. */
  isLoadMoreInFlight: () => boolean;
};

/**
 * Create a list-fetch session that serializes generations across full reloads
 * and load-more. Callers still perform the network I/O; the session decides
 * whether results may mutate view state.
 */
export function createRepairsListSession(
  onChange?: (state: RepairsListViewState) => void,
): RepairsListSession {
  const session = createPagedListSession<TicketListPage, RepairsListViewState>({
    emptyState: EMPTY_REPAIRS_LIST_STATE,
    onChange,
    beginFullReloadState: () => ({
      tickets: [],
      nextCursor: null,
      totalCount: null,
      loadError: null,
      loading: true,
      loadingMore: false,
    }),
    commitFullReloadSuccess: (page) => ({
      tickets: page.items,
      nextCursor: page.nextCursor,
      totalCount: page.total,
      loadError: null,
      loading: false,
      loadingMore: false,
    }),
    commitLoadMoreSuccess: (prev, page) => ({
      ...prev,
      tickets: mergeTicketPages(prev.tickets, page.items),
      nextCursor: page.nextCursor,
      totalCount: page.total,
      loadError: null,
      loadingMore: false,
    }),
  });

  // Repairs UI does not use search-pending; omit those methods from the public type.
  const {
    isSearchPending: _isSearchPending,
    invalidatePendingSearch: _invalidatePendingSearch,
    ...publicSession
  } = session;
  return publicSession;
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
  return runPagedFullReload(session, fetchPage, mapError);
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
  return runPagedLoadMore(session, cursor, fetchPage, mapError);
}
