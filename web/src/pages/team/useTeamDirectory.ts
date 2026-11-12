// Import module dependency from react.
import { useCallback, useEffect, useRef, useState } from "react";
// Import module dependency from ../../api/client.
import { fetchPeoplePage, type Role } from "../../api/client";
// Import module dependency from ./debouncedSearch.
import { createDebouncedSearch, type DebouncedSearchBridge } from "./debouncedSearch";
// Import module dependency from ./labels.
import { t } from "./labels";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  createPeopleListSession,
  // Support the surrounding logic for this step.
  runPeopleFullReload,
  // Support the surrounding logic for this step.
  runPeopleLoadMore,
  // Declare type alias PeopleListViewState.
  type PeopleListViewState,
// Support the surrounding logic for this step.
} from "./peopleListSession";
// Import module dependency from ./teamListConstants.
import { TEAM_PAGE_SIZE, TEAM_SEARCH_DEBOUNCE_MS } from "./teamListConstants";

// Export type definition for consumers of this module.
export type TeamDirectoryFilters = {
  // Provide role field used by this structure.
  role: "" | Role;
  // Provide includeInactive field used by this structure.
  includeInactive: boolean;
  // Provide includeArchived field used by this structure.
  includeArchived: boolean;
  // Provide notOnboarded field used by this structure.
  notOnboarded: boolean;
};

// Export type definition for consumers of this module.
export type UseTeamDirectoryOptions = {
  // Provide locale field used by this structure.
  locale: "bg" | "en";
  // Provide setBannerError field used by this structure.
  setBannerError: (message: string | null) => void;
  /** Called after directory reload triggered by filter changes (not search debounce). */
  onFiltersReloadSideEffects?: () => void | Promise<void>;
};

// Export type definition for consumers of this module.
export type UseTeamDirectoryResult = {
  // Provide q field used by this structure.
  q: string;
  // Provide role field used by this structure.
  role: "" | Role;
  // Provide setRole field used by this structure.
  setRole: (value: "" | Role) => void;
  // Provide includeInactive field used by this structure.
  includeInactive: boolean;
  // Provide setIncludeInactive field used by this structure.
  setIncludeInactive: (value: boolean) => void;
  // Provide includeArchived field used by this structure.
  includeArchived: boolean;
  // Provide setIncludeArchived field used by this structure.
  setIncludeArchived: (value: boolean) => void;
  // Provide notOnboarded field used by this structure.
  notOnboarded: boolean;
  // Provide setNotOnboarded field used by this structure.
  setNotOnboarded: (value: boolean) => void;
  // Provide directoryState field used by this structure.
  directoryState: PeopleListViewState;
  // Provide loadError field used by this structure.
  loadError: string | null;
  // Provide loading field used by this structure.
  loading: boolean;
  // Provide refreshing field used by this structure.
  refreshing: boolean;
  // Provide loadingMore field used by this structure.
  loadingMore: boolean;
  // Provide loadMoreBlocked field used by this structure.
  loadMoreBlocked: boolean;
  // Provide people field used by this structure.
  people: PeopleListViewState["people"];
  // Provide peopleCursor field used by this structure.
  peopleCursor: string | null;
  // Provide onDirectorySearchInput field used by this structure.
  onDirectorySearchInput: (value: string) => void;
  // Provide onRefreshDirectoryClick field used by this structure.
  onRefreshDirectoryClick: () => Promise<void>;
  // Provide onLoadMoreDirectory field used by this structure.
  onLoadMoreDirectory: () => Promise<void>;
  // Provide reloadDirectory field used by this structure.
  reloadDirectory: () => Promise<void>;
  // Provide reloadDirectoryWithQuery field used by this structure.
  reloadDirectoryWithQuery: (query: string) => Promise<void>;
  // Provide getCommittedDirectoryQuery field used by this structure.
  getCommittedDirectoryQuery: () => string;
};

