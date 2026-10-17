/**
 * Audit event browser plus optional background job runs (`jobs.view`).
 * Live-refreshes on ticket/cleaning/settings/people changes.
 */
import { Fragment, useCallback, useEffect, useState } from "react";
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

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
};

/** Pick BG vs EN copy for this page. */
function t(locale: "bg" | "en", bg: string, en: string) {
  return locale === "en" ? en : bg;
}

/**
 * Audit event browser plus optional background job runs (`jobs.view`).
 * Live-refreshes on ticket/cleaning/settings/people changes.
 */
export function AuditPage({ user, locale = "bg" }: Props) {
  // Audit event rows for the current filters.
  const [rows, setRows] = useState<AuditEventRow[]>([]);
  // Background job runs (only fetched when canJobs).
  const [jobs, setJobs] = useState<JobRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Filter drafts: action + entity type (empty = all).
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  // Expanded audit row id for before/after detail list.
  const [expanded, setExpanded] = useState<string | null>(null);

  // Job runs table is separately gated.
  const canJobs = canPerformAction(user, "jobs.view");

  /**
   * Fetch audit rows (filtered) and optionally recent job runs.
   * Skips the job fetch entirely without `jobs.view`.
   */
  const refresh = useCallback(async () => {
    // Parallel: audit events always; job runs only when permitted.
    const [auditRows, jobRows] = await Promise.all([
      fetchAuditEvents({
        action: action.trim() || undefined,
        entityType: entityType.trim() || undefined,
        limit: 150,
      }),
      // Skip job fetch entirely without jobs.view.
      canJobs ? fetchJobRuns(20) : Promise.resolve([] as JobRunRow[]),
    ]);
    setRows(auditRows);
    setJobs(jobRows);
  }, [action, entityType, canJobs]);

  // Soft live refresh while not in the initial loading state.
  useLiveRefresh(
    async () => {
      try {
        await refresh();
      } catch {
        /* ignore soft-refresh failures */
      }
    },
    {
      enabled: !loading,
      eventTypes: [
        "ticket.changed",
        "cleaning.changed",
        "settings.changed",
        "people.changed",
      ],
    },
  );

  // Re-fetch when filters or jobs permission change (via refresh deps).
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load audit");
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

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
        <button type="button" className="ghost" onClick={() => void refresh()}>
          {t(locale, "Обнови", "Refresh")}
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
                              {entityTypeLabel(row.entityType, locale)}
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
                                  {detailLines.map((line) => (
                                    <li key={line}>{line}</li>
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
                        <tr key={job.id}>
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
