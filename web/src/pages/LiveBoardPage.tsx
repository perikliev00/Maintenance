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

  const summaries: { key: LiveBoardCategoryFilter; label: string; count: number; hint: string }[] = [
    { key: "active", label: t("Активни", "Active"), count: liveCounts.active, hint: t("Текуща работа по помещения", "Current cleaning work") },
    { key: "overdue", label: t("Просрочени", "Overdue"), count: liveCounts.overdue, hint: t("Сесии с изтекло време (≥ праг). Филтърът за внимание показва и просрочени задачи.", "Sessions at/over the duration threshold. Attention filter also shows past-due tasks.") },
    { key: "anomaly", label: t("Аномалии", "Anomalies"), count: liveCounts.anomalies, hint: t("Сесии с двойно просрочване", "Sessions at double the overdue threshold") },
    { key: "inspection", label: t("Инспекции", "Inspections"), count: liveCounts.awaitingInspection, hint: t("Задачи, чакащи проверка", "Tasks awaiting inspection") },
    { key: "blocking", label: t("Блокиращи", "Blocking"), count: liveCounts.blockingTickets, hint: t("Отворени повреди, блокиращи помещение", "Open issues that block a room") },
  ];

  return (
    <main className="content ui-live-monitor">
      <header className="page-header ui-briefing">
        <div>
          <p className="ui-eyebrow">{t("ОПЕРАЦИИ В МОМЕНТА", "OPERATIONS, RIGHT NOW")}</p>
          <h1>{t("Табло на живо", "Live board")}</h1>
          <p>{t("Вижте какво изисква решение. Поддържайте работата в движение.", "See what needs a decision. Keep the work moving.")}</p>
          <ScopeHint user={user} locale={locale} />
        </div>
        <div className="ui-monitor-status">
          <span className={`badge live-conn-${conn}`} role="status">{connLabel}</span>
          <button type="button" className="ghost" onClick={() => void refresh({ silent: false, force: true })} disabled={loading}>{t("Обнови", "Refresh")}</button>
          {data && <small className="muted">{t("Сървър", "Server")}: {new Date(data.updatedAt).toLocaleTimeString()}{lastSuccessAt ? ` · ${t("получено", "fetched")} ${new Date(lastSuccessAt).toLocaleTimeString()}` : null}</small>}
        </div>
      </header>
      {(conn === "stale" || (conn === "offline" && !(loading && !data))) && <div className={`banner ${conn === "offline" ? "error" : "warn"}`} role="status">{conn === "offline" ? t("Няма връзка — показват се последните получени данни.", "No connection — showing last received data.") : t("Данните не са обновявани от над 45 секунди.", "Data has not refreshed for over 45 seconds.")}</div>}
      {error && <div className="error banner" role="alert">{error}</div>}
      {message && <div className="ok banner" role="status">{message}</div>}
      {loading && !data ? <LoadingIndicator label={t("Зареждане…", "Loading…")} /> : data ? <>
        <section className="ui-metrics ui-monitor-filters" aria-label={t("Обобщение", "Summary")}>
          {summaries.map((item) => <button key={item.key} type="button" className={`ui-metric ${categoryFilter === item.key ? "is-selected" : ""}`} aria-pressed={categoryFilter === item.key} aria-label={`${item.label}: ${item.count}. ${item.hint}`} title={item.hint} onClick={() => setCategoryFilter((previous) => previous === item.key ? "all" : item.key)}><span>{item.label}</span><strong>{item.count}</strong></button>)}
        </section>
        {categoryFilter !== "all" && <div className="ui-action-strip"><span className="muted">{t("Филтър", "Filter")}: <strong>{summaries.find((item) => item.key === categoryFilter)?.label}</strong></span><button type="button" className="ghost" onClick={() => setCategoryFilter("all")}>{t("Всички", "All")}</button></div>}

        <section className="ui-surface ui-attention-workspace">
          <div className="ui-section-heading"><p className="ui-eyebrow">{t("СЛЕДВАЩО РЕШЕНИЕ", "NEXT DECISION")}</p><h2>{t("Нуждаещи се от внимание", "Needs attention")}</h2></div>
          {filteredNeeds.length === 0 ? <p className="ui-empty muted">{t("Няма елементи.", "Nothing needs attention.")}</p> : <ul className="ui-queue">
            {filteredNeeds.map((item) => {
              const category = item.kind === "awaiting_inspection" ? "inspection" : item.kind === "past_due" ? "overdue" : "blocking";
              const action = actionForNeed(item);
              return <li key={`${item.kind}:${item.id}`} className={`ui-work-item ui-need-${category}`}>
                <div className="ui-work-item-location"><strong>{item.location.number}</strong><small>{kindLabel(item.location.kind, locale)}</small></div>
                <div className="ui-work-item-body"><span className={`badge ${categoryClass(category)}`}>{needKindLabel(item.kind, locale)}</span><h3>{needTitle(item, locale)}</h3><p className="muted">{item.employee?.fullName}{item.priority ? ` · ${priorityLabel(locale, item.priority)}` : ""}</p></div>
                {action && <div className="ui-work-item-actions"><button type="button" onClick={action.run}>{action.label}</button></div>}
              </li>;
            })}
          </ul>}
          {categoryFilter === "all" && data.attention && <div className="ui-action-strip">
            {data.attention.awaitingInspection.hasMore && <button type="button" className="ghost" disabled={loadingMoreKind === "awaiting_inspection"} onClick={() => void loadMore("awaiting_inspection")}>{t("Още инспекции", "More inspections")}{` (${data.attention.awaitingInspection.returned}/${data.attention.awaitingInspection.total})`}</button>}
            {data.attention.pastDue.hasMore && <button type="button" className="ghost" disabled={loadingMoreKind === "past_due"} onClick={() => void loadMore("past_due")}>{t("Още просрочени задачи", "More past-due tasks")}{` (${data.attention.pastDue.returned}/${data.attention.pastDue.total})`}</button>}
            {data.attention.blockingTickets.hasMore && <button type="button" className="ghost" disabled={loadingMoreKind === "blocking_ticket"} onClick={() => void loadMore("blocking_ticket")}>{t("Още блокиращи", "More blocking")}{` (${data.attention.blockingTickets.returned}/${data.attention.blockingTickets.total})`}</button>}
          </div>}
        </section>

        {(categoryFilter === "all" || categoryFilter === "active" || categoryFilter === "overdue" || categoryFilter === "anomaly") && <section className="ui-surface">
          <div className="ui-section-heading ui-action-strip"><h2>{t("Активни сесии", "Active sessions")}</h2><span className="muted">{t("просрочване", "overdue")} ≥ {data.overdueThresholdMinutes}m · {t("аномалия", "anomaly")} ≥ {data.anomalyThresholdMinutes}m</span></div>
          {filteredSessions.length === 0 ? <p className="ui-empty muted">{t("Няма активни сесии.", "No active sessions.")}</p> : <ul className="ui-queue">
            {filteredSessions.map((session) => {
              const category = sessionCategory(session);
              const canOpenLocation = canOpenPanel(panelForLocationKind(session.location.kind));
              return <li key={session.sessionId} className={`ui-work-item live-row-${category}`}>
                <div className="ui-work-item-location"><strong>{session.location.number}</strong><small>{kindLabel(session.location.kind, locale)}</small></div>
                <div className="ui-work-item-body"><h3>{session.employee.fullName}</h3><p className="muted">{session.employee.employeeNumber} · {session.location.buildingCode} / {t("ет.", "fl.")} {session.location.floor}</p><span className={`badge ${categoryClass(category)}`}>{session.anomaly ? t("Аномалия", "Anomaly") : session.overdue ? t("Просрочено", "Overdue") : t("Текуща", "Running")}</span></div>
                <div className="ui-session-clock"><strong>{formatElapsed(session.elapsedMinutes)}</strong><small>{t("Изтекло", "Elapsed")}</small></div>
                <div className="ui-work-item-actions">
                  {canOpenLocation && <button type="button" className="ghost" onClick={() => openLocation(session.location, { taskId: session.taskId, sessionId: session.sessionId })}>{session.location.kind === "common_area" ? t("Отвори помещението", "Open location") : t("Отвори стаята", "Open room")}</button>}
                  {(session.overdue || session.anomaly) && <button type="button" className="ghost" disabled={!canOpenLocation} onClick={() => openLocation(session.location, { taskId: session.taskId, sessionId: session.sessionId })}>{t("Преглед на сесията", "Review session")}</button>}
                  {canComplete && (session.overdue || session.anomaly) && <button type="button" disabled={busyIds.has(session.sessionId)} onClick={() => void onComplete(session.sessionId)}>{busyIds.has(session.sessionId) ? "…" : t("Приключи", "Complete")}</button>}
                </div>
              </li>;
            })}
          </ul>}
        </section>}

        <section className="ui-surface">
          <div className="ui-section-heading"><p className="ui-eyebrow">{t("ПОСЛЕДНИЯТ ЧАС", "THE LAST HOUR")}</p><h2>{t("Току-що завършени", "Just completed")}</h2></div>
          {data.recentlyCompleted.length === 0 ? <p className="ui-empty muted">{t("Няма завършени през последния час.", "None completed in the last hour.")}</p> : <ol className="ui-completion-log">{data.recentlyCompleted.map((session) => <li key={session.sessionId}><strong>{session.location.number}</strong><span>{session.employee.fullName}</span><span className="muted">{formatElapsed(session.durationMinutes)}</span><time>{new Date(session.finishedAt).toLocaleTimeString()}</time></li>)}</ol>}
        </section>
        <details className="ui-surface ui-event-log">
          <summary>{t("Одит / събития", "Ops audit")} <span className="muted">({data.auditFeed.length})</span></summary>
          {data.auditFeed.length === 0 ? <p className="ui-empty muted">{t("Няма скорошни събития.", "No recent events.")}</p> : <ol className="ui-completion-log">{data.auditFeed.map((event) => <li key={`${event.type}:${event.entityId}:${event.at}`}><time className="muted">{new Date(event.at).toLocaleString()}</time><span>{event.summary}</span></li>)}</ol>}
        </details>
      </> : <p className="ui-empty muted">{t("Няма данни.", "No data.")}</p>}
    </main>
  );
}
