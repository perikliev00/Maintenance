/**
 * Team people list session adapter (directory / Existing).
 * Keeps prior rows visible during full reload; supports debounced search pending.
 */
import type { Person } from "../../api/client";
import {
  createPagedListSession,
  isStaleGeneration,
  mergeByKey,
  runPagedFullReload,
  runPagedLoadMore,
  type PagedListSessionApi,
} from "../../lib/pagedListSession";

export { isStaleGeneration };

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

// Export EMPTY_PEOPLE_LIST_STATE for use by other modules.
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
  return mergeByKey(existing, incoming, (p) => p.employeeId);
}

export type FetchPeopleListPage = (args: {
  cursor?: string | null;
  signal: AbortSignal;
}) => Promise<PeopleListPage>;

export type PeopleListSession = PagedListSessionApi<
  PeopleListPage,
  PeopleListViewState
>;

/**
 * Create a list-fetch session that serializes generations across full reloads
 * and load-more. Callers perform network I/O; the session decides commits.
 */
export function createPeopleListSession(
  onChange?: (state: PeopleListViewState) => void,
): PeopleListSession {
  return createPagedListSession<PeopleListPage, PeopleListViewState>({
    emptyState: EMPTY_PEOPLE_LIST_STATE,
    enableSearchPending: true,
    onChange,
    beginSearchPendingState: (prev) => ({
      ...prev,
      nextCursor: null,
      loadError: null,
      loading: true,
      loadingMore: false,
    }),
    beginFullReloadState: (prev) => ({
      ...prev,
      // Keep previous rows visible until the new page lands (Team UX),
      // but clear cursor so Load more cannot use a stale continuation.
      nextCursor: null,
      loadError: null,
      loading: true,
      loadingMore: false,
    }),
    commitFullReloadSuccess: (page) => ({
      people: page.items,
      nextCursor: page.nextCursor,
      loadError: null,
      loading: false,
      loadingMore: false,
    }),
    commitLoadMoreSuccess: (prev, page) => ({
      ...prev,
      people: mergePeoplePages(prev.people, page.items),
      nextCursor: page.nextCursor,
      loadError: null,
      loadingMore: false,
    }),
  });
}

/** Run a full reload through the session. Only the latest generation commits. */
export async function runPeopleFullReload(
  session: PeopleListSession,
  fetchPage: FetchPeopleListPage,
  mapError: (err: unknown) => string,
): Promise<void> {
  return runPagedFullReload(session, fetchPage, mapError);
}

/** Run load-more through the session. No-op when beginLoadMore returns null. */
export async function runPeopleLoadMore(
  session: PeopleListSession,
  cursor: string | null,
  fetchPage: FetchPeopleListPage,
  mapError: (err: unknown) => string,
): Promise<boolean> {
  return runPagedLoadMore(session, cursor, fetchPage, mapError);
}
