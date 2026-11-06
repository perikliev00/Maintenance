/**
 * Operations live board: SSE-driven refresh via useLiveRefresh, with local
 * elapsed timers each second. Marks connection stale after 45s without success.
 * Complete session requires cleaning.complete. Category colors and deep-links
 * follow capabilities.
 */
import type {
  AuthUser,
  LiveNeedsAttention,
  ModuleToggles,
} from "../api/client";
import {
  panelForLocationKind,
  type NavigateToFocus,
} from "../app/boardFocus";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { ScopeHint } from "../components/ScopeHint";
import { priorityLabel } from "./locations/labels";
import { needTitle, sessionCategory } from "./liveBoardLogic";
import {
  useLiveBoardController,
  type LiveBoardCategoryFilter,
} from "./useLiveBoardController";

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
  modules?: ModuleToggles | null;
  onNavigate?: NavigateToFocus;
};

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
  const board = useLiveBoardController({ user, locale, modules, onNavigate });
  const {
    t,
    canComplete,
    data,
    lastSuccessAt,
    conn,
    connLabel,
    error,
    message,
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
    actionForNeed,
  } = board;

  function cardProps(
    key: LiveBoardCategoryFilter,
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
        <LoadingIndicator label={t("Зареждане…", "Loading…")} />
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
