/**
 * Locations board data ownership: rooms list, busy set, refresh/live refresh,
 * housekeepers, filters, detail/reassign/repairs overlays, and runAction.
 * Overdue fetch lives in `useLocationsOverdue`; issue form in `useLocationIssueForm`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  fetchCommonAreas,
  // Support the surrounding logic for this step.
  fetchHousekeepers,
  // Support the surrounding logic for this step.
  fetchRooms,
  // Declare type alias AuthUser.
  type AuthUser,
  // Declare type alias Room.
  type Room,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ../../hooks/useLiveRefresh.
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
// Import module dependency from ../../saveRefresh.
import { executeMutationWithRefresh } from "../../saveRefresh";
// Import module dependency from ./audit.
import { useLocationAudit } from "./audit";
// Import module dependency from ./busyIds.
import { addBusyId, removeBusyId } from "./busyIds";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  applyRoomFilters,
  // Support the surrounding logic for this step.
  EMPTY_ROOM_FILTERS,
  // Support the surrounding logic for this step.
  uniqueSorted,
  // Declare type alias RoomBoardFilters.
  type RoomBoardFilters,
// Support the surrounding logic for this step.
} from "./filters";
// Import module dependency from ./labels.
import { boardT, type BoardLocale } from "./labels";
// Import module dependency from ./occupancy.
import { makeOccupancyHandlers } from "./occupancy";
// Import module dependency from ./overdueState.
import { overdueFilterReliable } from "./overdueState";
// Import module dependency from ./permissions.
import { locationPagePermissions } from "./permissions";
// Import type-only dependency for typing without runtime cost.
import type { LocationKindFilter } from "./types";
// Import module dependency from ./useLocationsOverdue.
import { useLocationsOverdue } from "./useLocationsOverdue";

// Export type definition for consumers of this module.
export type UseLocationsBoardOptions = {
  // Provide user field used by this structure.
  user: AuthUser;
  // Provide kind field used by this structure.
  kind: LocationKindFilter;
  // Provide locale field used by this structure.
  locale: BoardLocale;
  // Provide allowReceptionReassign field used by this structure.
  allowReceptionReassign: boolean;
  // Support the surrounding logic for this step.
  focusLocationId?: string | null;
  // Support the surrounding logic for this step.
  focusTaskId?: string | null;
  // Support the surrounding logic for this step.
  focusSessionId?: string | null;
  // Support the surrounding logic for this step.
  onFocusConsumed?: () => void;
  /** Close the issue dialog when opening detail/reassign/repairs. */
  closeIssue: () => void;
};

