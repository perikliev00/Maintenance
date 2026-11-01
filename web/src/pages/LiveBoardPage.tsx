/**
 * Operations live board: polls every 15s (not SSE). Marks connection stale after
 * 45s without success; elapsed timers tick locally each second. Complete session
 * requires cleaning.complete. Category colors and deep-links follow capabilities.
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
import { ScopeHint } from "../components/ScopeHint";
import { priorityLabel } from "./locations/labels";
import { addBusyId, removeBusyId } from "./locations/busyIds";
import {
  needTitle,
  sessionCategory,
  shouldApplyLiveSnapshot,
} from "./liveBoardLogic";

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
  modules?: ModuleToggles | null;
  onNavigate?: NavigateToFocus;
};

type ConnState = "live" | "stale" | "offline";
type CategoryFilter =
  | "all"
  | "active"
  | "overdue"
  | "anomaly"
  | "inspection"
  | "blocking";

const POLL_MS = 15_000;
const STALE_MS = 45_000;
const TICK_MS = 1_000;

function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 48) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function kindLabel(kind: string, locale: "bg" | "en"): string {
  if (kind === "common_area") return locale === "bg" ? "Обща" : "Common";
  return locale === "bg" ? "Стая" : "Room";
}

function needKindLabel(
  kind: LiveNeedsAttention["kind"],
  locale: "bg" | "en",
): string {
  if (locale === "en") {
    if (kind === "awaiting_inspection") return "Inspection";
    if (kind === "past_due") return "Past due";
    return "Hold / block";
  }
  if (kind === "awaiting_inspection") return "Инспекция";
  if (kind === "past_due") return "Просрочена";
  return "Задържане";
}

function categoryClass(
  cat: "active" | "overdue" | "anomaly" | "inspection" | "blocking",
): string {
  return `live-cat live-cat-${cat}`;
}

export function LiveBoardPage({
  user,
  locale = "bg",
  modules = null,
  onNavigate,
}: Props) {
  const t = (bg: string, en: string) => (locale === "bg" ? bg : en);
  // Server complete route requires cleaning.complete only (not review_overdue).
  const canComplete = canPerformAction(user, "cleaning.complete");
  const allowedPanels = useMemo(
    () => new Set(filterPanelsByModules(panelsForUser(user), modules)),
    [user, modules],
  );

  const [data, setData] = useState<OperationsLive | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [serverSkewMs, setServerSkewMs] = useState(0);
  const [conn, setConn] = useState<ConnState>("offline");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const busyIdsRef = useRef<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
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
    const poll = window.setInterval(
      () => void refresh({ silent: true }),
      POLL_MS,
    );
    return () => {
      window.clearInterval(poll);
      // Invalidate before abort so a remount cannot coalesce onto this promise.
      refreshGen.current += 1;
      refreshInFlight.current = null;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!lastSuccessAt) return;
    if (conn === "offline") return;
    if (now - lastSuccessAt > STALE_MS) {
      setConn("stale");
    }
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
        overdue: elapsedMinutes >= data.overdueThresholdMinutes,
        anomaly: elapsedMinutes >= data.anomalyThresholdMinutes,
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
      setData((prev) => {
        if (!prev) return prev;
        const existingKeys = new Set(
          prev.needsAttention.map((n) => `${n.kind}:${n.id}`),
        );
        const existingIds = new Set(prev.needsAttention.map((n) => n.id));
        const merged = [
          ...prev.needsAttention,
          ...page.items.filter(
            (n) =>
              !existingKeys.has(`${n.kind}:${n.id}`) && !existingIds.has(n.id),
          ),
        ];
        const attention = { ...prev.attention! };
        const nextMeta = {
          total: page.total,
          returned:
            (kind === "awaiting_inspection"
              ? attention.awaitingInspection.returned
              : kind === "past_due"
                ? attention.pastDue.returned
                : attention.blockingTickets.returned) + page.returned,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
        };
        if (kind === "awaiting_inspection") {
          attention.awaitingInspection = nextMeta;
        } else if (kind === "past_due") {
          attention.pastDue = nextMeta;
        } else {
          attention.blockingTickets = nextMeta;
        }
        return { ...prev, needsAttention: merged, attention };
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load more items",
      );
    } finally {
      setLoadingMoreKind(null);
    }
  }

  const filteredSessions = useMemo(() => {
    if (categoryFilter === "all" || categoryFilter === "inspection" || categoryFilter === "blocking") {
      return sessionsWithTick;
    }
    if (categoryFilter === "active") {
      return sessionsWithTick.filter((s) => !s.overdue && !s.anomaly);
    }
    if (categoryFilter === "overdue") {
      return sessionsWithTick.filter((s) => s.overdue);
    }
    return sessionsWithTick.filter((s) => s.anomaly);
  }, [sessionsWithTick, categoryFilter]);

  const filteredNeeds = useMemo(() => {
    if (!data) return [];
    if (categoryFilter === "inspection") {
      return data.needsAttention.filter((n) => n.kind === "awaiting_inspection");
    }
    if (categoryFilter === "blocking") {
      return data.needsAttention.filter((n) => n.kind === "blocking_ticket");
    }
    if (categoryFilter === "overdue") {
      // Past-due tasks (not session overdue) when filtering attention by overdue card.
      return data.needsAttention.filter((n) => n.kind === "past_due");
    }
    if (
      categoryFilter === "active" ||
      categoryFilter === "anomaly"
    ) {
      return [];
    }
    return data.needsAttention;
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
    if (item.kind === "blocking_ticket") {
      if (!canOpenPanel("repairs")) return null;
      return {
        label: t("Отвори повредата", "Open issue"),
        run: () =>
          openFocus("repairs", {
            type: "ticket",
            ticketId: item.id,
            locationId: item.location.id,
          }),
      };
    }
    const panel = panelForLocationKind(item.location.kind);
    if (!canOpenPanel(panel)) return null;
    if (item.kind === "awaiting_inspection") {
      return {
        label: t("Преглед на инспекцията", "Review inspection"),
        run: () => openLocation(item.location, { taskId: item.id }),
      };
    }
    return {
      label: t("Отвори задачата", "Open task"),
      run: () => openLocation(item.location, { taskId: item.id }),
    };
  }

  function cardProps(
    key: CategoryFilter,
    label: string,
    count: number,
    cat: "active" | "overdue" | "anomaly" | "inspection" | "blocking",
    hint: string,
  ) {
    const active = categoryFilter === key;
    const zero = count === 0;
    return (
      <button
        type="button"
        className={`stat-card live-stat-card ${categoryClass(cat)}${
          active ? " live-stat-card-active" : ""
        }${zero ? " live-stat-card-zero" : ""}`}
        aria-pressed={active}
        aria-label={`${label}: ${count}. ${hint}`}
        title={hint}
        onClick={() =>
          setCategoryFilter((prev) => (prev === key ? "all" : key))
        }
      >
        <span className="live-stat-marker" aria-hidden />
        <span className="muted">{label}</span>
        <strong>{count}</strong>
      </button>
    );
  }

  return (
    <div className="content live-board">
      <header className="page-header live-board-header">
        <div>
          <h1>{t("Табло на живо", "Live board")}</h1>
          <p className="muted">
            {t(
              "Активни сесии, внимание и скорошни събития",
              "Active sessions, attention items, and recent events",
            )}
          </p>
          <ScopeHint user={user} locale={locale} />
        </div>
        <div className="live-board-toolbar">
          <span className={`live-conn live-conn-${conn}`} role="status">
            <span className="live-conn-dot" aria-hidden />
            {connLabel}
          </span>
          {data && (
            <span className="muted live-updated">
              {t("Сървър", "Server")}:{" "}
              {new Date(data.updatedAt).toLocaleTimeString()}
              {lastSuccessAt
                ? ` · ${t("получено", "fetched")} ${new Date(
                    lastSuccessAt,
                  ).toLocaleTimeString()}`
                : null}
            </span>
          )}
          <button
            type="button"
            className="ghost"
            onClick={() => void refresh({ silent: false, force: true })}
            disabled={loading}
          >
            {t("Обнови", "Refresh")}
          </button>
        </div>
      </header>

      {/* Hide offline banner during the first in-flight load (conn starts offline). */}
      {(conn === "stale" || (conn === "offline" && !(loading && !data))) && (
        <div className={`banner ${conn === "offline" ? "error" : "warn"}`}>
          {conn === "offline"
            ? t(
                "Няма връзка — показват се последните получени данни.",
                "No connection — showing last received data.",
              )
            : t(
                "Данните не са обновявани от над 45 секунди.",
                "Data has not refreshed for over 45 seconds.",
              )}
        </div>
      )}

      {error && <div className="error banner">{error}</div>}
      {message && <div className="ok banner">{message}</div>}

      {loading && !data ? (
        <p className="muted">{t("Зареждане…", "Loading…")}</p>
      ) : data ? (
        <>
          <section className="live-counts" aria-label={t("Обобщение", "Summary")}>
            {cardProps(
              "active",
              t("Активни", "Active"),
              liveCounts.active,
              "active",
              t("Текуща работа по помещения", "Current cleaning work"),
            )}
            {cardProps(
              "overdue",
              t("Просрочени", "Overdue"),
              liveCounts.overdue,
              "overdue",
              t(
                "Сесии с изтекло време (≥ праг). Филтърът за внимание показва и просрочени задачи.",
                "Sessions at/over the duration threshold. Attention filter also shows past-due tasks.",
              ),
            )}
            {cardProps(
              "anomaly",
              t("Аномалии", "Anomalies"),
              liveCounts.anomalies,
              "anomaly",
              t("Сесии с двойно просрочване", "Sessions at double the overdue threshold"),
            )}
            {cardProps(
              "inspection",
              t("Инспекции", "Inspections"),
              liveCounts.awaitingInspection,
              "inspection",
              t("Задачи, чакащи проверка", "Tasks awaiting inspection"),
            )}
            {cardProps(
              "blocking",
              t("Блокиращи", "Blocking"),
              liveCounts.blockingTickets,
              "blocking",
              t("Отворени повреди, блокиращи помещение", "Open issues that block a room"),
            )}
          </section>

          {categoryFilter !== "all" && (
            <div className="live-filter-bar">
              <span className="muted">
                {t("Филтър", "Filter")}:{" "}
                <strong>
                  {categoryFilter === "active"
                    ? t("Активни", "Active")
                    : categoryFilter === "overdue"
                      ? t("Просрочени", "Overdue")
                      : categoryFilter === "anomaly"
                        ? t("Аномалии", "Anomalies")
                        : categoryFilter === "inspection"
                          ? t("Инспекции", "Inspections")
                          : t("Блокиращи", "Blocking")}
                </strong>
              </span>
              <button
                type="button"
                className="ghost"
                onClick={() => setCategoryFilter("all")}
              >
                {t("Всички", "All")}
              </button>
            </div>
          )}

          {(categoryFilter === "all" ||
            categoryFilter === "active" ||
            categoryFilter === "overdue" ||
            categoryFilter === "anomaly") && (
            <section className="panel">
              <h2>
                {t("Активни сесии", "Active sessions")}
                <span className="muted">
                  {" "}
                  · {t("просрочване", "overdue")} ≥{" "}
                  {data.overdueThresholdMinutes}m · {t("аномалия", "anomaly")} ≥{" "}
                  {data.anomalyThresholdMinutes}m
                </span>
              </h2>
              {filteredSessions.length === 0 ? (
                <p className="muted">
                  {t("Няма активни сесии.", "No active sessions.")}
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Помещение", "Location")}</th>
                        <th>{t("Камериер", "Housekeeper")}</th>
                        <th>{t("Изтекло", "Elapsed")}</th>
                        <th>{t("Статус", "Status")}</th>
                        <th>{t("Действие", "Action")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSessions.map((s) => {
                        const rowCat = sessionCategory(s);
                        const canOpenLoc = canOpenPanel(
                          panelForLocationKind(s.location.kind),
                        );
                        return (
                          <tr
                            key={s.sessionId}
                            className={`live-row-${rowCat}`}
                          >
                            <td>
                              {kindLabel(s.location.kind, locale)}{" "}
                              <strong>{s.location.number}</strong>
                              <span className="muted">
                                {" "}
                                · {s.location.buildingCode} /{" "}
                                {t("ет.", "fl.")} {s.location.floor}
                              </span>
                            </td>
                            <td>
                              {s.employee.fullName}
                              <span className="muted">
                                {" "}
                                · {s.employee.employeeNumber}
                              </span>
                            </td>
                            <td>{formatElapsed(s.elapsedMinutes)}</td>
                            <td>
                              {s.anomaly ? (
                                <span
                                  className={`badge ${categoryClass("anomaly")}`}
                                >
                                  {t("Аномалия", "Anomaly")}
                                </span>
                              ) : s.overdue ? (
                                <span
                                  className={`badge ${categoryClass("overdue")}`}
                                >
                                  {t("Просрочено", "Overdue")}
                                </span>
                              ) : (
                                <span
                                  className={`badge ${categoryClass("active")}`}
                                >
                                  {t("Текуща", "Running")}
                                </span>
                              )}
                            </td>
                            <td className="live-row-actions">
                              {canOpenLoc && (
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={() =>
                                    openLocation(s.location, {
                                      taskId: s.taskId,
                                      sessionId: s.sessionId,
                                    })
                                  }
                                >
                                  {s.location.kind === "common_area"
                                    ? t(
                                        "Отвори помещението",
                                        "Open location",
                                      )
                                    : t("Отвори стаята", "Open room")}
                                </button>
                              )}
                              {(s.overdue || s.anomaly) && (
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={() =>
                                    openLocation(s.location, {
                                      taskId: s.taskId,
                                      sessionId: s.sessionId,
                                    })
                                  }
                                  disabled={!canOpenLoc}
                                >
                                  {t("Преглед на сесията", "Review session")}
                                </button>
                              )}
                              {canComplete && (s.overdue || s.anomaly) && (
                                <button
                                  type="button"
                                  className="ghost"
                                  disabled={busyIds.has(s.sessionId)}
                                  onClick={() => void onComplete(s.sessionId)}
                                >
                                  {busyIds.has(s.sessionId)
                                    ? "…"
                                    : t("Приключи", "Complete")}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <div className="live-two-col">
            <section className="panel">
              <h2>{t("Нуждаещи се от внимание", "Needs attention")}</h2>
              {filteredNeeds.length === 0 ? (
                <p className="muted">
                  {t("Няма елементи.", "Nothing needs attention.")}
                </p>
              ) : (
                <ul className="live-feed">
                  {filteredNeeds.map((item) => {
                    const cat =
                      item.kind === "awaiting_inspection"
                        ? "inspection"
                        : item.kind === "past_due"
                          ? "overdue"
                          : "blocking";
                    const action = actionForNeed(item);
                    return (
                      <li
                        key={`${item.kind}:${item.id}`}
                        className={`live-need live-need-${cat}`}
                      >
                        <div className="live-need-main">
                          <span className={`badge ${categoryClass(cat)}`}>
                            {needKindLabel(item.kind, locale)}
                          </span>{" "}
                          <strong>{item.location.number}</strong>
                          {" — "}
                          {needTitle(item, locale)}
                          {item.employee ? (
                            <span className="muted">
                              {" "}
                              · {item.employee.fullName}
                            </span>
                          ) : null}
                          {item.priority ? (
                            <span className="muted">
                              {" "}
                              · {priorityLabel(locale, item.priority)}
                            </span>
                          ) : null}
                        </div>
                        {action && (
                          <button
                            type="button"
                            className="ghost"
                            onClick={action.run}
                          >
                            {action.label}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {categoryFilter === "all" && data.attention && (
                <div className="live-load-more">
                  {data.attention.awaitingInspection.hasMore && (
                    <button
                      type="button"
                      className="ghost"
                      disabled={loadingMoreKind === "awaiting_inspection"}
                      onClick={() => void loadMore("awaiting_inspection")}
                    >
                      {t("Още инспекции", "More inspections")}
                      {` (${data.attention.awaitingInspection.returned}/${data.attention.awaitingInspection.total})`}
                    </button>
                  )}
                  {data.attention.pastDue.hasMore && (
                    <button
                      type="button"
                      className="ghost"
                      disabled={loadingMoreKind === "past_due"}
                      onClick={() => void loadMore("past_due")}
                    >
                      {t("Още просрочени задачи", "More past-due tasks")}
                      {` (${data.attention.pastDue.returned}/${data.attention.pastDue.total})`}
                    </button>
                  )}
                  {data.attention.blockingTickets.hasMore && (
                    <button
                      type="button"
                      className="ghost"
                      disabled={loadingMoreKind === "blocking_ticket"}
                      onClick={() => void loadMore("blocking_ticket")}
                    >
                      {t("Още блокиращи", "More blocking")}
                      {` (${data.attention.blockingTickets.returned}/${data.attention.blockingTickets.total})`}
                    </button>
                  )}
                </div>
              )}
            </section>

            <section className="panel">
              <h2>{t("Току-що завършени", "Just completed")}</h2>
              {data.recentlyCompleted.length === 0 ? (
                <p className="muted">
                  {t(
                    "Няма завършени през последния час.",
                    "None completed in the last hour.",
                  )}
                </p>
              ) : (
                <ul className="live-feed">
                  {data.recentlyCompleted.map((s) => (
                    <li key={s.sessionId}>
                      <strong>{s.location.number}</strong> · {s.employee.fullName}{" "}
                      <span className="muted">
                        · {formatElapsed(s.durationMinutes)} ·{" "}
                        {new Date(s.finishedAt).toLocaleTimeString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="panel">
            <h2>{t("Одит / събития", "Ops audit")}</h2>
            {data.auditFeed.length === 0 ? (
              <p className="muted">
                {t("Няма скорошни събития.", "No recent events.")}
              </p>
            ) : (
              <ul className="live-feed">
                {data.auditFeed.map((ev) => (
                  <li key={`${ev.type}:${ev.entityId}:${ev.at}`}>
                    <span className="muted">
                      {new Date(ev.at).toLocaleString()}
                    </span>{" "}
                    — {ev.summary}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <p className="muted">{t("Няма данни.", "No data.")}</p>
      )}
    </div>
  );
}
