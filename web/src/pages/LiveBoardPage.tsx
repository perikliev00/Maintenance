/**
 * Operations live board: polls every 15s (not SSE). Marks connection stale after
 * 45s without success; elapsed timers tick locally each second. Complete session
 * requires cleaning.complete or cleaning.review_overdue.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canPerformAction,
  completeCleaningSession,
  fetchOperationsLive,
  type AuthUser,
  type OperationsLive,
} from "../api/client";
import { ScopeHint } from "../components/ScopeHint";

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
};

type ConnState = "live" | "stale" | "offline";

const POLL_MS = 15_000;
const STALE_MS = 45_000;
const TICK_MS = 1_000;

/**
 * Compact elapsed duration: minutes, then hours, then days.
 * Used for active-session and recently-completed rows.
 */
function formatElapsed(minutes: number): string {
  // Under one hour: show minutes only.
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  // Under two days: hours + leftover minutes.
  if (h < 48) return `${h}h ${m}m`;
  // Longer: days + leftover hours.
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Location kind label for board rows (room vs common area). */
function kindLabel(kind: string, locale: "bg" | "en"): string {
  if (kind === "common_area") return locale === "bg" ? "Обща" : "Common";
  return locale === "bg" ? "Стая" : "Room";
}

/**
 * Attention-bucket kind label (inspection / past due / hold).
 * EN and BG branches mirror the same three kinds.
 */
function needKindLabel(
  kind: OperationsLive["needsAttention"][number]["kind"],
  locale: "bg" | "en",
): string {
  // English labels for attention kinds.
  if (locale === "en") {
    if (kind === "awaiting_inspection") return "Inspection";
    if (kind === "past_due") return "Past due";
    return "Hold / block";
  }
  // Bulgarian labels for attention kinds.
  if (kind === "awaiting_inspection") return "Инспекция";
  if (kind === "past_due") return "Просрочена";
  return "Задържане";
}

/**
 * Operations live board: polls every 15s (not SSE).
 * Marks connection stale after 45s without success; elapsed timers tick locally.
 */
export function LiveBoardPage({ user, locale = "bg" }: Props) {
  /** Inline BG/EN picker for this page. */
  const t = (bg: string, en: string) => (locale === "bg" ? bg : en);
  // Complete session requires cleaning.complete or cleaning.review_overdue.
  const canComplete =
    canPerformAction(user, "cleaning.complete") ||
    canPerformAction(user, "cleaning.review_overdue");

  // Last successful live payload (kept when polls fail for offline display).
  const [data, setData] = useState<OperationsLive | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [conn, setConn] = useState<ConnState>("offline");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Busy id while completing a session from the board.
  const [completingId, setCompletingId] = useState<string | null>(null);
  // Local clock for elapsed timers and stale detection.
  const [now, setNow] = useState(() => Date.now());
  // Deduplicate overlapping poll/manual refreshes.
  const refreshInFlight = useRef<Promise<void> | null>(null);

  /**
   * Fetch live board; silent polls skip the loading spinner.
   * Coalesces concurrent callers onto one in-flight promise.
   */
  const refresh = useCallback(async (silent = false) => {
    // Coalesce concurrent refreshes onto one in-flight promise.
    if (refreshInFlight.current) return refreshInFlight.current;
    // Manual refresh shows the spinner; silent polls do not.
    if (!silent) setLoading(true);
    const run = (async () => {
      try {
        const next = await fetchOperationsLive();
        setData(next);
        setLastSuccessAt(Date.now());
        setConn("live");
        setError(null);
      } catch (err) {
        // Keep last data; mark connection offline.
        setError(err instanceof Error ? err.message : "Failed to load live board");
        setConn("offline");
      } finally {
        setLoading(false);
        refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = run;
    return run;
  }, []);

  // Initial load + 15s silent poll loop.
  useEffect(() => {
    void refresh(false);
    const poll = window.setInterval(() => void refresh(true), POLL_MS);
    return () => {
      window.clearInterval(poll);
    };
  }, [refresh]);

  // One-second tick for elapsed minutes and stale checks.
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(tick);
  }, []);

  // Promote live → stale when last success is older than STALE_MS.
  useEffect(() => {
    // No success yet or already offline — leave connection state alone.
    if (!lastSuccessAt) return;
    if (conn === "offline") return;
    if (now - lastSuccessAt > STALE_MS) {
      setConn("stale");
    }
  }, [now, lastSuccessAt, conn]);

  /**
   * Active sessions with client-side elapsed minutes plus overdue/anomaly flags
   * derived from server thresholds.
   */
  const sessionsWithTick = useMemo(() => {
    // No payload yet — empty list.
    if (!data) return [];
    return data.activeSessions.map((s) => {
      const started = new Date(s.startedAt).getTime();
      const elapsedMinutes = Math.max(
        0,
        Math.floor((now - started) / 60_000),
      );
      return {
        ...s,
        elapsedMinutes,
        overdue: elapsedMinutes >= data.overdueThresholdMinutes,
        anomaly: elapsedMinutes >= data.anomalyThresholdMinutes,
      };
    });
  }, [data, now]);

  /**
   * Complete an active cleaning session from the board (overdue/anomaly rows).
   * Refreshes silently on success.
   */
  async function onComplete(sessionId: string) {
    setCompletingId(sessionId);
    setMessage(null);
    try {
      await completeCleaningSession(sessionId);
      setMessage(t("Сесията е приключена", "Session completed"));
      await refresh(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Complete failed");
    } finally {
      setCompletingId(null);
    }
  }

  // Connection badge label for live / stale / offline.
  const connLabel =
    conn === "live"
      ? t("На живо", "Live")
      : conn === "stale"
        ? t("Остарели данни", "Stale data")
        : t("Офлайн", "Offline");

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
          {/* Server updatedAt + local last-success clock when available. */}
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
            onClick={() => void refresh(false)}
            disabled={loading}
          >
            {t("Обнови", "Refresh")}
          </button>
        </div>
      </header>

      {/* Offline / stale connection banners. */}
      {(conn === "stale" || conn === "offline") && (
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

      {/* Error / success feedback. */}
      {error && <div className="error banner">{error}</div>}
      {message && <div className="ok banner">{message}</div>}

      {/* Initial load vs data panels vs empty fallback. */}
      {loading && !data ? (
        <p className="muted">{t("Зареждане…", "Loading…")}</p>
      ) : data ? (
        <>
          {/* Summary count strip. */}
          <section className="live-counts" aria-label={t("Обобщение", "Summary")}>
            <div className="stat-card">
              <span className="muted">{t("Активни", "Active")}</span>
              <strong>{data.counts.active}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">{t("Просрочени", "Overdue")}</span>
              <strong>{data.counts.overdue}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">{t("Аномалии", "Anomalies")}</span>
              <strong>{data.counts.anomalies}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">{t("Инспекции", "Inspections")}</span>
              <strong>{data.counts.awaitingInspection}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">{t("Блокиращи", "Blocking")}</span>
              <strong>{data.counts.blockingTickets}</strong>
            </div>
          </section>

          {/* Active sessions table with overdue/anomaly row classes. */}
          <section className="panel">
            <h2>
              {t("Активни сесии", "Active sessions")}
              <span className="muted">
                {" "}
                · {t("просрочване", "overdue")} &gt;{" "}
                {data.overdueThresholdMinutes}m · {t("аномалия", "anomaly")} &gt;{" "}
                {data.anomalyThresholdMinutes}m
              </span>
            </h2>
            {sessionsWithTick.length === 0 ? (
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
                      {/* Action column only when actor can complete. */}
                      {canComplete && <th>{t("Действие", "Action")}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sessionsWithTick.map((s) => (
                      <tr
                        key={s.sessionId}
                        className={
                          s.anomaly
                            ? "live-row-anomaly"
                            : s.overdue
                              ? "live-row-overdue"
                              : undefined
                        }
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
                          {/* Anomaly > overdue > running badge priority. */}
                          {s.anomaly ? (
                            <span className="badge badge-danger">
                              {t("Аномалия", "Anomaly")}
                            </span>
                          ) : s.overdue ? (
                            <span className="badge badge-warn">
                              {t("Просрочено", "Overdue")}
                            </span>
                          ) : (
                            <span className="badge badge-ok">
                              {t("Текуща", "Running")}
                            </span>
                          )}
                        </td>
                        {/* Complete only for overdue/anomaly when permitted. */}
                        {canComplete && (
                          <td>
                            {(s.overdue || s.anomaly) && (
                              <button
                                type="button"
                                className="ghost"
                                disabled={completingId === s.sessionId}
                                onClick={() => void onComplete(s.sessionId)}
                              >
                                {completingId === s.sessionId
                                  ? "…"
                                  : t("Приключи", "Complete")}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="live-two-col">
            {/* Needs-attention feed (inspection / past due / hold). */}
            <section className="panel">
              <h2>{t("Нуждаещи се от внимание", "Needs attention")}</h2>
              {data.needsAttention.length === 0 ? (
                <p className="muted">
                  {t("Няма елементи.", "Nothing needs attention.")}
                </p>
              ) : (
                <ul className="live-feed">
                  {data.needsAttention.map((item) => (
                    <li key={`${item.kind}:${item.id}`}>
                      <span className="badge badge-warn">
                        {needKindLabel(item.kind, locale)}
                      </span>{" "}
                      <strong>{item.location.number}</strong> — {item.title}
                      {/* Optional employee / priority meta. */}
                      {item.employee ? (
                        <span className="muted">
                          {" "}
                          · {item.employee.fullName}
                        </span>
                      ) : null}
                      {item.priority ? (
                        <span className="muted"> · {item.priority}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Sessions completed in the last hour. */}
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

          {/* Recent ops audit feed from the live payload. */}
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
