/**
 * Live board orchestration: refresh coalesce/abort, SSE, stale clock,
 * busyIds, attention load-more, filters, and navigation helpers.
 * Presentational helpers and JSX stay in LiveBoardPage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canPerformAction,
  completeCleaningSession,
  fetchOperationsLive,
  fetchOperationsLiveAttention,
  filterPanelsByModules,
  panelsForUser,
  type AuthUser,
  type LiveNeedsAttention,
  type ModuleToggles,
  type OperationsLive,
  type Panel,
} from "../api/client";
import {
  panelForLocationKind,
  type BoardFocus,
  type NavigateToFocus,
} from "../app/boardFocus";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { labelFor } from "../i18n";
import { addBusyId, removeBusyId } from "./locations/busyIds";
import {
  attentionActionLabel,
  attentionDestinationPanel,
  deriveLiveConnAfterTick,
  filterLiveNeeds,
  filterLiveSessions,
  LIVE_BOARD_STALE_MS,
  mergeAttentionPage,
  sessionFlagsFromElapsed,
  shouldApplyLiveSnapshot,
  type LiveBoardCategoryFilter,
  type LiveBoardConnState,
} from "./liveBoardLogic";

export type { LiveBoardCategoryFilter, LiveBoardConnState };

const STALE_MS = LIVE_BOARD_STALE_MS;
const TICK_MS = 1_000;

export type UseLiveBoardControllerArgs = {
  user: AuthUser;
  locale?: "bg" | "en";
  modules?: ModuleToggles | null;
  onNavigate?: NavigateToFocus;
};

export function useLiveBoardController({
  user,
  locale = "bg",
  modules = null,
  onNavigate,
}: UseLiveBoardControllerArgs) {
  const t = labelFor(locale);
  // Server complete route requires cleaning.complete only (not review_overdue).
  const canComplete = canPerformAction(user, "cleaning.complete");
  const allowedPanels = useMemo(
    () => new Set(filterPanelsByModules(panelsForUser(user), modules)),
    [user, modules],
  );

  const [data, setData] = useState<OperationsLive | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [serverSkewMs, setServerSkewMs] = useState(0);
  const [conn, setConn] = useState<LiveBoardConnState>("offline");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const busyIdsRef = useRef<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [categoryFilter, setCategoryFilter] =
    useState<LiveBoardCategoryFilter>("all");
  const [loadingMoreKind, setLoadingMoreKind] = useState<
    LiveNeedsAttention["kind"] | null
  >(null);

  /** Generation so a late GET cannot overwrite a newer post-mutation refresh. */
  const refreshGen = useRef(0);
  const refreshInFlight = useRef<{
    promise: Promise<void>;
    silent: boolean;
    gen: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const refresh = useCallback(async (opts?: {
    silent?: boolean;
    force?: boolean;
  }) => {
    const silent = opts?.silent ?? false;
    const force = opts?.force ?? false;

    // Coalesce duplicate polls only onto a still-live request. Never join an
    // aborted in-flight promise (Strict Mode remount / force refresh).
    if (!force && refreshInFlight.current) {
      return refreshInFlight.current.promise;
    }

    if (force && abortRef.current) {
      abortRef.current.abort();
      refreshInFlight.current = null;
    }

    const gen = ++refreshGen.current;
    const ac = new AbortController();
    abortRef.current = ac;
    if (!silent) setLoading(true);

    const run = (async () => {
      try {
        const next = await fetchOperationsLive({ signal: ac.signal });
        if (
          ac.signal.aborted ||
          !shouldApplyLiveSnapshot(gen, refreshGen.current)
        ) {
          return;
        }
        const receivedAt = Date.now();
        const serverAt = new Date(next.updatedAt).getTime();
        if (Number.isFinite(serverAt)) {
          setServerSkewMs(serverAt - receivedAt);
        }
        setData(next);
        setLastSuccessAt(receivedAt);
        setConn("live");
        setError(null);
      } catch (err) {
        // Aborted refresh must not flip the board to offline or clear loading
        // for a newer generation that replaced this request.
        if (
          ac.signal.aborted ||
          !shouldApplyLiveSnapshot(gen, refreshGen.current)
        ) {
          return;
        }
        setError(
          err instanceof Error ? err.message : "Failed to load live board",
        );
        setConn("offline");
      } finally {
        if (refreshInFlight.current?.gen === gen) {
          refreshInFlight.current = null;
        }
        if (gen === refreshGen.current && !ac.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    refreshInFlight.current = { promise: run, silent, gen };
    return run;
  }, []);

  useEffect(() => {
    void refresh({ silent: false });
    return () => {
      // Invalidate before abort so a remount cannot coalesce onto this promise.
      refreshGen.current += 1;
      refreshInFlight.current = null;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [refresh]);

  useLiveRefresh(
    () => {
      void refresh({ silent: true });
    },
    {
      enabled: !loading,
      busy: busyIds.size > 0,
      eventTypes: [
        "location.changed",
        "cleaning.changed",
        "ticket.changed",
        "settings.changed",
      ],
    },
  );

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const next = deriveLiveConnAfterTick({
      conn,
      lastSuccessAt,
      now,
      staleMs: STALE_MS,
    });
    if (next !== conn) setConn(next);
  }, [now, lastSuccessAt, conn]);

  /** Client clock aligned to last server snapshot for overdue/anomaly parity. */
  const alignedNow = now + serverSkewMs;

  const sessionsWithTick = useMemo(() => {
    if (!data) return [];
    return data.activeSessions.map((s) => {
      const started = new Date(s.startedAt).getTime();
      const elapsedMinutes = Math.max(
        0,
        Math.floor((alignedNow - started) / 60_000),
      );
      return {
        ...s,
        elapsedMinutes,
        ...sessionFlagsFromElapsed(
          elapsedMinutes,
          data.overdueThresholdMinutes,
          data.anomalyThresholdMinutes,
        ),
      };
    });
  }, [data, alignedNow]);

  const liveCounts = useMemo(() => {
    if (!data) {
      return {
        active: 0,
        overdue: 0,
        anomalies: 0,
        awaitingInspection: 0,
        blockingTickets: 0,
      };
    }
    const overdue = sessionsWithTick.filter((s) => s.overdue).length;
    const anomalies = sessionsWithTick.filter((s) => s.anomaly).length;
    return {
      active: sessionsWithTick.length,
      overdue,
      anomalies,
      awaitingInspection: data.counts.awaitingInspection,
      blockingTickets: data.counts.blockingTickets,
    };
  }, [data, sessionsWithTick]);

  async function onComplete(sessionId: string) {
    if (!beginBusy(sessionId)) return;
    setMessage(null);
    try {
      await completeCleaningSession(sessionId);
      setMessage(t("Сесията е приключена", "Session completed"));
      await refresh({ silent: true, force: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Complete failed");
    } finally {
      endBusy(sessionId);
    }
  }

  function canOpenPanel(panel: Panel): boolean {
    return allowedPanels.has(panel);
  }

  function openFocus(panel: Panel, focus: BoardFocus) {
    if (!onNavigate || !canOpenPanel(panel)) return;
    onNavigate(panel, focus);
  }

  function openLocation(
    location: OperationsLive["activeSessions"][number]["location"],
    extra?: { taskId?: string; sessionId?: string },
  ) {
    const panel = panelForLocationKind(location.kind);
    if (!canOpenPanel(panel)) return;
    openFocus(panel, {
      type: "location",
      locationId: location.id,
      locationKind: location.kind === "common_area" ? "common_area" : "room",
      taskId: extra?.taskId,
      sessionId: extra?.sessionId,
    });
  }

  async function loadMore(kind: LiveNeedsAttention["kind"]) {
    if (!data?.attention) return;
    const meta =
      kind === "awaiting_inspection"
        ? data.attention.awaitingInspection
        : kind === "past_due"
          ? data.attention.pastDue
          : data.attention.blockingTickets;
    if (!meta.hasMore || !meta.nextCursor) return;
    setLoadingMoreKind(kind);
    try {
      const page = await fetchOperationsLiveAttention({
        kind,
        cursor: meta.nextCursor,
      });
      setData((prev) => (prev ? mergeAttentionPage(prev, kind, page) : prev));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load more items",
      );
    } finally {
      setLoadingMoreKind(null);
    }
  }

  const filteredSessions = useMemo(
    () => filterLiveSessions(sessionsWithTick, categoryFilter),
    [sessionsWithTick, categoryFilter],
  );

  const filteredNeeds = useMemo(() => {
    if (!data) return [];
    return filterLiveNeeds(data.needsAttention, categoryFilter);
  }, [data, categoryFilter]);

  const connLabel =
    conn === "live"
      ? t("На живо", "Live")
      : conn === "stale"
        ? t("Остарели данни", "Stale data")
        : t("Офлайн", "Offline");

  function actionForNeed(item: LiveNeedsAttention): {
    label: string;
    run: () => void;
  } | null {
    const panel = attentionDestinationPanel(item);
    if (!canOpenPanel(panel)) return null;
    const label = attentionActionLabel(item.kind, locale);
    if (item.kind === "blocking_ticket") {
      return {
        label,
        run: () =>
          openFocus("repairs", {
            type: "ticket",
            ticketId: item.id,
            locationId: item.location.id,
          }),
      };
    }
    return {
      label,
      run: () => openLocation(item.location, { taskId: item.id }),
    };
  }


  return {
    t,
    canComplete,
    data,
    lastSuccessAt,
    conn,
    connLabel,
    error,
    message,
    setMessage,
    setError,
    loading,
    busyIds,
    categoryFilter,
    setCategoryFilter,
    loadingMoreKind,
    liveCounts,
    filteredSessions,
    filteredNeeds,
    refresh,
    onComplete,
    loadMore,
    openLocation,
    canOpenPanel,
    openFocus,
    actionForNeed,
    user,
    locale,
  };
}
