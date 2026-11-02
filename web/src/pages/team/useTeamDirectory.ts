import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPeoplePage, type Role } from "../../api/client";
import { createDebouncedSearch, type DebouncedSearchBridge } from "./debouncedSearch";
import { t } from "./labels";
import {
  createPeopleListSession,
  runPeopleFullReload,
  runPeopleLoadMore,
  type PeopleListViewState,
} from "./peopleListSession";
import { TEAM_PAGE_SIZE, TEAM_SEARCH_DEBOUNCE_MS } from "./teamListConstants";

export type TeamDirectoryFilters = {
  role: "" | Role;
  includeInactive: boolean;
  includeArchived: boolean;
  notOnboarded: boolean;
};

export type UseTeamDirectoryOptions = {
  locale: "bg" | "en";
  setBannerError: (message: string | null) => void;
  /** Called after directory reload triggered by filter changes (not search debounce). */
  onFiltersReloadSideEffects?: () => void | Promise<void>;
};

export type UseTeamDirectoryResult = {
  q: string;
  role: "" | Role;
  setRole: (value: "" | Role) => void;
  includeInactive: boolean;
  setIncludeInactive: (value: boolean) => void;
  includeArchived: boolean;
  setIncludeArchived: (value: boolean) => void;
  notOnboarded: boolean;
  setNotOnboarded: (value: boolean) => void;
  directoryState: PeopleListViewState;
  loadError: string | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  loadMoreBlocked: boolean;
  people: PeopleListViewState["people"];
  peopleCursor: string | null;
  onDirectorySearchInput: (value: string) => void;
  onRefreshDirectoryClick: () => Promise<void>;
  onLoadMoreDirectory: () => Promise<void>;
  reloadDirectory: () => Promise<void>;
  reloadDirectoryWithQuery: (query: string) => Promise<void>;
  getCommittedDirectoryQuery: () => string;
};

