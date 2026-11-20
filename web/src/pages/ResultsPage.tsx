/**
 * Cleaning results report: date range, service-type filters, and paginated rows.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCleaningResults,
  type CleaningResultsResponse,
  type CleaningServiceType,
} from "../api/client";
import { LoadingIndicator } from "../components/LoadingIndicator";

const SERVICE_TYPE_OPTIONS: Array<{
  value: CleaningServiceType;
  label: string;
}> = [
  { value: "stayover", label: "Престой" },
  { value: "departure", label: "Напускане" },
  { value: "arrival", label: "Пристигане" },
  { value: "common_area", label: "Обща част" },
];

/**
 * Format a Date as YYYY-MM-DD (UTC date portion).
 */
function isoDate(d: Date): string {
  // Early / value return.
  return d.toISOString().slice(0, 10);
}

/**
 * YYYY-MM-DD for today minus `n` UTC calendar days.
 */
function daysAgo(n: number): string {
  const d = new Date();
  // Mutate a copy's UTC day so presets stay timezone-stable.
  d.setUTCDate(d.getUTCDate() - n);
  // Early / value return.
  return isoDate(d);
}

/**
 * Percentage with one decimal, or a Bulgarian "no data" placeholder.
 */
function formatPct(value: number | null): string {
  // Null means the API could not compute a rate for the period.
  if (value === null) return "няма данни";
  // Early / value return.
  return `${value.toFixed(1)}%`;
}

/**
 * Number with optional suffix, or a Bulgarian "no data" placeholder.
 */
function formatNum(value: number | null, suffix = ""): string {
  if (value === null) return "няма данни";
  // Early / value return.
  return `${value}${suffix}`;
}

/**
 * Cleaning results report page: date range, service-type filters, KPIs, and pagination.
 */
