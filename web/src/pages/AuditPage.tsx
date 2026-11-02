/**
 * Audit event browser plus optional background job runs (`jobs.view`).
 * Live-refreshes on ticket/cleaning/settings/people/location/jobs changes.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAuditEvents,
  fetchJobRuns,
  canPerformAction,
  type AuthUser,
  type AuditEventRow,
  type JobRunRow,
} from "../api/client";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import {
  AUDIT_ACTION_FILTERS,
  AUDIT_ENTITY_FILTERS,
  auditHeadline,
  entityTypeLabel,
  formatAuditDetails,
  formatJobSummary,
  jobKeyLabel,
  jobStatusLabel,
} from "../audit/labels";
import {
  AUDIT_PAGE_LIVE_EVENTS,
  combineAuditLoadResults,
  formatAuditLoadErrors,
  formatAuditRelated,
  resolveEventsTableAfterLoad,
  settleAuditFetch,
  shouldApplyAuditRefresh,
} from "./auditPageLogic";
import { t } from "../i18n";

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
};

/**
 * Audit event browser plus optional background job runs (`jobs.view`).
 * Live-refreshes on ticket/cleaning/settings/people/location/jobs changes.
 */
export function AuditPage({ user, locale = "bg" }: Props) {
  // Audit event rows for the current filters.
  const [rows, setRows] = useState<AuditEventRow[]>([]);
  // Background job runs (only fetched when canJobs).
  const [jobs, setJobs] = useState<JobRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Soft-refresh left prior event rows visible after a failed events fetch. */
  const [eventsStale, setEventsStale] = useState(false);
  // Filter drafts: action + entity type (empty = all).
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  // Expanded audit row id for before/after detail list.
  const [expanded, setExpanded] = useState<string | null>(null);

  // Job runs table is separately gated.
  const canJobs = canPerformAction(user, "jobs.view");

  // Monotonic generation so older HTTP responses never overwrite newer filters.
  const refreshGen = useRef(0);
  // Keep latest filter/permission values for button / live paths without stale closures.
  const filtersRef = useRef({ action, entityType, canJobs });
  filtersRef.current = { action, entityType, canJobs };

  /**
   * Fetch audit rows and optionally job runs independently (BUG-04).
   * Applies results only when `gen` is still the latest generation (BUG-02).
   * Surfaces/clears error banners for every caller including Refresh (BUG-03).
   */
  const load = useCallback(
    async (opts: { gen: number; initial: boolean }) => {
      const { action: act, entityType: ent, canJobs: jobsAllowed } =
        filtersRef.current;
      if (opts.initial) {
        setLoading(true);
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const [eventsResult, jobsResult] = await Promise.all([
          settleAuditFetch(
            fetchAuditEvents({
              action: act.trim() || undefined,
              entityType: ent.trim() || undefined,
              limit: 150,
            }),
          ),
          jobsAllowed
            ? settleAuditFetch(fetchJobRuns(20))
            : Promise.resolve(null),
        ]);

        if (!shouldApplyAuditRefresh(opts.gen, refreshGen.current)) {
          return;
        }

        const combined = combineAuditLoadResults({
          events: eventsResult,
          jobs: jobsResult,
          eventsFallback: t(
            locale,
            "Неуспешно зареждане на одита",
            "Failed to load audit",
          ),
          jobsFallback: t(
            locale,
            "Неуспешно зареждане на фоновите задачи",
            "Failed to load background tasks",
          ),
        });

        const eventsDecision = resolveEventsTableAfterLoad({
          initial: opts.initial,
          eventsFailed: combined.eventsFailed,
          nextEvents: combined.events,
        });
        if (eventsDecision.rows !== "keep") {
          setRows(eventsDecision.rows);
        }
        setEventsStale(eventsDecision.stale);

        if (combined.jobs !== undefined) setJobs(combined.jobs);
        if (!jobsAllowed) setJobs([]);

        setError(
          formatAuditLoadErrors(combined.errors, locale, {
            eventsStale: eventsDecision.stale,
          }),
        );
      } finally {
        // Only the latest generation may clear busy flags (avoids stuck Loading…).
        if (shouldApplyAuditRefresh(opts.gen, refreshGen.current)) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [locale],
  );

  const bumpAndLoad = useCallback(
    async (initial: boolean) => {
      const gen = ++refreshGen.current;
      await load({ gen, initial });
    },
    [load],
  );

  // Soft live refresh while not in the initial loading state.
  useLiveRefresh(
    async () => {
      try {
        await bumpAndLoad(false);
      } catch {
        /* ignore soft-refresh failures */
      }
    },
    {
      enabled: !loading,
      busy: refreshing,
      eventTypes: AUDIT_PAGE_LIVE_EVENTS,
    },
  );

  // Re-fetch when filters or jobs permission change.
  useEffect(() => {
    void bumpAndLoad(true);
  }, [action, entityType, canJobs, bumpAndLoad]);

  const onManualRefresh = () => {
    void bumpAndLoad(false);
  };

  return (
    <div className="page audit-page">
      <header className="page-header">
        <div>
          <h1>{t(locale, "Одит лог", "Audit log")}</h1>
          <p className="muted">
            {t(
              locale,
              "История на важните действия в системата",
              "History of important actions in the system",
            )}
          </p>
        </div>
      </header>

      {/* Surface load/refresh errors. */}
      {error && <div className="banner error">{error}</div>}

      {/* Action + entity filters; empty option means all. */}
      <div className="toolbar filters-row">
        <label>
          {t(locale, "Действие", "Action")}
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">
              {t(locale, "Всички действия", "All actions")}
            </option>
            {AUDIT_ACTION_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(locale, opt.bg, opt.en)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t(locale, "Свързано с", "Related to")}
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
          >
            <option value="">
              {t(locale, "Всички типове", "All types")}
            </option>
            {AUDIT_ENTITY_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(locale, opt.bg, opt.en)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ghost"
          disabled={loading || refreshing}
          onClick={onManualRefresh}
        >
          {refreshing
            ? t(locale, "Обновяване…", "Refreshing…")
            : t(locale, "Обнови", "Refresh")}
        </button>
      </div>

      {/* Loading gate vs events (+ optional jobs) panels. */}
      {loading ? (
        <p className="muted">{t(locale, "Зареждане…", "Loading…")}</p>
      ) : (
        <>
          <section className="panel">
            <div className="panel-header">
              <h2>
                {t(locale, "Събития", "Events")} ({rows.length})
                {eventsStale
                  ? ` — ${t(locale, "остарели данни", "stale data")}`
                  : ""}
              </h2>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t(locale, "Кога", "When")}</th>
                    <th>{t(locale, "Кой", "Who")}</th>
                    <th>{t(locale, "Какво се случи", "What happened")}</th>
                    <th>{t(locale, "Свързано с", "Related to")}</th>
                    <th>{t(locale, "Причина", "Reason")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {/* Empty state vs event rows with optional expand. */}
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        {t(locale, "Няма събития.", "No events.")}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      // Before/after detail lines; empty means no expand button.
                      const detailLines = formatAuditDetails(
                        row.before,
                        row.after,
                        locale,
                      );
                      const hasDetails = detailLines.length > 0;

                      return (
                        <Fragment key={row.id}>
                          <tr>
                            <td>
                              {new Date(row.occurredAt).toLocaleString()}
                            </td>
                            <td>
                              {/* System actor when no person linked. */}
                              {row.actor?.fullName ??
                                t(locale, "Система", "System")}
                            </td>
                            <td>{auditHeadline(row, locale)}</td>
                            <td>
                              {formatAuditRelated(row, entityTypeLabel, locale)}
                            </td>
                            <td>{row.reason ?? "—"}</td>
                            <td>
                              {/* Toggle expand only when detail lines exist. */}
                              {hasDetails && (
                                <button
                                  type="button"
                                  className="subtle"
                                  onClick={() =>
                                    setExpanded(
                                      expanded === row.id ? null : row.id,
                                    )
                                  }
                                >
                                  {expanded === row.id
                                    ? t(locale, "Скрий", "Hide")
                                    : t(locale, "Подробности", "Details")}
                                </button>
                              )}
                            </td>
                          </tr>
                          {/* Expanded detail row under the event. */}
                          {expanded === row.id && hasDetails && (
                            <tr>
                              <td colSpan={6}>
                                <ul className="audit-details-list">
                                  {detailLines.map((line, idx) => (
                                    <li key={`${row.id}-${idx}`}>{line}</li>
                                  ))}
                                </ul>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {canJobs && (
            <section className="panel" style={{ marginTop: "1rem" }}>
              <div className="panel-header">
                <h2>{t(locale, "Фонови задачи", "Background tasks")}</h2>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t(locale, "Задача", "Task")}</th>
                      <th>{t(locale, "Статус", "Status")}</th>
                      <th>{t(locale, "Начало", "Started")}</th>
                      <th>{t(locale, "Край", "Finished")}</th>
                      <th>{t(locale, "Обобщение", "Summary")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="muted">
                          {t(locale, "Няма записи.", "No runs.")}
                        </td>
                      </tr>
                    ) : (
                      jobs.map((job) => (
                        <tr key={job.id} data-job-run-id={job.id}>
                          <td>{jobKeyLabel(job.jobKey, locale)}</td>
                          <td>{jobStatusLabel(job.status, locale)}</td>
                          <td>
                            {new Date(job.startedAt).toLocaleString()}
                          </td>
                          <td>
                            {/* Unfinished runs show an em dash. */}
                            {job.finishedAt
                              ? new Date(job.finishedAt).toLocaleString()
                              : "—"}
                          </td>
                          <td>
                            {formatJobSummary(
                              job.jobKey,
                              job.summary,
                              job.error,
                              locale,
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
