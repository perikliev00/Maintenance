/**
 * Team people list session adapter (directory / Existing).
 * Keeps prior rows visible during full reload; supports debounced search pending.
 */
import type { Person } from "../../api/client";
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

// Export type definition for consumers of this module.
export type PeopleListPage = {
  // Provide items field used by this structure.
  items: Person[];
  // Provide nextCursor field used by this structure.
  nextCursor: string | null;
};

// Export type definition for consumers of this module.
export type PeopleListViewState = {
  // Provide people field used by this structure.
  people: Person[];
  // Provide nextCursor field used by this structure.
  nextCursor: string | null;
  // Provide loadError field used by this structure.
  loadError: string | null;
  // Provide loading field used by this structure.
  loading: boolean;
  // Provide loadingMore field used by this structure.
  loadingMore: boolean;
};

// Export EMPTY_PEOPLE_LIST_STATE for use by other modules.
export const EMPTY_PEOPLE_LIST_STATE: PeopleListViewState = {
  // Provide people field used by this structure.
  people: [],
  // Provide nextCursor field used by this structure.
  nextCursor: null,
  // Provide loadError field used by this structure.
  loadError: null,
  // Provide loading field used by this structure.
  loading: false,
  // Provide loadingMore field used by this structure.
  loadingMore: false,
};

/** Append page items without duplicating employeeId already present. */
export function mergePeoplePages(
  // Provide existing field used by this structure.
  existing: Person[],
  // Provide incoming field used by this structure.
  incoming: Person[],
// Support the surrounding logic for this step.
): Person[] {
  // Return early result or rendered output from this path.
  return mergeByKey(existing, incoming, (p) => p.employeeId);
}

// Export type definition for consumers of this module.
export type FetchPeopleListPage = (args: {
  // Support the surrounding logic for this step.
  cursor?: string | null;
  // Provide signal field used by this structure.
  signal: AbortSignal;
// Support the surrounding logic for this step.
}) => Promise<PeopleListPage>;

// Export type definition for consumers of this module.
export type PeopleListSession = PagedListSessionApi<
  // Support the surrounding logic for this step.
  PeopleListPage,
  // Support the surrounding logic for this step.
  PeopleListViewState
>;

/**
 * Create a list-fetch session that serializes generations across full reloads
 * and load-more. Callers perform network I/O; the session decides commits.
 */
export function createPeopleListSession(
  // Support the surrounding logic for this step.
  onChange?: (state: PeopleListViewState) => void,
// Support the surrounding logic for this step.
): PeopleListSession {
  // Return early result or rendered output from this path.
  return createPagedListSession<PeopleListPage, PeopleListViewState>({
    // Provide emptyState field used by this structure.
    emptyState: EMPTY_PEOPLE_LIST_STATE,
    // Provide enableSearchPending field used by this structure.
    enableSearchPending: true,
    // Support the surrounding logic for this step.
    onChange,
    // Provide beginSearchPendingState field used by this structure.
    beginSearchPendingState: (prev) => ({
      // Spread prior fields/items so overrides can layer cleanly.
      ...prev,
      // Provide nextCursor field used by this structure.
      nextCursor: null,
      // Provide loadError field used by this structure.
      loadError: null,
      // Provide loading field used by this structure.
      loading: true,
      // Provide loadingMore field used by this structure.
      loadingMore: false,
    }),
    // Provide beginFullReloadState field used by this structure.
    beginFullReloadState: (prev) => ({
      // Spread prior fields/items so overrides can layer cleanly.
      ...prev,
      // Keep previous rows visible until the new page lands (Team UX),
      // but clear cursor so Load more cannot use a stale continuation.
      nextCursor: null,
      // Provide loadError field used by this structure.
      loadError: null,
      // Provide loading field used by this structure.
      loading: true,
      // Provide loadingMore field used by this structure.
      loadingMore: false,
    }),
    // Provide commitFullReloadSuccess field used by this structure.
    commitFullReloadSuccess: (page) => ({
      // Provide people field used by this structure.
      people: page.items,
      // Provide nextCursor field used by this structure.
      nextCursor: page.nextCursor,
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
      // Provide people field used by this structure.
      people: mergePeoplePages(prev.people, page.items),
      // Provide nextCursor field used by this structure.
      nextCursor: page.nextCursor,
      // Provide loadError field used by this structure.
      loadError: null,
      // Provide loadingMore field used by this structure.
      loadingMore: false,
    }),
  });
}

/** Run a full reload through the session. Only the latest generation commits. */
export async function runPeopleFullReload(
  // Provide session field used by this structure.
  session: PeopleListSession,
  // Provide fetchPage field used by this structure.
  fetchPage: FetchPeopleListPage,
  // Provide mapError field used by this structure.
  mapError: (err: unknown) => string,
// Support the surrounding logic for this step.
): Promise<void> {
  // Return early result or rendered output from this path.
  return runPagedFullReload(session, fetchPage, mapError);
}

/** Run load-more through the session. No-op when beginLoadMore returns null. */
export async function runPeopleLoadMore(
  // Provide session field used by this structure.
  session: PeopleListSession,
  // Provide cursor field used by this structure.
  cursor: string | null,
  // Provide fetchPage field used by this structure.
  fetchPage: FetchPeopleListPage,
  // Provide mapError field used by this structure.
  mapError: (err: unknown) => string,
// Support the surrounding logic for this step.
): Promise<boolean> {
  // Return early result or rendered output from this path.
  return runPagedLoadMore(session, cursor, fetchPage, mapError);
}
