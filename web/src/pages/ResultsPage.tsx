import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCleaningResults,
  type CleaningResultsResponse,
} from "../api/client";

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
  const [data, setData] = useState<CleaningResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const result = await fetchCleaningResults({ from, to, page, pageSize });
    setData(result);
  }, [from, to, page]);

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

  const maxBar = useMemo(() => {
    if (!data?.series.length) return 1;
    return Math.max(1, ...data.series.map((s) => s.rooms));
  }, [data]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Резултати по камериер</h1>
          <p>Производителност и навременност за избрания период</p>
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

      {error && <p className="err-text">{error}</p>}
      {loading && !data && <p className="muted">Зареждане…</p>}

      {data && (
        <>
          <div className="results-kpi-grid">
            <div className="stat-card">
              <span className="muted">Брой камериери</span>
              <strong>{data.summary.housekeeperCount}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">Почистени стаи</span>
              <strong>{data.summary.roomsCleaned}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">Навреме</span>
              <strong>{formatPct(data.summary.onTimePct)}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">Производителност</span>
              <strong>
                {formatNum(data.summary.productivity, " ст./ч")}
              </strong>
            </div>
          </div>

          <section className="panel results-chart-panel">
            <div className="panel-header">
              <h2>Стаи / Часове</h2>
            </div>
            {data.summary.roomsCleaned === 0 ? (
              <p className="muted">Няма завършени сесии в периода.</p>
            ) : (
              <div className="results-chart" role="img" aria-label="Rooms completed by hour">
                {data.series.map((point) => {
                  const heightPct = (point.rooms / maxBar) * 100;
                  const label = `${String(point.hour).padStart(2, "0")}:00`;
                  return (
                    <div key={point.hour} className="results-chart-col">
                      <div className="results-chart-bar-wrap">
                        <div
                          className="results-chart-bar"
                          style={{ height: `${heightPct}%` }}
                          title={`${label}: ${point.rooms}`}
                        />
                      </div>
                      <span className="results-chart-label">{label}</span>
                      <span className="results-chart-value">{point.rooms || ""}</span>
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
                    <th>Почистени</th>
                    <th>Навреме</th>
                    <th>Средно мин.</th>
                    <th>Общо мин.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        Няма данни за периода.
                      </td>
                    </tr>
                  ) : (
                    data.rows.map((row) => (
                      <tr key={row.employeeId}>
                        <td>{row.fullName}</td>
                        <td>{row.employeeNumber}</td>
                        <td>{row.roomsCleaned}</td>
                        <td>{formatPct(row.onTimePct)}</td>
                        <td>{formatNum(row.avgMinutes)}</td>
                        <td>{row.totalSessionMinutes}</td>
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
