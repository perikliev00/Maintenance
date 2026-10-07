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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
}

function formatPct(value: number | null): string {
  if (value === null) return "няма данни";
  return `${value.toFixed(1)}%`;
}

function formatNum(value: number | null, suffix = ""): string {
  if (value === null) return "няма данни";
  return `${value}${suffix}`;
}

export function ResultsPage() {
  const today = useMemo(() => isoDate(new Date()), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [serviceTypes, setServiceTypes] = useState<CleaningServiceType[]>([]);
  const [data, setData] = useState<CleaningResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const result = await fetchCleaningResults({
      from,
      to,
      page,
      pageSize,
      serviceType: serviceTypes.length ? serviceTypes : undefined,
    });
    setData(result);
  }, [from, to, page, serviceTypes]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load results");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  function applyPreset(kind: "today" | "7d") {
    if (kind === "today") {
      setFrom(today);
      setTo(today);
    } else {
      setFrom(daysAgo(6));
      setTo(today);
    }
    setPage(1);
  }

  function toggleServiceType(value: CleaningServiceType) {
    setServiceTypes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
    setPage(1);
  }

  const maxBar = useMemo(() => {
    if (!data?.series.length) return 1;
    return Math.max(1, ...data.series.map((s) => s.completedSessions));
  }, [data]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

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

      <div className="toolbar">
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

      <div className="toolbar">
        {SERVICE_TYPE_OPTIONS.map((opt) => {
          const active = serviceTypes.includes(opt.value);
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

      {error && <p className="err-text">{error}</p>}
      {loading && !data && <p className="muted">Зареждане…</p>}

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

          {data.summary.byServiceType.length > 0 && (
            <div className="toolbar">
              {data.summary.byServiceType.map((b) => {
                const label =
                  SERVICE_TYPE_OPTIONS.find((o) => o.value === b.key)?.label ??
                  b.key;
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
            {data.summary.completedSessions === 0 ? (
              <p className="muted">Няма завършени сесии в периода.</p>
            ) : (
              <div
                className="results-chart"
                role="img"
                aria-label="Completed sessions by hour"
              >
                {data.series.map((point) => {
                  const heightPct = (point.completedSessions / maxBar) * 100;
                  const label = `${String(point.hour).padStart(2, "0")}:00`;
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
