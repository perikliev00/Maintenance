/**
 * Locations board data ownership: rooms list, busy set, refresh/live refresh,
 * housekeepers, filters, detail/reassign/repairs overlays, and runAction.
 * Overdue fetch lives in `useLocationsOverdue`; issue form in `useLocationIssueForm`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCommonAreas,
  fetchHousekeepers,
  fetchRooms,
  type AuthUser,
  type Room,
} from "../../api/client";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { executeMutationWithRefresh } from "../../saveRefresh";
import { useLocationAudit } from "./audit";
import { addBusyId, removeBusyId } from "./busyIds";
import {
  applyRoomFilters,
  EMPTY_ROOM_FILTERS,
  uniqueSorted,
  type RoomBoardFilters,
} from "./filters";
import { boardT, type BoardLocale } from "./labels";
import { makeOccupancyHandlers } from "./occupancy";
import { overdueFilterReliable } from "./overdueState";
import { locationPagePermissions } from "./permissions";
import type { LocationKindFilter } from "./types";
import { useLocationsOverdue } from "./useLocationsOverdue";

export type UseLocationsBoardOptions = {
  user: AuthUser;
  kind: LocationKindFilter;
  locale: BoardLocale;
  allowReceptionReassign: boolean;
  focusLocationId?: string | null;
  focusTaskId?: string | null;
  focusSessionId?: string | null;
  onFocusConsumed?: () => void;
  /** Close the issue dialog when opening detail/reassign/repairs. */
  closeIssue: () => void;
};