export function ResultsPage() {
  // Stable "today" so presets do not drift mid-session.
  const today = useMemo(() => isoDate(new Date()), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  // Empty selection means "all service types" on the API.
  const [serviceTypes, setServiceTypes] = useState<CleaningServiceType[]>([]);
  const [data, setData] = useState<CleaningResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch paginated results for the current filters.
   */
  const requestRevision = useRef(0);
  const refresh = useCallback(async () => {
    const revision = ++requestRevision.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCleaningResults({
        from, to, page, pageSize,
        serviceType: serviceTypes.length ? serviceTypes : undefined,
      });
      if (revision === requestRevision.current) setData(result);
    } catch (err) {
      if (revision === requestRevision.current) {
        setError(err instanceof Error ? err.message : "Failed to load results");
        setData(null);
      }
    } finally {
      if (revision === requestRevision.current) setLoading(false);
    }
  }, [from, to, page, serviceTypes]);

  useEffect(() => {
    void refresh();
    return () => { requestRevision.current++; };
  }, [refresh]);

  /**
   * Snap the date range to today or last 7 days and reset pagination.
   */
  function applyPreset(kind: "today" | "7d") {
    if (kind === "today") {
      setFrom(today);
      setTo(today);
    } else {
      // Inclusive 7-day window ending today (today + 6 prior UTC days).
      setFrom(daysAgo(6));
      setTo(today);
    }
    // Filters change → return to the first page of rows.
    setPage(1);
  }

  /**
   * Toggle a service-type chip and reset to page 1.
   */
  function toggleServiceType(value: CleaningServiceType) {
    setServiceTypes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
    setPage(1);
  }

  // Scale factor for the sparkline bars (floor at 1 to avoid divide-by-zero).
  const maxBar = useMemo(() => {
    if (!data?.series.length) return 1;
    // Early / value return.
    return Math.max(1, ...data.series.map((s) => s.completedSessions));
  }, [data]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  // Early / value return.
  return (
    <main className="content ui-results-report">
      <header className="page-header ui-briefing">
        <div>
          <p className="ui-eyebrow">ИЗПЪЛНЕНИЕ НА ЕКИПА</p><h1>Резултати по камериер</h1>
          <p>
            Камериери с ≥1 завършена сесия; задачи, приети и сесии са отделни
            броячи
          </p>
        </div>
      </header>

      <div className="ui-report-layout">
        <aside className="ui-report-criteria ui-surface" aria-label="Критерии за отчета"><div className="ui-section-heading"><h2>Обхват на отчета</h2><p className="muted">Период и вид услуга</p></div>
      {/* Date range + quick presets. */}
      <div className="ui-form-stack">
        <label>
          От
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          До
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <button type="button" className="ghost" onClick={() => applyPreset("today")}>
          Днес
        </button>
        <button type="button" className="ghost" onClick={() => applyPreset("7d")}>
          7 дни
        </button>
      </div>

      {/* Service-type filter chips (multi-select). */}
      <div className="ui-filter-options">
        {SERVICE_TYPE_OPTIONS.map((opt) => {
          const active = serviceTypes.includes(opt.value);
          // Early / value return.
          return (
            <button
              key={opt.value}
              type="button"
              className={active ? "" : "ghost"}
              aria-pressed={active}
              onClick={() => toggleServiceType(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
        {serviceTypes.length > 0 && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setServiceTypes([]);
              setPage(1);
            }}
          >
            Всички типове
          </button>
        )}
      </div>

        </aside>
        <div className="ui-report-canvas">
      {error && <p className="err-text" role="alert">{error}</p>}
      {loading && !data && <LoadingIndicator label="Зареждане…" />}

      {data && (
        <>
          <div className="ui-metrics ui-report-measures">
            <div className="ui-metric">
              <span className="muted">Камериери с работа</span>
              <strong>{data.summary.housekeeperCount}</strong>
            </div>
            <div className="ui-metric">
              <span className="muted">Приключени задачи</span>
              <strong>{data.summary.completedTasks}</strong>
            </div>
            <div className="ui-metric">
              <span className="muted">Приети</span>
              <strong>{data.summary.acceptedTasks}</strong>
            </div>
            <div className="ui-metric">
              <span className="muted">Сесии</span>
              <strong>{data.summary.completedSessions}</strong>
            </div>
            <div className="ui-metric">
              <span className="muted">Повторна работа</span>
              <strong>{data.summary.reworkEvents}</strong>
            </div>
            <div className="ui-metric">
              <span className="muted">Аномални сесии</span>
              <strong>{data.summary.anomalousSessions}</strong>
            </div>
            <div className="ui-metric">
              <span className="muted">Различни стаи</span>
              <strong>{data.summary.distinctRooms}</strong>
            </div>
            <div className="ui-metric">
              <span className="muted">Валидни мин.</span>
              <strong>
                {formatNum(data.summary.totalValidSessionMinutes)}
              </strong>
            </div>
            <div className="ui-metric">
              <span className="muted">Изключени мин.</span>
              <strong>
                {formatNum(data.summary.totalExcludedSessionMinutes)}
              </strong>
            </div>
            <div className="ui-metric">
              <span className="muted">Навреме</span>
              <strong>{formatPct(data.summary.onTimePct)}</strong>
            </div>
            <div className="ui-metric">
              <span className="muted">Производителност</span>
              <strong>
                {formatNum(data.summary.productivity, " зад./ч")}
              </strong>
            </div>
          </div>

          {/* Per-service-type breakdown chips when the API returns buckets. */}
          {data.summary.byServiceType.length > 0 && (
            <div className="toolbar">
              {data.summary.byServiceType.map((b) => {
                const label =
                  SERVICE_TYPE_OPTIONS.find((o) => o.value === b.key)?.label ??
                  b.key;
                // Early / value return.
                return (
                  <span key={b.key} className="muted">
                    {label}: {b.count}
                  </span>
                );
              })}
            </div>
          )}

          <section className="ui-surface results-chart-panel">
            <div className="ui-section-heading ui-action-strip">
              <h2>Сесии / Часове</h2>
            </div>
            {data.summary.completedSessions === 0 ? (
              <p className="muted">Няма завършени сесии в периода.</p>
            ) : (
              <div
                className="results-chart"
                role="img"
                aria-label="Completed sessions by hour"
              >
                {data.series.map((point) => {
                  // Normalize bar height against the busiest hour.
                  const heightPct = (point.completedSessions / maxBar) * 100;
                  const label = `${String(point.hour).padStart(2, "0")}:00`;
                  // Early / value return.
                  return (
                    <div key={point.hour} className="results-chart-col">
                      <div className="results-chart-bar-wrap">
                        <div
                          className="results-chart-bar"
                          style={{ height: `${heightPct}%` }}
                          title={`${label}: ${point.completedSessions}`}
                        />
                      </div>
                      <span className="results-chart-label">{label}</span>
                      <span className="results-chart-value">
                        {point.completedSessions || ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {data.summary.completedSessions > 0 && <details className="ui-chart-data">
              <summary>Данни по часове</summary>
              <div className="table-wrap"><table><caption className="sr-only">Завършени сесии по часове</caption>
                <thead><tr><th scope="col">Час</th><th scope="col">Завършени сесии</th></tr></thead>
                <tbody>{data.series.map(point => <tr key={point.hour}><th scope="row">{String(point.hour).padStart(2, "0")}:00</th><td>{point.completedSessions}</td></tr>)}</tbody>
              </table></div>
            </details>}
          </section>

          <section className="ui-surface">
            <div className="ui-section-heading ui-action-strip">
              <h2>По камериер</h2>
              <span className="muted">
                {data.total} общо · стр. {data.page}/{totalPages}
              </span>
            </div>
            {data.rows.length === 0 ? <p className="ui-empty muted">Няма данни за периода.</p> : <div className="ui-performance-list">
              {data.rows.map((row) => <article key={row.employeeId} className="ui-performance-row">
                <header><h3>{row.fullName}</h3><span className="muted">{row.employeeNumber}</span></header>
                <dl className="ui-performance-measures">
                  <div><dt>Задачи</dt><dd>{row.completedTasks}</dd></div><div><dt>Приети</dt><dd>{row.acceptedTasks}</dd></div><div><dt>Сесии</dt><dd>{row.completedSessions}</dd></div><div><dt>Rework</dt><dd>{row.reworkEvents}</dd></div><div><dt>Аномалии</dt><dd>{row.anomalousSessions}</dd></div><div><dt>Навреме</dt><dd>{formatPct(row.onTimePct)}</dd></div><div><dt>Ср. валидни мин.</dt><dd>{formatNum(row.avgValidMinutes)}</dd></div><div><dt>Валидни мин.</dt><dd>{row.totalValidSessionMinutes}</dd></div><div><dt>Изключени мин.</dt><dd>{row.totalExcludedSessionMinutes}</dd></div>
                </dl>
              </article>)}
            </div>}
            {data.total > pageSize && (
              <div className="toolbar results-pager">
                <button
                  type="button"
                  className="ghost"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Предишна
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Следваща
                </button>
              </div>
            )}
          </section>
        </>
      )}
        </div>
      </div>
    </main>
  );
}
