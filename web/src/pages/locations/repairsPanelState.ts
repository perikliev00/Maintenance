/**
 * LocationRepairsPanel list session adapter.
 * Clears rows on full reload and tracks totalCount from each page.
 */
import type { MaintenanceTicket } from "../../api/client";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  createPagedListSession,
  // Support the surrounding logic for this step.
  isStaleGeneration,
  // Support the surrounding logic for this step.
  mergeByKey,
  // Support the surrounding logic for this step.
  runPagedFullReload,
  // Support the surrounding logic for this step.
  runPagedLoadMore,
  // Declare type alias PagedListSessionApi.
  type PagedListSessionApi,
// Support the surrounding logic for this step.
} from "../../lib/pagedListSession";

// Support the surrounding logic for this step.
export { isStaleGeneration };

// Export REPAIRS_PAGE_SIZE for use by other modules.
export const REPAIRS_PAGE_SIZE = 50;

// Export type definition for consumers of this module.
export type TicketListPage = {
  // Provide items field used by this structure.
  items: MaintenanceTicket[];
  // Provide nextCursor field used by this structure.
  nextCursor: string | null;
  // Provide total field used by this structure.
  total: number;
};

// Export type definition for consumers of this module.
export type RepairsListViewState = {
  // Provide tickets field used by this structure.
  tickets: MaintenanceTicket[];
  // Provide nextCursor field used by this structure.
  nextCursor: string | null;
  // Provide totalCount field used by this structure.
  totalCount: number | null;
  // Provide loadError field used by this structure.
  loadError: string | null;
  // Provide loading field used by this structure.
  loading: boolean;
  // Provide loadingMore field used by this structure.
  loadingMore: boolean;
};

// Export EMPTY_REPAIRS_LIST_STATE for use by other modules.
export const EMPTY_REPAIRS_LIST_STATE: RepairsListViewState = {
  // Provide tickets field used by this structure.
  tickets: [],
  // Provide nextCursor field used by this structure.
  nextCursor: null,
  // Provide totalCount field used by this structure.
  totalCount: null,
  // Provide loadError field used by this structure.
  loadError: null,
  // Provide loading field used by this structure.
  loading: false,
  // Provide loadingMore field used by this structure.
  loadingMore: false,
};

/** Append page items without duplicating ids already present. */
export function mergeTicketPages(
  // Provide existing field used by this structure.
  existing: MaintenanceTicket[],
  // Provide incoming field used by this structure.
  incoming: MaintenanceTicket[],
// Support the surrounding logic for this step.
): MaintenanceTicket[] {
  // Return early result or rendered output from this path.
  return mergeByKey(existing, incoming, (t) => t.id);
}

// Export type definition for consumers of this module.
export type FetchTicketsPage = (args: {
  // Support the surrounding logic for this step.
  cursor?: string | null;
  // Provide signal field used by this structure.
  signal: AbortSignal;
// Support the surrounding logic for this step.
}) => Promise<TicketListPage>;

// Export type definition for consumers of this module.
export type RepairsListSession = Omit<
  // Support the surrounding logic for this step.
  PagedListSessionApi<TicketListPage, RepairsListViewState>,
  // Support the surrounding logic for this step.
  "isSearchPending" | "invalidatePendingSearch"
// Support the surrounding logic for this step.
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
  // Support the surrounding logic for this step.
  onChange?: (state: RepairsListViewState) => void,
// Support the surrounding logic for this step.
): RepairsListSession {
  // Bind session for use in the following logic.
  const session = createPagedListSession<TicketListPage, RepairsListViewState>({
    // Provide emptyState field used by this structure.
    emptyState: EMPTY_REPAIRS_LIST_STATE,
    // Support the surrounding logic for this step.
    onChange,
    // Provide beginFullReloadState field used by this structure.
    beginFullReloadState: () => ({
      // Provide tickets field used by this structure.
      tickets: [],
      // Provide nextCursor field used by this structure.
      nextCursor: null,
      // Provide totalCount field used by this structure.
      totalCount: null,
      // Provide loadError field used by this structure.
      loadError: null,
      // Provide loading field used by this structure.
      loading: true,
      // Provide loadingMore field used by this structure.
      loadingMore: false,
    }),
    // Provide commitFullReloadSuccess field used by this structure.
    commitFullReloadSuccess: (page) => ({
      // Provide tickets field used by this structure.
      tickets: page.items,
      // Provide nextCursor field used by this structure.
      nextCursor: page.nextCursor,
      // Provide totalCount field used by this structure.
      totalCount: page.total,
      // Provide loadError field used by this structure.
      loadError: null,
      // Provide loading field used by this structure.
      loading: false,
      // Provide loadingMore field used by this structure.
      loadingMore: false,
    }),
    // Provide commitLoadMoreSuccess field used by this structure.
    commitLoadMoreSuccess: (prev, page) => ({
      // Spread prior fields/items so overrides can layer cleanly.
      ...prev,
      // Provide tickets field used by this structure.
      tickets: mergeTicketPages(prev.tickets, page.items),
      // Provide nextCursor field used by this structure.
      nextCursor: page.nextCursor,
      // Provide totalCount field used by this structure.
      totalCount: page.total,
      // Provide loadError field used by this structure.
      loadError: null,
      // Provide loadingMore field used by this structure.
      loadingMore: false,
    }),
  });

  // Repairs UI does not use search-pending; omit those methods from the public type.
  const {
    // Provide isSearchPending field used by this structure.
    isSearchPending: _isSearchPending,
    // Provide invalidatePendingSearch field used by this structure.
    invalidatePendingSearch: _invalidatePendingSearch,
    // Spread prior fields/items so overrides can layer cleanly.
    ...publicSession
  // Support the surrounding logic for this step.
  } = session;
  // Return early result or rendered output from this path.
  return publicSession;
}

/**
 * Run a full reload through the session with the provided fetch function.
 * Safe to call concurrently — only the latest generation commits.
 */
export async function runFullReload(
  // Provide session field used by this structure.
  session: RepairsListSession,
  // Provide fetchPage field used by this structure.
  fetchPage: FetchTicketsPage,
  // Provide mapError field used by this structure.
  mapError: (err: unknown) => string,
// Support the surrounding logic for this step.
): Promise<void> {
  // Return early result or rendered output from this path.
  return runPagedFullReload(session, fetchPage, mapError);
}

/**
 * Run load-more through the session. No-op when beginLoadMore returns null.
 */
export async function runLoadMore(
  // Provide session field used by this structure.
  session: RepairsListSession,
  // Provide cursor field used by this structure.
  cursor: string | null,
  // Provide fetchPage field used by this structure.
  fetchPage: FetchTicketsPage,
  // Provide mapError field used by this structure.
  mapError: (err: unknown) => string,
// Support the surrounding logic for this step.
): Promise<boolean> {
  // Return early result or rendered output from this path.
  return runPagedLoadMore(session, cursor, fetchPage, mapError);
}
