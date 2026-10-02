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

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
};

function t(locale: "bg" | "en", bg: string, en: string) {
  return locale === "en" ? en : bg;
}

export function AuditPage({ user, locale = "bg" }: Props) {
  const [rows, setRows] = useState<AuditEventRow[]>([]);
  const [jobs, setJobs] = useState<JobRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const canJobs = canPerformAction(user, "jobs.view");

  const refresh = useCallback(async () => {
    const [auditRows, jobRows] = await Promise.all([
      fetchAuditEvents({
        action: action.trim() || undefined,
        entityType: entityType.trim() || undefined,
        limit: 150,
      }),
      canJobs ? fetchJobRuns(20) : Promise.resolve([] as JobRunRow[]),
    ]);
    setRows(auditRows);
    setJobs(jobRows);
  }, [action, entityType, canJobs]);

  useLiveRefresh(
    async () => {
      try {
        await refresh();
      } catch {
        /* ignore */
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
              "Крос-домейн история на действията",
              "Cross-domain action history",
            )}
          </p>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="toolbar filters-row">
        <label>
          {t(locale, "Действие", "Action")}
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="ticket.assign"
          />
        </label>
        <label>
          {t(locale, "Тип", "Entity type")}
          <input
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="maintenance_ticket"
          />
        </label>
        <button type="button" className="ghost" onClick={() => void refresh()}>
          {t(locale, "Обнови", "Refresh")}
        </button>
      </div>

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
                    <th>{t(locale, "Актор", "Actor")}</th>
                    <th>{t(locale, "Действие", "Action")}</th>
                    <th>{t(locale, "Обект", "Entity")}</th>
                    <th>{t(locale, "Причина", "Reason")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <Fragment key={row.id}>
                      <tr>
                        <td>{new Date(row.occurredAt).toLocaleString()}</td>
                        <td>{row.actor?.fullName ?? "—"}</td>
                        <td>
                          <code>{row.action}</code>
                        </td>
                        <td>
                          {row.entityType}/{row.entityId.slice(0, 8)}…
                        </td>
                        <td>{row.reason ?? "—"}</td>
                        <td>
                          <button
                            type="button"
                            className="subtle"
                            onClick={() =>
                              setExpanded(expanded === row.id ? null : row.id)
                            }
                          >
                            {expanded === row.id ? "Hide" : "JSON"}
                          </button>
                        </td>
                      </tr>
                      {expanded === row.id && (
                        <tr>
                          <td colSpan={6}>
                            <pre className="audit-json">
                              {JSON.stringify(
                                { before: row.before, after: row.after },
                                null,
                                2,
                              )}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {canJobs && (
            <section className="panel" style={{ marginTop: "1rem" }}>
              <div className="panel-header">
                <h2>{t(locale, "Фонови jobs", "Background jobs")}</h2>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t(locale, "Job", "Job")}</th>
                      <th>{t(locale, "Статус", "Status")}</th>
                      <th>{t(locale, "Начало", "Started")}</th>
                      <th>{t(locale, "Край", "Finished")}</th>
                      <th>{t(locale, "Обобщение", "Summary")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td>
                          <code>{job.jobKey}</code>
                        </td>
                        <td>{job.status}</td>
                        <td>{new Date(job.startedAt).toLocaleString()}</td>
                        <td>
                          {job.finishedAt
                            ? new Date(job.finishedAt).toLocaleString()
                            : "—"}
                        </td>
                        <td>
                          <code>
                            {job.error ??
                              (job.summary
                                ? JSON.stringify(job.summary)
                                : "—")}
                          </code>
                        </td>
                      </tr>
                    ))}
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
