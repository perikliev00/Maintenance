/**
 * Cleaning results report: date range, service-type filters, and paginated rows.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCleaningResults,
  type CleaningResultsResponse,
  type CleaningServiceType,
} from "../api/client";

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
  // Branch: conditional gate.
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
  const refresh = useCallback(async () => {
    // State transition.
    setError(null);
    // Omit serviceType when none selected so the API returns all types.
    const result = await fetchCleaningResults({
      from,
      to,
      page,
      pageSize,
      serviceType: serviceTypes.length ? serviceTypes : undefined,
    });
    // State transition.
    setData(result);
  }, [from, to, page, serviceTypes]);

  // Re-fetch when filters/page change; ignore late responses after unmount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Try block for fallible work.
      try {
        // State transition.
        setLoading(true);
        // Await async step.
        await refresh();
      } catch (err) {
        // Only apply error/empty state if this effect is still current.
        if (!cancelled) {
          // State transition.
          setError(err instanceof Error ? err.message : "Failed to load results");
          // State transition.
          setData(null);
        }
      } finally {
        // Branch: conditional gate.
        if (!cancelled) setLoading(false);
      }
    })();
    // Early / value return.
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  /**
   * Snap the date range to today or last 7 days and reset pagination.
   */
  function applyPreset(kind: "today" | "7d") {
    // Branch: conditional gate.
    if (kind === "today") {
      // State transition.
      setFrom(today);
      // State transition.
      setTo(today);
    } else {
      // Inclusive 7-day window ending today (today + 6 prior UTC days).
      setFrom(daysAgo(6));
      // State transition.
      setTo(today);
    }
    // Filters change → return to the first page of rows.
    setPage(1);
  }

  /**
   * Toggle a service-type chip and reset to page 1.
   */
  function toggleServiceType(value: CleaningServiceType) {
    // State transition.
    setServiceTypes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
    // State transition.
    setPage(1);
  }

  // Scale factor for the sparkline bars (floor at 1 to avoid divide-by-zero).
  const maxBar = useMemo(() => {
    // Branch: conditional gate.
    if (!data?.series.length) return 1;
    // Early / value return.
    return Math.max(1, ...data.series.map((s) => s.completedSessions));
  }, [data]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  // Early / value return.
  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Резултати по камериер</h1>
          <p>
            Камериери с ≥1 завършена сесия; задачи, приети и сесии са отделни
            броячи
          </p>
        </div>
      </header>

      {/* Date range + quick presets. */}
      <div className="toolbar">
        <label>
          От
          <input
            type="date"
            value={from}
            onChange={(e) => {
              // State transition.
              setFrom(e.target.value);
              // State transition.
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
              // State transition.
              setTo(e.target.value);
              // State transition.
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
      <div className="toolbar">
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
        // Clear chips → all types (API omits serviceType).
        {serviceTypes.length > 0 && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              // State transition.
              setServiceTypes([]);
              // State transition.
              setPage(1);
            }}
          >
            Всички типове
          </button>
        )}
      </div>

      // Render branch: error && <p className="err-text">error</p>
      {error && <p className="err-text">{error}</p>}
      // Initial load placeholder when we have no prior data to show.
      {loading && !data && <p className="muted">Зареждане…</p>}

      // KPI / chart / table only after a successful fetch.
      {data && (
        <>
          <div className="results-kpi-grid">
            <div className="stat-card">
              <span className="muted">Камериери с работа</span>
              <strong>{data.summary.housekeeperCount}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">Приключени задачи</span>
              <strong>{data.summary.completedTasks}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">Приети</span>
              <strong>{data.summary.acceptedTasks}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">Сесии</span>
              <strong>{data.summary.completedSessions}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">Повторна работа</span>
              <strong>{data.summary.reworkEvents}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">Аномални сесии</span>
              <strong>{data.summary.anomalousSessions}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">Различни стаи</span>
              <strong>{data.summary.distinctRooms}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">Валидни мин.</span>
              <strong>
                {formatNum(data.summary.totalValidSessionMinutes)}
              </strong>
            </div>
            <div className="stat-card">
              <span className="muted">Изключени мин.</span>
              <strong>
                {formatNum(data.summary.totalExcludedSessionMinutes)}
              </strong>
            </div>
            <div className="stat-card">
              <span className="muted">Навреме</span>
              <strong>{formatPct(data.summary.onTimePct)}</strong>
            </div>
            <div className="stat-card">
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

          <section className="panel results-chart-panel">
            <div className="panel-header">
              <h2>Сесии / Часове</h2>
            </div>
            // Empty chart vs hourly bar series.
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
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>По камериер</h2>
              <span className="muted">
                {data.total} общо · стр. {data.page}/{totalPages}
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Име</th>
                    <th>Номер</th>
                    <th>Задачи</th>
                    <th>Приети</th>
                    <th>Сесии</th>
                    <th>Rework</th>
                    <th>Аномалии</th>
                    <th>Навреме</th>
                    <th>Ср. валидни мин.</th>
                    <th>Валидни мин.</th>
                    <th>Изключени мин.</th>
                  </tr>
                </thead>
                <tbody>
                  // Empty period vs housekeeper rows.
                  {data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="muted">
                        Няма данни за периода.
                      </td>
                    </tr>
                  ) : (
                    data.rows.map((row) => (
                      <tr key={row.employeeId}>
                        <td>{row.fullName}</td>
                        <td>{row.employeeNumber}</td>
                        <td>{row.completedTasks}</td>
                        <td>{row.acceptedTasks}</td>
                        <td>{row.completedSessions}</td>
                        <td>{row.reworkEvents}</td>
                        <td>{row.anomalousSessions}</td>
                        <td>{formatPct(row.onTimePct)}</td>
                        <td>{formatNum(row.avgValidMinutes)}</td>
                        <td>{row.totalValidSessionMinutes}</td>
                        <td>{row.totalExcludedSessionMinutes}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            // Pager only when total exceeds one page.
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
    </main>
  );
}