// Export function useLocationsBoard as part of this module's API.
export function useLocationsBoard({
  user,
  kind,
  locale,
  allowReceptionReassign,
  focusLocationId = null,
  focusTaskId = null,
  focusSessionId = null,
  onFocusConsumed,
  closeIssue,
}: UseLocationsBoardOptions) {
  const isCommon = kind === "common_area";

  const [locations, setLocations] = useState<Room[]>([]);
  const [housekeepers, setHousekeepers] = useState<
    Array<{ id: string; fullName: string; employeeNumber: string }>
  >([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [repairsLocationId, setRepairsLocationId] = useState<string | null>(
    null,
  );
  const [detailLocationId, setDetailLocationId] = useState<string | null>(null);
  const [reassignLocation, setReassignLocation] = useState<Room | null>(null);
  const [filters, setFilters] = useState<RoomBoardFilters>(EMPTY_ROOM_FILTERS);
  const refreshRevision = useRef(0);
  const busyIdsRef = useRef<Set<string>>(new Set());

  const permissions = locationPagePermissions(user, isCommon);
  const {
    owner,
    canShowAssigneeToolbar,
    canReassign,
    canReviewOverdue,
    canSetOccupancy,
    canSetServiceStatus,
  } = permissions;

  const canReassignEffective =
    canReassign && (user.role !== "reception" || allowReceptionReassign);

  const canOverrideAvailability =
    owner ||
    user.role === "admin" ||
    user.role === "manager" ||
    user.role === "supervisor";

  const { overdueState, loadOverdue, cancelOverdue } = useLocationsOverdue({
    canReviewOverdue,
    locale,
  });

  const beginBusy = useCallback((id: string) => {
    if (busyIdsRef.current.has(id)) return false;
    busyIdsRef.current = addBusyId(busyIdsRef.current, id);
    setBusyIds(busyIdsRef.current);
    return true;
  }, []);

  const endBusy = useCallback((id: string) => {
    busyIdsRef.current = removeBusyId(busyIdsRef.current, id);
    setBusyIds(busyIdsRef.current);
  }, []);

  /** Clear detail / reassign / repairs without touching the issue dialog. */
  const clearNonIssueOverlays = useCallback(() => {
    setDetailLocationId(null);
    setReassignLocation(null);
    setRepairsLocationId(null);
  }, []);

  /** Only one overlay at a time — detail / issue / reassign / repairs never stack. */
  const openDetail = useCallback(
    (id: string | null) => {
      closeIssue();
      setReassignLocation(null);
      setRepairsLocationId(null);
      setDetailLocationId(id);
    },
    [closeIssue],
  );

  const openReassign = useCallback(
    (location: Room | null) => {
      setDetailLocationId(null);
      closeIssue();
      setRepairsLocationId(null);
      setReassignLocation(location);
    },
    [closeIssue],
  );

  const openRepairs = useCallback(
    (locationId: string | null) => {
      setDetailLocationId(null);
      closeIssue();
      setReassignLocation(null);
      setRepairsLocationId(locationId);
    },
    [closeIssue],
  );

  const focusAppliedRef = useRef<string | null>(null);
  // Deep-link from live board: select the concrete location (and task/session) by id.
  useEffect(() => {
    if (!focusLocationId || loading) return;
    const focusKey = `${focusLocationId}:${focusTaskId ?? ""}:${focusSessionId ?? ""}`;
    if (focusAppliedRef.current === focusKey) return;
    focusAppliedRef.current = focusKey;
    // Find the first matching item for this lookup.
    const found = locations.find((l) => l.id === focusLocationId);
    if (found) {
      openDetail(focusLocationId);
      window.requestAnimationFrame(() => {
        document
          .getElementById(`location-row-${focusLocationId}`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      if (
        focusTaskId &&
        found.activeTask &&
        found.activeTask.id !== focusTaskId
      ) {
        setMessage(
          boardT(
            locale,
            "Помещението е отворено; задачата от таблото вече не е активна тук.",
            "Location opened; the live-board task is no longer active here.",
          ),
        );
      } else if (
        focusSessionId &&
        found.activeTask?.runningSession?.id &&
        found.activeTask.runningSession.id !== focusSessionId
      ) {
        setMessage(
          boardT(
            locale,
            "Помещението е отворено; сесията от таблото вече не е активна тук.",
            "Location opened; the live-board session is no longer active here.",
          ),
        );
      }
    } else {
      setError(
        boardT(
          locale,
          "Помещението не е достъпно или липсва в този списък.",
          "Location is unavailable or missing from this list.",
        ),
      );
    }
    onFocusConsumed?.();
  }, [
    focusLocationId,
    focusTaskId,
    focusSessionId,
    loading,
    locations,
    openDetail,
    onFocusConsumed,
    locale,
  ]);

  const { detailEvents, detailLoading, detailAuditError } =
    useLocationAudit(detailLocationId);

  const detailLocation = detailLocationId
    ? (locations.find((l) => l.id === detailLocationId) ?? null)
    : null;

  const repairsLocation = repairsLocationId
    ? (locations.find((l) => l.id === repairsLocationId) ?? null)
    : null;

  // Memoize derived value to avoid recomputing every render.
  const overdueLocationIds = useMemo(
    () => new Set(overdueState.sessions.map((s) => s.room.id)),
    [overdueState.sessions],
  );

  // Memoize derived value to avoid recomputing every render.
  const filteredLocations = useMemo(() => {
    const base = applyRoomFilters(locations, filters, overdueLocationIds);
    if (filters.overdueOnly && !overdueFilterReliable(overdueState)) {
      return base;
    }
    return base;
  }, [locations, filters, overdueLocationIds, overdueState]);

  // Memoize derived value to avoid recomputing every render.
  const buildingOptions = useMemo(
    () => uniqueSorted(locations.map((l) => l.buildingCode)),
    [locations],
  );
  // Memoize derived value to avoid recomputing every render.
  const floorOptions = useMemo(
    () => uniqueSorted(locations.map((l) => String(l.floor))),
    [locations],
  );
  // Memoize derived value to avoid recomputing every render.
  const sectorOptions = useMemo(
    () =>
      uniqueSorted(
        locations.map((l) => l.sector?.code ?? "").filter(Boolean),
      ),
    [locations],
  );

  const refresh = useCallback(async () => {
    const revision = ++refreshRevision.current;
    setError(null);
    try {
      const data = isCommon ? await fetchCommonAreas() : await fetchRooms();
      if (revision !== refreshRevision.current) return;
      setLocations(data);
      if (canReviewOverdue) {
        await loadOverdue(new Set(data.map((l) => l.id)));
      }
    } catch (err) {
      if (revision !== refreshRevision.current) return;
      setError(err instanceof Error ? err.message : "Refresh failed");
    }
  }, [canReviewOverdue, isCommon, loadOverdue]);

  // Invoke useLiveRefresh hook for page/feature state and behavior.
  const liveAt = useLiveRefresh(refresh, {
    enabled: !loading,
    busy: busyIds.size > 0,
    eventTypes: [
      "location.changed",
      "cleaning.changed",
      "ticket.changed",
      "settings.changed",
    ],
  });

  useEffect(() => {
    const ac = new AbortController();
    const { signal } = ac;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = isCommon
          ? await fetchCommonAreas({ signal })
          : await fetchRooms({ signal });
        if (signal.aborted) return;
        setLocations(data);
        if (canReviewOverdue) {
          await loadOverdue(new Set(data.map((l) => l.id)), signal);
        }
        if (canShowAssigneeToolbar || canReassign) {
          const hk = await fetchHousekeepers({ signal });
          if (signal.aborted) return;
          setHousekeepers(hk);
          if (hk[0]) setAssigneeId(hk[0].id);
        }
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof Error
            ? err.message
            : `Failed to load ${isCommon ? "common areas" : "rooms"}`,
        );
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
    return () => {
      ac.abort();
      cancelOverdue();
    };
  }, [
    canShowAssigneeToolbar,
    canReassign,
    canReviewOverdue,
    isCommon,
    loadOverdue,
    cancelOverdue,
  ]);

  // Define function runAction and its behavior.
  async function runAction(locationId: string, action: () => Promise<void>) {
    if (!beginBusy(locationId)) return;
    setError(null);
    setMessage(null);
    setRefreshWarning(null);
    try {
      // Keep success when only the follow-up board refresh fails (BUG-06/07).
      const result = await executeMutationWithRefresh(action, refresh);
      if (!result.ok) {
        setError(result.error);
      } else if (result.outcome === "saved_refresh_failed") {
        setRefreshWarning(
          result.refreshError ??
            boardT(
              locale,
              "Запазено, но таблото не се обнови",
              "Saved, but the board did not refresh",
            ),
        );
      }
    } finally {
      endBusy(locationId);
    }
  }

  const occupancyHandlers = detailLocation
    ? makeOccupancyHandlers({
        location: detailLocation,
        runAction,
        setMessage,
      })
    : null;

  // Define function patchFilter and its behavior.
  function patchFilter<K extends keyof RoomBoardFilters>(
    key: K,
    value: RoomBoardFilters[K],
  ) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  const overdueFilterHint =
    filters.overdueOnly && !overdueFilterReliable(overdueState)
      ? boardT(
          locale,
          "Филтърът „Просрочени“ използва непълни или остарели данни.",
          "The Overdue filter is using incomplete or outdated data.",
        )
      : null;

  return {
    isCommon,
    locations,
    overdueState,
    housekeepers,
    assigneeId,
    setAssigneeId,
    error,
    setError,
    message,
    setMessage,
    refreshWarning,
    loading,
    busyIds,
    beginBusy,
    endBusy,
    filters,
    setFilters,
    patchFilter,
    permissions,
    owner,
    canShowAssigneeToolbar,
    canReviewOverdue,
    canSetOccupancy,
    canSetServiceStatus,
    canReassignEffective,
    canOverrideAvailability,
    clearNonIssueOverlays,
    openDetail,
    openReassign,
    openRepairs,
    detailLocationId,
    detailLocation,
    detailEvents,
    detailLoading,
    detailAuditError,
    repairsLocation,
    reassignLocation,
    filteredLocations,
    buildingOptions,
    floorOptions,
    sectorOptions,
    overdueFilterHint,
    loadOverdue,
    refresh,
    liveAt,
    runAction,
    occupancyHandlers,
  };
}