export function useTeamDirectory({
  locale,
  setBannerError,
  onFiltersReloadSideEffects,
}: UseTeamDirectoryOptions): UseTeamDirectoryResult {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"" | Role>("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [notOnboarded, setNotOnboarded] = useState(false);
  const [directoryLoadedOnce, setDirectoryLoadedOnce] = useState(false);

  const [directoryState, setDirectoryState] = useState<PeopleListViewState>({
    people: [],
    nextCursor: null,
    loadError: null,
    loading: true,
    loadingMore: false,
  });
  const directorySessionRef = useRef(
    createPeopleListSession((next) => setDirectoryState({ ...next })),
  );

  const directoryFiltersRef = useRef<TeamDirectoryFilters>({
    role,
    includeInactive,
    includeArchived,
    notOnboarded,
  });
  directoryFiltersRef.current = {
    role,
    includeInactive,
    includeArchived,
    notOnboarded,
  };

  const mapPeopleError = useCallback(
    (err: unknown) =>
      err instanceof Error
        ? err.message
        : t(locale, "Неуспешно зареждане на хората", "Failed to load people"),
    [locale],
  );

  const reloadDirectoryWithQuery = useCallback(
    async (query: string) => {
      setBannerError(null);
      const filters = directoryFiltersRef.current;
      await runPeopleFullReload(
        directorySessionRef.current,
        (args) =>
          fetchPeoplePage(
            {
              q: query || undefined,
              role: filters.role || undefined,
              includeInactive: filters.includeInactive,
              includeArchived: filters.includeArchived,
              notOnboarded: filters.notOnboarded || undefined,
              limit: TEAM_PAGE_SIZE,
            },
            { signal: args.signal },
          ),
        mapPeopleError,
      );
      setDirectoryLoadedOnce(true);
    },
    [mapPeopleError, setBannerError],
  );

  const reloadDirectoryWithQueryRef = useRef(reloadDirectoryWithQuery);
  reloadDirectoryWithQueryRef.current = reloadDirectoryWithQuery;

  const directorySearchRef = useRef<DebouncedSearchBridge | null>(null);
  if (directorySearchRef.current === null) {
    directorySearchRef.current = createDebouncedSearch({
      debounceMs: TEAM_SEARCH_DEBOUNCE_MS,
      onInvalidate: () => {
        directorySessionRef.current.invalidatePendingSearch();
      },
      onCommit: (committed) => {
        void reloadDirectoryWithQueryRef.current(committed);
      },
    });
  }

  useEffect(() => {
    const directory = directorySessionRef.current;
    const directorySearch = directorySearchRef.current;
    return () => {
      directorySearch?.dispose();
      directory.dispose();
    };
  }, []);

  const getCommittedDirectoryQuery = useCallback(
    () => directorySearchRef.current?.getCommitted() ?? "",
    [],
  );

  const reloadDirectory = useCallback(async () => {
    await reloadDirectoryWithQuery(getCommittedDirectoryQuery());
  }, [getCommittedDirectoryQuery, reloadDirectoryWithQuery]);

  const onFiltersReloadSideEffectsRef = useRef(onFiltersReloadSideEffects);
  onFiltersReloadSideEffectsRef.current = onFiltersReloadSideEffects;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await reloadDirectoryWithQuery(
        directorySearchRef.current?.getCommitted() ?? "",
      );
      if (cancelled) return;
      try {
        await onFiltersReloadSideEffectsRef.current?.();
      } catch {
        // side effects set banner themselves
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    role,
    includeInactive,
    includeArchived,
    notOnboarded,
    reloadDirectoryWithQuery,
  ]);

  const onLoadMoreDirectory = useCallback(async () => {
    setBannerError(null);
    const query = directorySearchRef.current?.getCommitted() ?? "";
    const filters = directoryFiltersRef.current;
    await runPeopleLoadMore(
      directorySessionRef.current,
      directorySessionRef.current.getState().nextCursor,
      (args) =>
        fetchPeoplePage(
          {
            q: query || undefined,
            role: filters.role || undefined,
            includeInactive: filters.includeInactive,
            includeArchived: filters.includeArchived,
            notOnboarded: filters.notOnboarded || undefined,
            limit: TEAM_PAGE_SIZE,
            cursor: args.cursor || undefined,
          },
          { signal: args.signal },
        ),
      mapPeopleError,
    );
  }, [mapPeopleError, setBannerError]);

  const onRefreshDirectoryClick = useCallback(async () => {
    setBannerError(null);
    const query =
      directorySearchRef.current?.forceCommitFromInput() ?? q.trim();
    await reloadDirectoryWithQuery(query);
  }, [q, reloadDirectoryWithQuery, setBannerError]);

  const onDirectorySearchInput = useCallback((value: string) => {
    setQ(value);
    directorySearchRef.current?.onInput(value);
  }, []);

  const loading = directoryState.loading && !directoryLoadedOnce;
  const refreshing = directoryState.loading && directoryLoadedOnce;
  const loadingMore = directoryState.loadingMore;
  const directorySearchPending =
    directorySessionRef.current.isSearchPending();
  const loadMoreBlocked =
    loading ||
    refreshing ||
    loadingMore ||
    directorySearchPending ||
    directorySessionRef.current.isFullReloadInFlight();

  return {
    q,
    role,
    setRole,
    includeInactive,
    setIncludeInactive,
    includeArchived,
    setIncludeArchived,
    notOnboarded,
    setNotOnboarded,
    directoryState,
    loadError: directoryState.loadError,
    loading,
    refreshing,
    loadingMore,
    loadMoreBlocked,
    people: directoryState.people,
    peopleCursor: directoryState.nextCursor,
    onDirectorySearchInput,
    onRefreshDirectoryClick,
    onLoadMoreDirectory,
    reloadDirectory,
    reloadDirectoryWithQuery,
    getCommittedDirectoryQuery,
  };
}