// Export function useLocationsBoard as part of this module's API.
export function useLocationsBoard({
  // Support the surrounding logic for this step.
  user,
  // Support the surrounding logic for this step.
  kind,
  // Support the surrounding logic for this step.
  locale,
  // Support the surrounding logic for this step.
  allowReceptionReassign,
  // Support the surrounding logic for this step.
  focusLocationId = null,
  // Support the surrounding logic for this step.
  focusTaskId = null,
  // Support the surrounding logic for this step.
  focusSessionId = null,
  // Support the surrounding logic for this step.
  onFocusConsumed,
  // Support the surrounding logic for this step.
  closeIssue,
// Support the surrounding logic for this step.
}: UseLocationsBoardOptions) {
  // Bind isCommon for use in the following logic.
  const isCommon = kind === "common_area";

  // React state slot for local UI/data that can change over time.
  const [locations, setLocations] = useState<Room[]>([]);
  // React state slot for local UI/data that can change over time.
  const [housekeepers, setHousekeepers] = useState<
    // Support the surrounding logic for this step.
    Array<{ id: string; fullName: string; employeeNumber: string }>
  // Support the surrounding logic for this step.
  >([]);
  // React state slot for local UI/data that can change over time.
  const [assigneeId, setAssigneeId] = useState("");
  // React state slot for local UI/data that can change over time.
  const [error, setError] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [message, setMessage] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [loading, setLoading] = useState(true);
  // React state slot for local UI/data that can change over time.
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  // React state slot for local UI/data that can change over time.
  const [repairsLocationId, setRepairsLocationId] = useState<string | null>(
    // Support the surrounding logic for this step.
    null,
  );
  // React state slot for local UI/data that can change over time.
  const [detailLocationId, setDetailLocationId] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [reassignLocation, setReassignLocation] = useState<Room | null>(null);
  // React state slot for local UI/data that can change over time.
  const [filters, setFilters] = useState<RoomBoardFilters>(EMPTY_ROOM_FILTERS);
  // Hold a mutable ref that persists across renders without re-render.
  const refreshRevision = useRef(0);
  // Create a Set/Map for efficient membership or keyed lookup.
  const busyIdsRef = useRef<Set<string>>(new Set());

  // Bind permissions for use in the following logic.
  const permissions = locationPagePermissions(user, isCommon);
  // Bind a local value for the following logic.
  const {
    // Support the surrounding logic for this step.
    owner,
    // Support the surrounding logic for this step.
    canShowAssigneeToolbar,
    // Support the surrounding logic for this step.
    canReassign,
    // Support the surrounding logic for this step.
    canReviewOverdue,
    // Support the surrounding logic for this step.
    canSetOccupancy,
    // Support the surrounding logic for this step.
    canSetServiceStatus,
  // Support the surrounding logic for this step.
  } = permissions;

  // Bind canReassignEffective for use in the following logic.
  const canReassignEffective =
    // Support the surrounding logic for this step.
    canReassign && (user.role !== "reception" || allowReceptionReassign);

  // Bind canOverrideAvailability for use in the following logic.
  const canOverrideAvailability =
    // Support the surrounding logic for this step.
    owner ||
    // Support the surrounding logic for this step.
    user.role === "admin" ||
    // Support the surrounding logic for this step.
    user.role === "manager" ||
    // Support the surrounding logic for this step.
    user.role === "supervisor";

  // Bind a local value for the following logic.
  const { overdueState, loadOverdue, cancelOverdue } = useLocationsOverdue({
    // Support the surrounding logic for this step.
    canReviewOverdue,
    // Support the surrounding logic for this step.
    locale,
  });

  // Memoize callback identity for stable child/effect deps.
  const beginBusy = useCallback((id: string) => {
    // Conditional branch for the case described by this guard.
    if (busyIdsRef.current.has(id)) return false;
    // Support the surrounding logic for this step.
    busyIdsRef.current = addBusyId(busyIdsRef.current, id);
    // Update React state so the UI reflects the new value.
    setBusyIds(busyIdsRef.current);
    // Return early result or rendered output from this path.
    return true;
  // Support the surrounding logic for this step.
  }, []);

  // Memoize callback identity for stable child/effect deps.
  const endBusy = useCallback((id: string) => {
    // Support the surrounding logic for this step.
    busyIdsRef.current = removeBusyId(busyIdsRef.current, id);
    // Update React state so the UI reflects the new value.
    setBusyIds(busyIdsRef.current);
  // Support the surrounding logic for this step.
  }, []);

  /** Clear detail / reassign / repairs without touching the issue dialog. */
  const clearNonIssueOverlays = useCallback(() => {
    // Update React state so the UI reflects the new value.
    setDetailLocationId(null);
    // Update React state so the UI reflects the new value.
    setReassignLocation(null);
    // Update React state so the UI reflects the new value.
    setRepairsLocationId(null);
  // Support the surrounding logic for this step.
  }, []);

  /** Only one overlay at a time — detail / issue / reassign / repairs never stack. */
  const openDetail = useCallback(
    // Support the surrounding logic for this step.
    (id: string | null) => {
      // Invoke closeIssue to perform this step.
      closeIssue();
      // Update React state so the UI reflects the new value.
      setReassignLocation(null);
      // Update React state so the UI reflects the new value.
      setRepairsLocationId(null);
      // Update React state so the UI reflects the new value.
      setDetailLocationId(id);
    },
    // Support the surrounding logic for this step.
    [closeIssue],
  );

  // Memoize callback identity for stable child/effect deps.
  const openReassign = useCallback(
    // Support the surrounding logic for this step.
    (location: Room | null) => {
      // Update React state so the UI reflects the new value.
      setDetailLocationId(null);
      // Invoke closeIssue to perform this step.
      closeIssue();
      // Update React state so the UI reflects the new value.
      setRepairsLocationId(null);
      // Update React state so the UI reflects the new value.
      setReassignLocation(location);
    },
    // Support the surrounding logic for this step.
    [closeIssue],
  );

  // Memoize callback identity for stable child/effect deps.
  const openRepairs = useCallback(
    // Support the surrounding logic for this step.
    (locationId: string | null) => {
      // Update React state so the UI reflects the new value.
      setDetailLocationId(null);
      // Invoke closeIssue to perform this step.
      closeIssue();
      // Update React state so the UI reflects the new value.
      setReassignLocation(null);
      // Update React state so the UI reflects the new value.
      setRepairsLocationId(locationId);
    },
    // Support the surrounding logic for this step.
    [closeIssue],
  );

  // Bind focusAppliedRef for use in the following logic.
  const focusAppliedRef = useRef<string | null>(null);
  // Deep-link from live board: select the concrete location (and task/session) by id.
  useEffect(() => {
    // Conditional branch for the case described by this guard.
    if (!focusLocationId || loading) return;
    // Bind focusKey for use in the following logic.
    const focusKey = `${focusLocationId}:${focusTaskId ?? ""}:${focusSessionId ?? ""}`;
    // Conditional branch for the case described by this guard.
    if (focusAppliedRef.current === focusKey) return;
    // Support the surrounding logic for this step.
    focusAppliedRef.current = focusKey;
    // Find the first matching item for this lookup.
    const found = locations.find((l) => l.id === focusLocationId);
    // Conditional branch for the case described by this guard.
    if (found) {
      // Invoke openDetail to perform this step.
      openDetail(focusLocationId);
      // Invoke window.requestAnimationFrame to perform this step.
      window.requestAnimationFrame(() => {
        // Support the surrounding logic for this step.
        document
          // Continue a chained call building on the previous expression.
          .getElementById(`location-row-${focusLocationId}`)
          // Support the surrounding logic for this step.
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      // Conditional branch for the case described by this guard.
      if (
        // Support the surrounding logic for this step.
        focusTaskId &&
        // Support the surrounding logic for this step.
        found.activeTask &&
        // Support the surrounding logic for this step.
        found.activeTask.id !== focusTaskId
      // Support the surrounding logic for this step.
      ) {
        // Update React state so the UI reflects the new value.
        setMessage(
          // Invoke boardT to perform this step.
          boardT(
            // Support the surrounding logic for this step.
            locale,
            // Support the surrounding logic for this step.
            "Помещението е отворено; задачата от таблото вече не е активна тук.",
            // Support the surrounding logic for this step.
            "Location opened; the live-board task is no longer active here.",
          ),
        );
      // Support the surrounding logic for this step.
      } else if (
        // Support the surrounding logic for this step.
        focusSessionId &&
        // Support the surrounding logic for this step.
        found.activeTask?.runningSession?.id &&
        // Support the surrounding logic for this step.
        found.activeTask.runningSession.id !== focusSessionId
      // Support the surrounding logic for this step.
      ) {
        // Update React state so the UI reflects the new value.
        setMessage(
          // Invoke boardT to perform this step.
          boardT(
            // Support the surrounding logic for this step.
            locale,
            // Support the surrounding logic for this step.
            "Помещението е отворено; сесията от таблото вече не е активна тук.",
            // Support the surrounding logic for this step.
            "Location opened; the live-board session is no longer active here.",
          ),
        );
      }
    // Support the surrounding logic for this step.
    } else {
      // Update React state so the UI reflects the new value.
      setError(
        // Invoke boardT to perform this step.
        boardT(
          // Support the surrounding logic for this step.
          locale,
          // Support the surrounding logic for this step.
          "Помещението не е достъпно или липсва в този списък.",
          // Support the surrounding logic for this step.
          "Location is unavailable or missing from this list.",
        ),
      );
    }
    // Support the surrounding logic for this step.
    onFocusConsumed?.();
  // Support the surrounding logic for this step.
  }, [
    // Support the surrounding logic for this step.
    focusLocationId,
    // Support the surrounding logic for this step.
    focusTaskId,
    // Support the surrounding logic for this step.
    focusSessionId,
    // Support the surrounding logic for this step.
    loading,
    // Support the surrounding logic for this step.
    locations,
    // Support the surrounding logic for this step.
    openDetail,
    // Support the surrounding logic for this step.
    onFocusConsumed,
    // Support the surrounding logic for this step.
    locale,
  // Support the surrounding logic for this step.
  ]);

  // Bind a local value for the following logic.
  const { detailEvents, detailLoading, detailAuditError } =
    // Invoke useLocationAudit to perform this step.
    useLocationAudit(detailLocationId);

  // Bind detailLocation for use in the following logic.
  const detailLocation = detailLocationId
    // Support the surrounding logic for this step.
    ? (locations.find((l) => l.id === detailLocationId) ?? null)
    // Support the surrounding logic for this step.
    : null;

  // Bind repairsLocation for use in the following logic.
  const repairsLocation = repairsLocationId
    // Support the surrounding logic for this step.
    ? (locations.find((l) => l.id === repairsLocationId) ?? null)
    // Support the surrounding logic for this step.
    : null;

  // Memoize derived value to avoid recomputing every render.
  const overdueLocationIds = useMemo(
    // Support the surrounding logic for this step.
    () => new Set(overdueState.sessions.map((s) => s.room.id)),
    // Support the surrounding logic for this step.
    [overdueState.sessions],
  );

  // Memoize derived value to avoid recomputing every render.
  const filteredLocations = useMemo(() => {
    // Bind base for use in the following logic.
    const base = applyRoomFilters(locations, filters, overdueLocationIds);
    // Conditional branch for the case described by this guard.
    if (filters.overdueOnly && !overdueFilterReliable(overdueState)) {
      // Return early result or rendered output from this path.
      return base;
    }
    // Return early result or rendered output from this path.
    return base;
  // Support the surrounding logic for this step.
  }, [locations, filters, overdueLocationIds, overdueState]);

  // Memoize derived value to avoid recomputing every render.
  const buildingOptions = useMemo(
    // Support the surrounding logic for this step.
    () => uniqueSorted(locations.map((l) => l.buildingCode)),
    // Support the surrounding logic for this step.
    [locations],
  );
  // Memoize derived value to avoid recomputing every render.
  const floorOptions = useMemo(
    // Support the surrounding logic for this step.
    () => uniqueSorted(locations.map((l) => String(l.floor))),
    // Support the surrounding logic for this step.
    [locations],
  );
  // Memoize derived value to avoid recomputing every render.
  const sectorOptions = useMemo(
    // Support the surrounding logic for this step.
    () =>
      // Invoke uniqueSorted to perform this step.
      uniqueSorted(
        // Invoke locations.map to perform this step.
        locations.map((l) => l.sector?.code ?? "").filter(Boolean),
      ),
    // Support the surrounding logic for this step.
    [locations],
  );

  // Memoize callback identity for stable child/effect deps.
  const refresh = useCallback(async () => {
    // Bind revision for use in the following logic.
    const revision = ++refreshRevision.current;
    // Update React state so the UI reflects the new value.
    setError(null);
    // Begin guarded block to catch runtime failures.
    try {
      // Bind data for use in the following logic.
      const data = isCommon ? await fetchCommonAreas() : await fetchRooms();
      // Conditional branch for the case described by this guard.
      if (revision !== refreshRevision.current) return;
      // Update React state so the UI reflects the new value.
      setLocations(data);
      // Conditional branch for the case described by this guard.
      if (canReviewOverdue) {
        // Wait for an async operation before continuing.
        await loadOverdue(new Set(data.map((l) => l.id)));
      }
    // Support the surrounding logic for this step.
    } catch (err) {
      // Conditional branch for the case described by this guard.
      if (revision !== refreshRevision.current) return;
      // Update React state so the UI reflects the new value.
      setError(err instanceof Error ? err.message : "Refresh failed");
    }
  // Support the surrounding logic for this step.
  }, [canReviewOverdue, isCommon, loadOverdue]);

  // Invoke useLiveRefresh hook for page/feature state and behavior.
  const liveAt = useLiveRefresh(refresh, {
    // Provide enabled field used by this structure.
    enabled: !loading,
    // Provide busy field used by this structure.
    busy: busyIds.size > 0,
    // Provide eventTypes field used by this structure.
    eventTypes: [
      // Support the surrounding logic for this step.
      "location.changed",
      // Support the surrounding logic for this step.
      "cleaning.changed",
      // Support the surrounding logic for this step.
      "ticket.changed",
      // Support the surrounding logic for this step.
      "settings.changed",
    ],
  });

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Bind ac for use in the following logic.
    const ac = new AbortController();
    // Bind a local value for the following logic.
    const { signal } = ac;
    // Support the surrounding logic for this step.
    (async () => {
      // Begin guarded block to catch runtime failures.
      try {
        // Update React state so the UI reflects the new value.
        setLoading(true);
        // Update React state so the UI reflects the new value.
        setError(null);
        // Bind data for use in the following logic.
        const data = isCommon
          // Support the surrounding logic for this step.
          ? await fetchCommonAreas({ signal })
          // Support the surrounding logic for this step.
          : await fetchRooms({ signal });
        // Conditional branch for the case described by this guard.
        if (signal.aborted) return;
        // Update React state so the UI reflects the new value.
        setLocations(data);
        // Conditional branch for the case described by this guard.
        if (canReviewOverdue) {
          // Wait for an async operation before continuing.
          await loadOverdue(new Set(data.map((l) => l.id)), signal);
        }
        // Conditional branch for the case described by this guard.
        if (canShowAssigneeToolbar || canReassign) {
          // Bind hk for use in the following logic.
          const hk = await fetchHousekeepers({ signal });
          // Conditional branch for the case described by this guard.
          if (signal.aborted) return;
          // Update React state so the UI reflects the new value.
          setHousekeepers(hk);
          // Conditional branch for the case described by this guard.
          if (hk[0]) setAssigneeId(hk[0].id);
        }
      // Support the surrounding logic for this step.
      } catch (err) {
        // Conditional branch for the case described by this guard.
        if (signal.aborted) return;
        // Conditional branch for the case described by this guard.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Update React state so the UI reflects the new value.
        setError(
          // Support the surrounding logic for this step.
          err instanceof Error
            // Support the surrounding logic for this step.
            ? err.message
            // Support the surrounding logic for this step.
            : `Failed to load ${isCommon ? "common areas" : "rooms"}`,
        );
      // Support the surrounding logic for this step.
      } finally {
        // Conditional branch for the case described by this guard.
        if (!signal.aborted) setLoading(false);
      }
    // Support the surrounding logic for this step.
    })();
    // Return early result or rendered output from this path.
    return () => {
      // Invoke ac.abort to perform this step.
      ac.abort();
      // Invoke cancelOverdue to perform this step.
      cancelOverdue();
    };
  // Support the surrounding logic for this step.
  }, [
    // Support the surrounding logic for this step.
    canShowAssigneeToolbar,
    // Support the surrounding logic for this step.
    canReassign,
    // Support the surrounding logic for this step.
    canReviewOverdue,
    // Support the surrounding logic for this step.
    isCommon,
    // Support the surrounding logic for this step.
    loadOverdue,
    // Support the surrounding logic for this step.
    cancelOverdue,
  // Support the surrounding logic for this step.
  ]);

  // Define function runAction and its behavior.
  async function runAction(locationId: string, action: () => Promise<void>) {
    // Conditional branch for the case described by this guard.
    if (!beginBusy(locationId)) return;
    // Update React state so the UI reflects the new value.
    setError(null);
    // Update React state so the UI reflects the new value.
    setMessage(null);
    // Update React state so the UI reflects the new value.
    setRefreshWarning(null);
    // Begin guarded block to catch runtime failures.
    try {
      // Keep success when only the follow-up board refresh fails (BUG-06/07).
      const result = await executeMutationWithRefresh(action, refresh);
      // Conditional branch for the case described by this guard.
      if (!result.ok) {
        // Update React state so the UI reflects the new value.
        setError(result.error);
      // Support the surrounding logic for this step.
      } else if (result.outcome === "saved_refresh_failed") {
        // Update React state so the UI reflects the new value.
        setRefreshWarning(
          // Support the surrounding logic for this step.
          result.refreshError ??
            // Invoke boardT to perform this step.
            boardT(
              // Support the surrounding logic for this step.
              locale,
              // Support the surrounding logic for this step.
              "Запазено, но таблото не се обнови",
              // Support the surrounding logic for this step.
              "Saved, but the board did not refresh",
            ),
        );
      }
    // Support the surrounding logic for this step.
    } finally {
      // Invoke endBusy to perform this step.
      endBusy(locationId);
    }
  }

  // Bind occupancyHandlers for use in the following logic.
  const occupancyHandlers = detailLocation
    // Support the surrounding logic for this step.
    ? makeOccupancyHandlers({
        // Provide location field used by this structure.
        location: detailLocation,
        // Support the surrounding logic for this step.
        runAction,
        // Support the surrounding logic for this step.
        setMessage,
      })
    // Support the surrounding logic for this step.
    : null;

  // Define function patchFilter and its behavior.
  function patchFilter<K extends keyof RoomBoardFilters>(
    // Provide key field used by this structure.
    key: K,
    // Provide value field used by this structure.
    value: RoomBoardFilters[K],
  // Support the surrounding logic for this step.
  ) {
    // Update React state so the UI reflects the new value.
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  // Bind overdueFilterHint for use in the following logic.
  const overdueFilterHint =
    // Support the surrounding logic for this step.
    filters.overdueOnly && !overdueFilterReliable(overdueState)
      // Support the surrounding logic for this step.
      ? boardT(
          // Support the surrounding logic for this step.
          locale,
          // Support the surrounding logic for this step.
          "Филтърът „Просрочени“ използва непълни или остарели данни.",
          // Support the surrounding logic for this step.
          "The Overdue filter is using incomplete or outdated data.",
        )
      // Support the surrounding logic for this step.
      : null;

  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    isCommon,
    // Support the surrounding logic for this step.
    locations,
    // Support the surrounding logic for this step.
    overdueState,
    // Support the surrounding logic for this step.
    housekeepers,
    // Support the surrounding logic for this step.
    assigneeId,
    // Support the surrounding logic for this step.
    setAssigneeId,
    // Support the surrounding logic for this step.
    error,
    // Support the surrounding logic for this step.
    setError,
    // Support the surrounding logic for this step.
    message,
    // Support the surrounding logic for this step.
    setMessage,
    // Support the surrounding logic for this step.
    refreshWarning,
    // Support the surrounding logic for this step.
    loading,
    // Support the surrounding logic for this step.
    busyIds,
    // Support the surrounding logic for this step.
    beginBusy,
    // Support the surrounding logic for this step.
    endBusy,
    // Support the surrounding logic for this step.
    filters,
    // Support the surrounding logic for this step.
    setFilters,
    // Support the surrounding logic for this step.
    patchFilter,
    // Support the surrounding logic for this step.
    permissions,
    // Support the surrounding logic for this step.
    owner,
    // Support the surrounding logic for this step.
    canShowAssigneeToolbar,
    // Support the surrounding logic for this step.
    canReviewOverdue,
    // Support the surrounding logic for this step.
    canSetOccupancy,
    // Support the surrounding logic for this step.
    canSetServiceStatus,
    // Support the surrounding logic for this step.
    canReassignEffective,
    // Support the surrounding logic for this step.
    canOverrideAvailability,
    // Support the surrounding logic for this step.
    clearNonIssueOverlays,
    // Support the surrounding logic for this step.
    openDetail,
    // Support the surrounding logic for this step.
    openReassign,
    // Support the surrounding logic for this step.
    openRepairs,
    // Support the surrounding logic for this step.
    detailLocationId,
    // Support the surrounding logic for this step.
    detailLocation,
    // Support the surrounding logic for this step.
    detailEvents,
    // Support the surrounding logic for this step.
    detailLoading,
    // Support the surrounding logic for this step.
    detailAuditError,
    // Support the surrounding logic for this step.
    repairsLocation,
    // Support the surrounding logic for this step.
    reassignLocation,
    // Support the surrounding logic for this step.
    filteredLocations,
    // Support the surrounding logic for this step.
    buildingOptions,
    // Support the surrounding logic for this step.
    floorOptions,
    // Support the surrounding logic for this step.
    sectorOptions,
    // Support the surrounding logic for this step.
    overdueFilterHint,
    // Support the surrounding logic for this step.
    loadOverdue,
    // Support the surrounding logic for this step.
    refresh,
    // Support the surrounding logic for this step.
    liveAt,
    // Support the surrounding logic for this step.
    runAction,
    // Support the surrounding logic for this step.
    occupancyHandlers,
  };
}