// Export function useTeamDirectory as part of this module's API.
export function useTeamDirectory({
  // Support the surrounding logic for this step.
  locale,
  // Support the surrounding logic for this step.
  setBannerError,
  // Support the surrounding logic for this step.
  onFiltersReloadSideEffects,
// Support the surrounding logic for this step.
}: UseTeamDirectoryOptions): UseTeamDirectoryResult {
  // React state slot for local UI/data that can change over time.
  const [q, setQ] = useState("");
  // React state slot for local UI/data that can change over time.
  const [role, setRole] = useState<"" | Role>("");
  // React state slot for local UI/data that can change over time.
  const [includeInactive, setIncludeInactive] = useState(false);
  // React state slot for local UI/data that can change over time.
  const [includeArchived, setIncludeArchived] = useState(false);
  // React state slot for local UI/data that can change over time.
  const [notOnboarded, setNotOnboarded] = useState(false);
  // React state slot for local UI/data that can change over time.
  const [directoryLoadedOnce, setDirectoryLoadedOnce] = useState(false);

  // React state slot for local UI/data that can change over time.
  const [directoryState, setDirectoryState] = useState<PeopleListViewState>({
    // Provide people field used by this structure.
    people: [],
    // Provide nextCursor field used by this structure.
    nextCursor: null,
    // Provide loadError field used by this structure.
    loadError: null,
    // Provide loading field used by this structure.
    loading: true,
    // Provide loadingMore field used by this structure.
    loadingMore: false,
  });
  // Hold a mutable ref that persists across renders without re-render.
  const directorySessionRef = useRef(
    // Invoke createPeopleListSession to perform this step.
    createPeopleListSession((next) => setDirectoryState({ ...next })),
  );

  // Bind directoryFiltersRef for use in the following logic.
  const directoryFiltersRef = useRef<TeamDirectoryFilters>({
    // Support the surrounding logic for this step.
    role,
    // Support the surrounding logic for this step.
    includeInactive,
    // Support the surrounding logic for this step.
    includeArchived,
    // Support the surrounding logic for this step.
    notOnboarded,
  });
  // Pass directoryFiltersRef.current prop/value into the element or config.
  directoryFiltersRef.current = {
    // Support the surrounding logic for this step.
    role,
    // Support the surrounding logic for this step.
    includeInactive,
    // Support the surrounding logic for this step.
    includeArchived,
    // Support the surrounding logic for this step.
    notOnboarded,
  };

  // Memoize callback identity for stable child/effect deps.
  const mapPeopleError = useCallback(
    // Support the surrounding logic for this step.
    (err: unknown) =>
      // Support the surrounding logic for this step.
      err instanceof Error
        // Support the surrounding logic for this step.
        ? err.message
        // Support the surrounding logic for this step.
        : t(locale, "Неуспешно зареждане на хората", "Failed to load people"),
    // Support the surrounding logic for this step.
    [locale],
  );

  // Memoize callback identity for stable child/effect deps.
  const reloadDirectoryWithQuery = useCallback(
    // Support the surrounding logic for this step.
    async (query: string) => {
      // Update React state so the UI reflects the new value.
      setBannerError(null);
      // Bind filters for use in the following logic.
      const filters = directoryFiltersRef.current;
      // Wait for an async operation before continuing.
      await runPeopleFullReload(
        // Support the surrounding logic for this step.
        directorySessionRef.current,
        // Support the surrounding logic for this step.
        (args) =>
          // Invoke fetchPeoplePage to perform this step.
          fetchPeoplePage(
            {
              // Provide q field used by this structure.
              q: query || undefined,
              // Provide role field used by this structure.
              role: filters.role || undefined,
              // Provide includeInactive field used by this structure.
              includeInactive: filters.includeInactive,
              // Provide includeArchived field used by this structure.
              includeArchived: filters.includeArchived,
              // Provide notOnboarded field used by this structure.
              notOnboarded: filters.notOnboarded || undefined,
              // Provide limit field used by this structure.
              limit: TEAM_PAGE_SIZE,
            },
            // Support the surrounding logic for this step.
            { signal: args.signal },
          ),
        // Support the surrounding logic for this step.
        mapPeopleError,
      );
      // Update React state so the UI reflects the new value.
      setDirectoryLoadedOnce(true);
    },
    // Support the surrounding logic for this step.
    [mapPeopleError, setBannerError],
  );

  // Hold a mutable ref that persists across renders without re-render.
  const reloadDirectoryWithQueryRef = useRef(reloadDirectoryWithQuery);
  // Support the surrounding logic for this step.
  reloadDirectoryWithQueryRef.current = reloadDirectoryWithQuery;

  // Bind directorySearchRef for use in the following logic.
  const directorySearchRef = useRef<DebouncedSearchBridge | null>(null);
  // Conditional branch for the case described by this guard.
  if (directorySearchRef.current === null) {
    // Support the surrounding logic for this step.
    directorySearchRef.current = createDebouncedSearch({
      // Provide debounceMs field used by this structure.
      debounceMs: TEAM_SEARCH_DEBOUNCE_MS,
      // Provide onInvalidate field used by this structure.
      onInvalidate: () => {
        // Invoke directorySessionRef.current.invalidatePendingSearch to perform this step.
        directorySessionRef.current.invalidatePendingSearch();
      },
      // Provide onCommit field used by this structure.
      onCommit: (committed) => {
        // Fire-and-forget async work without awaiting in this path.
        void reloadDirectoryWithQueryRef.current(committed);
      },
    });
  }

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Bind directory for use in the following logic.
    const directory = directorySessionRef.current;
    // Bind directorySearch for use in the following logic.
    const directorySearch = directorySearchRef.current;
    // Return early result or rendered output from this path.
    return () => {
      // Support the surrounding logic for this step.
      directorySearch?.dispose();
      // Invoke directory.dispose to perform this step.
      directory.dispose();
    };
  // Support the surrounding logic for this step.
  }, []);

  // Memoize callback identity for stable child/effect deps.
  const getCommittedDirectoryQuery = useCallback(
    // Support the surrounding logic for this step.
    () => directorySearchRef.current?.getCommitted() ?? "",
    // Support the surrounding logic for this step.
    [],
  );

  // Memoize callback identity for stable child/effect deps.
  const reloadDirectory = useCallback(async () => {
    // Wait for an async operation before continuing.
    await reloadDirectoryWithQuery(getCommittedDirectoryQuery());
  // Support the surrounding logic for this step.
  }, [getCommittedDirectoryQuery, reloadDirectoryWithQuery]);

  // Hold a mutable ref that persists across renders without re-render.
  const onFiltersReloadSideEffectsRef = useRef(onFiltersReloadSideEffects);
  // Support the surrounding logic for this step.
  onFiltersReloadSideEffectsRef.current = onFiltersReloadSideEffects;

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Bind cancelled for use in the following logic.
    let cancelled = false;
    // Support the surrounding logic for this step.
    (async () => {
      // Wait for an async operation before continuing.
      await reloadDirectoryWithQuery(
        // Support the surrounding logic for this step.
        directorySearchRef.current?.getCommitted() ?? "",
      );
      // Conditional branch for the case described by this guard.
      if (cancelled) return;
      // Begin guarded block to catch runtime failures.
      try {
        // Wait for an async operation before continuing.
        await onFiltersReloadSideEffectsRef.current?.();
      // Support the surrounding logic for this step.
      } catch {
        // side effects set banner themselves
      }
    // Support the surrounding logic for this step.
    })();
    // Return early result or rendered output from this path.
    return () => {
      // Support the surrounding logic for this step.
      cancelled = true;
    };
  // Support the surrounding logic for this step.
  }, [
    // Support the surrounding logic for this step.
    role,
    // Support the surrounding logic for this step.
    includeInactive,
    // Support the surrounding logic for this step.
    includeArchived,
    // Support the surrounding logic for this step.
    notOnboarded,
    // Support the surrounding logic for this step.
    reloadDirectoryWithQuery,
  // Support the surrounding logic for this step.
  ]);

  // Memoize callback identity for stable child/effect deps.
  const onLoadMoreDirectory = useCallback(async () => {
    // Update React state so the UI reflects the new value.
    setBannerError(null);
    // Bind query for use in the following logic.
    const query = directorySearchRef.current?.getCommitted() ?? "";
    // Bind filters for use in the following logic.
    const filters = directoryFiltersRef.current;
    // Wait for an async operation before continuing.
    await runPeopleLoadMore(
      // Support the surrounding logic for this step.
      directorySessionRef.current,
      // Invoke directorySessionRef.current.getState to perform this step.
      directorySessionRef.current.getState().nextCursor,
      // Support the surrounding logic for this step.
      (args) =>
        // Invoke fetchPeoplePage to perform this step.
        fetchPeoplePage(
          {
            // Provide q field used by this structure.
            q: query || undefined,
            // Provide role field used by this structure.
            role: filters.role || undefined,
            // Provide includeInactive field used by this structure.
            includeInactive: filters.includeInactive,
            // Provide includeArchived field used by this structure.
            includeArchived: filters.includeArchived,
            // Provide notOnboarded field used by this structure.
            notOnboarded: filters.notOnboarded || undefined,
            // Provide limit field used by this structure.
            limit: TEAM_PAGE_SIZE,
            // Provide cursor field used by this structure.
            cursor: args.cursor || undefined,
          },
          // Support the surrounding logic for this step.
          { signal: args.signal },
        ),
      // Support the surrounding logic for this step.
      mapPeopleError,
    );
  // Support the surrounding logic for this step.
  }, [mapPeopleError, setBannerError]);

  // Memoize callback identity for stable child/effect deps.
  const onRefreshDirectoryClick = useCallback(async () => {
    // Update React state so the UI reflects the new value.
    setBannerError(null);
    // Bind query for use in the following logic.
    const query =
      // Support the surrounding logic for this step.
      directorySearchRef.current?.forceCommitFromInput() ?? q.trim();
    // Wait for an async operation before continuing.
    await reloadDirectoryWithQuery(query);
  // Support the surrounding logic for this step.
  }, [q, reloadDirectoryWithQuery, setBannerError]);

  // Memoize callback identity for stable child/effect deps.
  const onDirectorySearchInput = useCallback((value: string) => {
    // Update React state so the UI reflects the new value.
    setQ(value);
    // Support the surrounding logic for this step.
    directorySearchRef.current?.onInput(value);
  // Support the surrounding logic for this step.
  }, []);

  // Bind loading for use in the following logic.
  const loading = directoryState.loading && !directoryLoadedOnce;
  // Bind refreshing for use in the following logic.
  const refreshing = directoryState.loading && directoryLoadedOnce;
  // Bind loadingMore for use in the following logic.
  const loadingMore = directoryState.loadingMore;
  // Bind directorySearchPending for use in the following logic.
  const directorySearchPending =
    // Invoke directorySessionRef.current.isSearchPending to perform this step.
    directorySessionRef.current.isSearchPending();
  // Bind loadMoreBlocked for use in the following logic.
  const loadMoreBlocked =
    // Support the surrounding logic for this step.
    loading ||
    // Support the surrounding logic for this step.
    refreshing ||
    // Support the surrounding logic for this step.
    loadingMore ||
    // Support the surrounding logic for this step.
    directorySearchPending ||
    // Invoke directorySessionRef.current.isFullReloadInFlight to perform this step.
    directorySessionRef.current.isFullReloadInFlight();

  // Return early result or rendered output from this path.
  return {
    q,
    // Support the surrounding logic for this step.
    role,
    // Support the surrounding logic for this step.
    setRole,
    // Support the surrounding logic for this step.
    includeInactive,
    // Support the surrounding logic for this step.
    setIncludeInactive,
    // Support the surrounding logic for this step.
    includeArchived,
    // Support the surrounding logic for this step.
    setIncludeArchived,
    // Support the surrounding logic for this step.
    notOnboarded,
    // Support the surrounding logic for this step.
    setNotOnboarded,
    // Support the surrounding logic for this step.
    directoryState,
    // Provide loadError field used by this structure.
    loadError: directoryState.loadError,
    // Support the surrounding logic for this step.
    loading,
    // Support the surrounding logic for this step.
    refreshing,
    // Support the surrounding logic for this step.
    loadingMore,
    // Support the surrounding logic for this step.
    loadMoreBlocked,
    // Provide people field used by this structure.
    people: directoryState.people,
    // Provide peopleCursor field used by this structure.
    peopleCursor: directoryState.nextCursor,
    // Support the surrounding logic for this step.
    onDirectorySearchInput,
    // Support the surrounding logic for this step.
    onRefreshDirectoryClick,
    // Support the surrounding logic for this step.
    onLoadMoreDirectory,
    // Support the surrounding logic for this step.
    reloadDirectory,
    // Support the surrounding logic for this step.
    reloadDirectoryWithQuery,
    // Support the surrounding logic for this step.
    getCommittedDirectoryQuery,
  };
}
