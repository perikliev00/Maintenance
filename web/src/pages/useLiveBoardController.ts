/**
 * Live board orchestration: refresh coalesce/abort, SSE, stale clock,
 * busyIds, attention load-more, filters, and navigation helpers.
 * Presentational helpers and JSX stay in LiveBoardPage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  canPerformAction,
  // Support the surrounding logic for this step.
  completeCleaningSession,
  // Support the surrounding logic for this step.
  fetchOperationsLive,
  // Support the surrounding logic for this step.
  fetchOperationsLiveAttention,
  // Support the surrounding logic for this step.
  filterPanelsByModules,
  // Support the surrounding logic for this step.
  panelsForUser,
  // Declare type alias AuthUser.
  type AuthUser,
  // Declare type alias LiveNeedsAttention.
  type LiveNeedsAttention,
  // Declare type alias ModuleToggles.
  type ModuleToggles,
  // Declare type alias OperationsLive.
  type OperationsLive,
  // Declare type alias Panel.
  type Panel,
// Support the surrounding logic for this step.
} from "../api/client";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  panelForLocationKind,
  // Declare type alias BoardFocus.
  type BoardFocus,
  // Declare type alias NavigateToFocus.
  type NavigateToFocus,
// Support the surrounding logic for this step.
} from "../app/boardFocus";
// Import module dependency from ../hooks/useLiveRefresh.
import { useLiveRefresh } from "../hooks/useLiveRefresh";
// Import module dependency from ../i18n.
import { labelFor } from "../i18n";
// Import module dependency from ./locations/busyIds.
import { addBusyId, removeBusyId } from "./locations/busyIds";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  attentionActionLabel,
  // Support the surrounding logic for this step.
  attentionDestinationPanel,
  // Support the surrounding logic for this step.
  deriveLiveConnAfterTick,
  // Support the surrounding logic for this step.
  filterLiveNeeds,
  // Support the surrounding logic for this step.
  filterLiveSessions,
  // Support the surrounding logic for this step.
  LIVE_BOARD_STALE_MS,
  // Support the surrounding logic for this step.
  mergeAttentionPage,
  // Support the surrounding logic for this step.
  sessionFlagsFromElapsed,
  // Support the surrounding logic for this step.
  shouldApplyLiveSnapshot,
  // Declare type alias LiveBoardCategoryFilter.
  type LiveBoardCategoryFilter,
  // Declare type alias LiveBoardConnState.
  type LiveBoardConnState,
// Support the surrounding logic for this step.
} from "./liveBoardLogic";

// Export type definition for consumers of this module.
export type { LiveBoardCategoryFilter, LiveBoardConnState };

// Bind STALE_MS for use in the following logic.
const STALE_MS = LIVE_BOARD_STALE_MS;
// Bind TICK_MS for use in the following logic.
const TICK_MS = 1_000;

// Export type definition for consumers of this module.
export type UseLiveBoardControllerArgs = {
  // Provide user field used by this structure.
  user: AuthUser;
  // Support the surrounding logic for this step.
  locale?: "bg" | "en";
  // Support the surrounding logic for this step.
  modules?: ModuleToggles | null;
  // Support the surrounding logic for this step.
  onNavigate?: NavigateToFocus;
};

// Export function useLiveBoardController as part of this module's API.
export function useLiveBoardController({
  // Support the surrounding logic for this step.
  user,
  // Pass locale prop/value into the element or config.
  locale = "bg",
  // Support the surrounding logic for this step.
  modules = null,
  // Support the surrounding logic for this step.
  onNavigate,
// Support the surrounding logic for this step.
}: UseLiveBoardControllerArgs) {
  // Bind t for use in the following logic.
  const t = labelFor(locale);
  // Server complete route requires cleaning.complete only (not review_overdue).
  const canComplete = canPerformAction(user, "cleaning.complete");
  // Memoize derived value to avoid recomputing every render.
  const allowedPanels = useMemo(
    // Support the surrounding logic for this step.
    () => new Set(filterPanelsByModules(panelsForUser(user), modules)),
    // Support the surrounding logic for this step.
    [user, modules],
  );

  // React state slot for local UI/data that can change over time.
  const [data, setData] = useState<OperationsLive | null>(null);
  // React state slot for local UI/data that can change over time.
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  // React state slot for local UI/data that can change over time.
  const [serverSkewMs, setServerSkewMs] = useState(0);
  // React state slot for local UI/data that can change over time.
  const [conn, setConn] = useState<LiveBoardConnState>("offline");
  // React state slot for local UI/data that can change over time.
  const [error, setError] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [message, setMessage] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [loading, setLoading] = useState(true);
  // React state slot for local UI/data that can change over time.
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  // Create a Set/Map for efficient membership or keyed lookup.
  const busyIdsRef = useRef<Set<string>>(new Set());
  // React state slot for local UI/data that can change over time.
  const [now, setNow] = useState(() => Date.now());
  // Bind a local value for the following logic.
  const [categoryFilter, setCategoryFilter] =
    // Support the surrounding logic for this step.
    useState<LiveBoardCategoryFilter>("all");
  // React state slot for local UI/data that can change over time.
  const [loadingMoreKind, setLoadingMoreKind] = useState<
    // Support the surrounding logic for this step.
    LiveNeedsAttention["kind"] | null
  // Support the surrounding logic for this step.
  >(null);

  /** Generation so a late GET cannot overwrite a newer post-mutation refresh. */
  const refreshGen = useRef(0);
  // Bind refreshInFlight for use in the following logic.
  const refreshInFlight = useRef<{
    // Provide promise field used by this structure.
    promise: Promise<void>;
    // Provide silent field used by this structure.
    silent: boolean;
    // Provide gen field used by this structure.
    gen: number;
  // Support the surrounding logic for this step.
  } | null>(null);
  // Bind abortRef for use in the following logic.
  const abortRef = useRef<AbortController | null>(null);

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

  // Memoize callback identity for stable child/effect deps.
  const refresh = useCallback(async (opts?: {
    // Support the surrounding logic for this step.
    silent?: boolean;
    // Support the surrounding logic for this step.
    force?: boolean;
  // Support the surrounding logic for this step.
  }) => {
    // Bind silent for use in the following logic.
    const silent = opts?.silent ?? false;
    // Bind force for use in the following logic.
    const force = opts?.force ?? false;

    // Coalesce duplicate polls only onto a still-live request. Never join an
    // aborted in-flight promise (Strict Mode remount / force refresh).
    if (!force && refreshInFlight.current) {
      // Return early result or rendered output from this path.
      return refreshInFlight.current.promise;
    }

    // Conditional branch for the case described by this guard.
    if (force && abortRef.current) {
      // Invoke abortRef.current.abort to perform this step.
      abortRef.current.abort();
      // Support the surrounding logic for this step.
      refreshInFlight.current = null;
    }

    // Bind gen for use in the following logic.
    const gen = ++refreshGen.current;
    // Bind ac for use in the following logic.
    const ac = new AbortController();
    // Support the surrounding logic for this step.
    abortRef.current = ac;
    // Conditional branch for the case described by this guard.
    if (!silent) setLoading(true);

    // Bind run for use in the following logic.
    const run = (async () => {
      // Begin guarded block to catch runtime failures.
      try {
        // Bind next for use in the following logic.
        const next = await fetchOperationsLive({ signal: ac.signal });
        // Conditional branch for the case described by this guard.
        if (
          // Support the surrounding logic for this step.
          ac.signal.aborted ||
          // Support the surrounding logic for this step.
          !shouldApplyLiveSnapshot(gen, refreshGen.current)
        // Support the surrounding logic for this step.
        ) {
          // Return early result or rendered output from this path.
          return;
        }
        // Bind receivedAt for use in the following logic.
        const receivedAt = Date.now();
        // Bind serverAt for use in the following logic.
        const serverAt = new Date(next.updatedAt).getTime();
        // Conditional branch for the case described by this guard.
        if (Number.isFinite(serverAt)) {
          // Update React state so the UI reflects the new value.
          setServerSkewMs(serverAt - receivedAt);
        }
        // Update React state so the UI reflects the new value.
        setData(next);
        // Update React state so the UI reflects the new value.
        setLastSuccessAt(receivedAt);
        // Update React state so the UI reflects the new value.
        setConn("live");
        // Update React state so the UI reflects the new value.
        setError(null);
      // Support the surrounding logic for this step.
      } catch (err) {
        // Aborted refresh must not flip the board to offline or clear loading
        // for a newer generation that replaced this request.
        if (
          // Support the surrounding logic for this step.
          ac.signal.aborted ||
          // Support the surrounding logic for this step.
          !shouldApplyLiveSnapshot(gen, refreshGen.current)
        // Support the surrounding logic for this step.
        ) {
          // Return early result or rendered output from this path.
          return;
        }
        // Update React state so the UI reflects the new value.
        setError(
          // Support the surrounding logic for this step.
          err instanceof Error ? err.message : "Failed to load live board",
        );
        // Update React state so the UI reflects the new value.
        setConn("offline");
      // Support the surrounding logic for this step.
      } finally {
        // Conditional branch for the case described by this guard.
        if (refreshInFlight.current?.gen === gen) {
          // Support the surrounding logic for this step.
          refreshInFlight.current = null;
        }
        // Conditional branch for the case described by this guard.
        if (gen === refreshGen.current && !ac.signal.aborted) {
          // Update React state so the UI reflects the new value.
          setLoading(false);
        }
      }
    // Support the surrounding logic for this step.
    })();

    // Pass refreshInFlight.current prop/value into the element or config.
    refreshInFlight.current = { promise: run, silent, gen };
    // Return early result or rendered output from this path.
    return run;
  // Support the surrounding logic for this step.
  }, []);

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Fire-and-forget async work without awaiting in this path.
    void refresh({ silent: false });
    // Return early result or rendered output from this path.
    return () => {
      // Invalidate before abort so a remount cannot coalesce onto this promise.
      refreshGen.current += 1;
      // Support the surrounding logic for this step.
      refreshInFlight.current = null;
      // Support the surrounding logic for this step.
      abortRef.current?.abort();
      // Support the surrounding logic for this step.
      abortRef.current = null;
    };
  // Support the surrounding logic for this step.
  }, [refresh]);

  // Invoke useLiveRefresh to perform this step.
  useLiveRefresh(
    // Support the surrounding logic for this step.
    () => {
      // Fire-and-forget async work without awaiting in this path.
      void refresh({ silent: true });
    },
    {
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
    },
  );

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Bind tick for use in the following logic.
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    // Return early result or rendered output from this path.
    return () => window.clearInterval(tick);
  // Support the surrounding logic for this step.
  }, []);

  // Offline is sticky in deriveLiveConnAfterTick; poll again so a later success
  // can return the badge to Live without waiting for an SSE domain event.
  useEffect(() => {
    // Conditional branch for the case described by this guard.
    if (conn !== "offline" || loading) return;
    // Bind retry for use in the following logic.
    const retry = window.setTimeout(() => {
      // Fire-and-forget async work without awaiting in this path.
      void refresh({ silent: true });
    // Support the surrounding logic for this step.
    }, 15_000);
    // Return early result or rendered output from this path.
    return () => window.clearTimeout(retry);
  // Support the surrounding logic for this step.
  }, [conn, loading, refresh]);

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Bind next for use in the following logic.
    const next = deriveLiveConnAfterTick({
      // Support the surrounding logic for this step.
      conn,
      // Support the surrounding logic for this step.
      lastSuccessAt,
      // Support the surrounding logic for this step.
      now,
      // Provide staleMs field used by this structure.
      staleMs: STALE_MS,
    });
    // Conditional branch for the case described by this guard.
    if (next !== conn) setConn(next);
  // Support the surrounding logic for this step.
  }, [now, lastSuccessAt, conn]);

  /** Client clock aligned to last server snapshot for overdue/anomaly parity. */
  const alignedNow = now + serverSkewMs;

  // Memoize derived value to avoid recomputing every render.
  const sessionsWithTick = useMemo(() => {
    // Conditional branch for the case described by this guard.
    if (!data) return [];
    // Return early result or rendered output from this path.
    return data.activeSessions.map((s) => {
      // Bind started for use in the following logic.
      const started = new Date(s.startedAt).getTime();
      // Bind elapsedMinutes for use in the following logic.
      const elapsedMinutes = Math.max(
        0,
        // Invoke Math.floor to perform this step.
        Math.floor((alignedNow - started) / 60_000),
      );
      // Return early result or rendered output from this path.
      return {
        // Spread prior fields/items so overrides can layer cleanly.
        ...s,
        // Support the surrounding logic for this step.
        elapsedMinutes,
        // Spread prior fields/items so overrides can layer cleanly.
        ...sessionFlagsFromElapsed(
          // Support the surrounding logic for this step.
          elapsedMinutes,
          // Support the surrounding logic for this step.
          data.overdueThresholdMinutes,
          // Support the surrounding logic for this step.
          data.anomalyThresholdMinutes,
        ),
      };
    });
  // Support the surrounding logic for this step.
  }, [data, alignedNow]);

  // Memoize derived value to avoid recomputing every render.
  const liveCounts = useMemo(() => {
    // Conditional branch for the case described by this guard.
    if (!data) {
      // Return early result or rendered output from this path.
      return {
        // Provide active field used by this structure.
        active: 0,
        // Provide overdue field used by this structure.
        overdue: 0,
        // Provide anomalies field used by this structure.
        anomalies: 0,
        // Provide awaitingInspection field used by this structure.
        awaitingInspection: 0,
        // Provide blockingTickets field used by this structure.
        blockingTickets: 0,
      };
    }
    // Filter items down to those relevant for this view.
    const overdue = sessionsWithTick.filter((s) => s.overdue).length;
    // Filter items down to those relevant for this view.
    const anomalies = sessionsWithTick.filter((s) => s.anomaly).length;
    // Return early result or rendered output from this path.
    return {
      // Provide active field used by this structure.
      active: sessionsWithTick.length,
      // Support the surrounding logic for this step.
      overdue,
      // Support the surrounding logic for this step.
      anomalies,
      // Provide awaitingInspection field used by this structure.
      awaitingInspection: data.counts.awaitingInspection,
      // Provide blockingTickets field used by this structure.
      blockingTickets: data.counts.blockingTickets,
    };
  // Support the surrounding logic for this step.
  }, [data, sessionsWithTick]);

  // Define function onComplete and its behavior.
  async function onComplete(sessionId: string) {
    // Conditional branch for the case described by this guard.
    if (!beginBusy(sessionId)) return;
    // Update React state so the UI reflects the new value.
    setMessage(null);
    // Begin guarded block to catch runtime failures.
    try {
      // Wait for an async operation before continuing.
      await completeCleaningSession(sessionId);
      // Update React state so the UI reflects the new value.
      setMessage(t("Сесията е приключена", "Session completed"));
      // Wait for an async operation before continuing.
      await refresh({ silent: true, force: true });
    // Support the surrounding logic for this step.
    } catch (err) {
      // Update React state so the UI reflects the new value.
      setError(err instanceof Error ? err.message : "Complete failed");
    // Support the surrounding logic for this step.
    } finally {
      // Invoke endBusy to perform this step.
      endBusy(sessionId);
    }
  }

  // Define function canOpenPanel and its behavior.
  function canOpenPanel(panel: Panel): boolean {
    // Return early result or rendered output from this path.
    return allowedPanels.has(panel);
  }

  // Define function openFocus and its behavior.
  function openFocus(panel: Panel, focus: BoardFocus) {
    // Conditional branch for the case described by this guard.
    if (!onNavigate || !canOpenPanel(panel)) return;
    // Invoke onNavigate to perform this step.
    onNavigate(panel, focus);
  }

  // Define function openLocation and its behavior.
  function openLocation(
    // Provide location field used by this structure.
    location: OperationsLive["activeSessions"][number]["location"],
    // Support the surrounding logic for this step.
    extra?: { taskId?: string; sessionId?: string },
  // Support the surrounding logic for this step.
  ) {
    // Bind panel for use in the following logic.
    const panel = panelForLocationKind(location.kind);
    // Conditional branch for the case described by this guard.
    if (!canOpenPanel(panel)) return;
    // Invoke openFocus to perform this step.
    openFocus(panel, {
      // Declare a type alias.
      type: "location",
      // Provide locationId field used by this structure.
      locationId: location.id,
      // Provide locationKind field used by this structure.
      locationKind: location.kind === "common_area" ? "common_area" : "room",
      // Provide taskId field used by this structure.
      taskId: extra?.taskId,
      // Provide sessionId field used by this structure.
      sessionId: extra?.sessionId,
    });
  }

  // Define function loadMore and its behavior.
  async function loadMore(kind: LiveNeedsAttention["kind"]) {
    // Conditional branch for the case described by this guard.
    if (!data?.attention) return;
    // Bind meta for use in the following logic.
    const meta =
      // Support the surrounding logic for this step.
      kind === "awaiting_inspection"
        // Support the surrounding logic for this step.
        ? data.attention.awaitingInspection
        // Support the surrounding logic for this step.
        : kind === "past_due"
          // Support the surrounding logic for this step.
          ? data.attention.pastDue
          // Support the surrounding logic for this step.
          : data.attention.blockingTickets;
    // Conditional branch for the case described by this guard.
    if (!meta.hasMore || !meta.nextCursor) return;
    // Update React state so the UI reflects the new value.
    setLoadingMoreKind(kind);
    // Begin guarded block to catch runtime failures.
    try {
      // Bind page for use in the following logic.
      const page = await fetchOperationsLiveAttention({
        // Support the surrounding logic for this step.
        kind,
        // Provide cursor field used by this structure.
        cursor: meta.nextCursor,
      });
      // Update React state so the UI reflects the new value.
      setData((prev) => (prev ? mergeAttentionPage(prev, kind, page) : prev));
    // Support the surrounding logic for this step.
    } catch (err) {
      // Update React state so the UI reflects the new value.
      setError(
        // Support the surrounding logic for this step.
        err instanceof Error ? err.message : "Failed to load more items",
      );
    // Support the surrounding logic for this step.
    } finally {
      // Update React state so the UI reflects the new value.
      setLoadingMoreKind(null);
    }
  }

  // Memoize derived value to avoid recomputing every render.
  const filteredSessions = useMemo(
    // Support the surrounding logic for this step.
    () => filterLiveSessions(sessionsWithTick, categoryFilter),
    // Support the surrounding logic for this step.
    [sessionsWithTick, categoryFilter],
  );

  // Memoize derived value to avoid recomputing every render.
  const filteredNeeds = useMemo(() => {
    // Conditional branch for the case described by this guard.
    if (!data) return [];
    // Return early result or rendered output from this path.
    return filterLiveNeeds(data.needsAttention, categoryFilter);
  // Support the surrounding logic for this step.
  }, [data, categoryFilter]);

  // Bind connLabel for use in the following logic.
  const connLabel =
    // Support the surrounding logic for this step.
    conn === "live"
      // Support the surrounding logic for this step.
      ? t("На живо", "Live")
      // Support the surrounding logic for this step.
      : conn === "stale"
        // Support the surrounding logic for this step.
        ? t("Остарели данни", "Stale data")
        // Support the surrounding logic for this step.
        : t("Офлайн", "Offline");

  // Define function actionForNeed and its behavior.
  function actionForNeed(item: LiveNeedsAttention): {
    // Provide label field used by this structure.
    label: string;
    // Provide run field used by this structure.
    run: () => void;
  // Support the surrounding logic for this step.
  } | null {
    // Bind panel for use in the following logic.
    const panel = attentionDestinationPanel(item);
    // Conditional branch for the case described by this guard.
    if (!canOpenPanel(panel)) return null;
    // Bind label for use in the following logic.
    const label = attentionActionLabel(item.kind, locale);
    // Conditional branch for the case described by this guard.
    if (item.kind === "blocking_ticket") {
      // Return early result or rendered output from this path.
      return {
        // Support the surrounding logic for this step.
        label,
        // Provide run field used by this structure.
        run: () =>
          // Invoke openFocus to perform this step.
          openFocus("repairs", {
            // Declare a type alias.
            type: "ticket",
            // Provide ticketId field used by this structure.
            ticketId: item.id,
            // Provide locationId field used by this structure.
            locationId: item.location.id,
          }),
      };
    }
    // Return early result or rendered output from this path.
    return {
      // Support the surrounding logic for this step.
      label,
      // Provide run field used by this structure.
      run: () => openLocation(item.location, { taskId: item.id }),
    };
  }


  // Return early result or rendered output from this path.
  return {
    t,
    // Support the surrounding logic for this step.
    canComplete,
    // Support the surrounding logic for this step.
    data,
    // Support the surrounding logic for this step.
    lastSuccessAt,
    // Support the surrounding logic for this step.
    conn,
    // Support the surrounding logic for this step.
    connLabel,
    // Support the surrounding logic for this step.
    error,
    // Support the surrounding logic for this step.
    message,
    // Support the surrounding logic for this step.
    setMessage,
    // Support the surrounding logic for this step.
    setError,
    // Support the surrounding logic for this step.
    loading,
    // Support the surrounding logic for this step.
    busyIds,
    // Support the surrounding logic for this step.
    categoryFilter,
    // Support the surrounding logic for this step.
    setCategoryFilter,
    // Support the surrounding logic for this step.
    loadingMoreKind,
    // Support the surrounding logic for this step.
    liveCounts,
    // Support the surrounding logic for this step.
    filteredSessions,
    // Support the surrounding logic for this step.
    filteredNeeds,
    // Support the surrounding logic for this step.
    refresh,
    // Support the surrounding logic for this step.
    onComplete,
    // Support the surrounding logic for this step.
    loadMore,
    // Support the surrounding logic for this step.
    openLocation,
    // Support the surrounding logic for this step.
    canOpenPanel,
    // Support the surrounding logic for this step.
    openFocus,
    // Support the surrounding logic for this step.
    actionForNeed,
    // Support the surrounding logic for this step.
    user,
    // Support the surrounding logic for this step.
    locale,
  };
}
