import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAnalyticsSummary,
  fetchMaintenanceCategories,
  type AnalyticsDomain,
  type AnalyticsMetricCompare,
  type AnalyticsSummary,
} from "../api/client";
import {
  AnalyticsBarChart,
  AnalyticsTrendChart,
} from "../components/AnalyticsCharts";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
}

function formatMetric(value: number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "няма достатъчно данни";
  }
  return `${value}${suffix}`;
}

function formatPeriodStamp(fromIso: string, toIso: string): string {
  const f = fromIso.slice(0, 10);
  const t = toIso.slice(0, 10);
  return f === t ? f : `${f} – ${t}`;
}

function formatDelta(cmp?: AnalyticsMetricCompare): string | null {
  if (!cmp || cmp.deltaPct === null || cmp.previous === null) return null;
  const sign = cmp.deltaPct > 0 ? "+" : "";
  return `${sign}${cmp.deltaPct}%`;
}

function deltaClass(cmp?: AnalyticsMetricCompare): string {
  if (!cmp || cmp.deltaPct === null) return "analytics-delta muted";
  if (cmp.deltaPct > 0) return "analytics-delta analytics-delta-up";
  if (cmp.deltaPct < 0) return "analytics-delta analytics-delta-down";
  return "analytics-delta muted";
}

const CATEGORY_LABELS: Record<string, string> = {
  climate: "Климат",
  electrical: "Ел.",
  furniture: "Мебели",
  plumbing: "ВиК",
  other: "Друго",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Нисък",
  normal: "Нормален",
  high: "Висок",
  urgent: "Спешен",
};

const SERVICE_TYPE_LABELS: Record<string, string> = {
  stayover: "Престой",
  departure: "Напускане",
  arrival: "Пристигане",
  common_area: "Обща част",
};

function labelKey(
  key: string,
  kind: "category" | "priority" | "serviceType",
  categoryLabels: Record<string, string>,
): string {
  if (kind === "category") {
    return categoryLabels[key] ?? CATEGORY_LABELS[key] ?? key;
  }
  if (kind === "serviceType") {
    return SERVICE_TYPE_LABELS[key] ?? key;
  }
  return PRIORITY_LABELS[key] ?? key;
}

function factorLabel(factor: string): string {
  if (factor.startsWith("tickets_gte_")) return "Повторяеми тикети";
  if (factor === "blocking_past_sla") return "Блокиране + SLA";
  if (factor === "rejected_inspections_gte_2") return "Отхвърлени инспекции";
  return factor;
}

function factorBadgeClass(factor: string): string {
  if (factor === "blocking_past_sla" || factor === "rejected_inspections_gte_2") {
    return "badge-danger";
  }
  return "badge-warn";
}

function forecastUnitLabel(unit: string): string {
  if (unit === "cleaned_tasks") return "почистени задачи";
  return "сигнали";
}

function exportRiskCsv(
  rows: AnalyticsSummary["riskRooms"],
  filename: string,
) {
  const header = ["location", "count", "factors"];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        JSON.stringify(r.label),
        String(r.ticketCount),
        JSON.stringify(r.factors.map(factorLabel).join("; ")),
      ].join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function KpiCard({
  label,
  value,
  sample,
  compare,
  tone,
}: {
  label: string;
  value: string;
  sample?: string;
  compare?: AnalyticsMetricCompare;
  tone?: "warn" | "danger";
}) {
  const delta = formatDelta(compare);
  return (
    <div
      className={`stat-card analytics-kpi${
        tone === "warn" ? " analytics-kpi-warn" : ""
      }${tone === "danger" ? " analytics-kpi-danger" : ""}`}
    >
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      <div className="analytics-kpi-meta">
        {sample && <span className="muted analytics-sample">{sample}</span>}
        {delta ? (
          <span className={deltaClass(compare)} title="Спрямо предходен период">
            {delta}
          </span>
        ) : compare ? (
          <span className="analytics-delta muted">—</span>
        ) : null}
      </div>
    </div>
  );
}

export function AnalyticsPage() {
  const today = useMemo(() => isoDate(new Date()), []);
  const [domain, setDomain] = useState<AnalyticsDomain>("maintenance");
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today);
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>(
    () => ({ ...CATEGORY_LABELS }),
  );

  useEffect(() => {
    fetchMaintenanceCategories({ includeInactive: true })
      .then((cats) =>
        setCategoryLabels(
          Object.fromEntries(cats.map((c) => [c.key, c.nameBg])),
        ),
      )
      .catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    const result = await fetchAnalyticsSummary({ domain, from, to });
    setData(result);
  }, [domain, from, to]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load analytics",
          );
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

  function applyPreset(kind: "today" | "7d" | "30d") {
    setTo(today);
    if (kind === "today") setFrom(today);
    else if (kind === "7d") setFrom(daysAgo(6));
    else setFrom(daysAgo(29));
  }

  return (
    <main className="content">
      <header className="page-header analytics-header">
        <div>
          <h1>Умна аналитика</h1>
          <p>Сигнали, SLA, одит и сезонна прогноза с проверими определения</p>
          {data && (
            <p className="muted analytics-period-stamp">
              Период: {formatPeriodStamp(data.period.from, data.period.to)}
            </p>
          )}
        </div>
        <div className="analytics-toolbar">
          <label>
            От
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            До
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button type="button" className="ghost" onClick={() => applyPreset("today")}>
            Днес
          </button>
          <button type="button" className="ghost" onClick={() => applyPreset("7d")}>
            7 дни
          </button>
          <button type="button" className="ghost" onClick={() => applyPreset("30d")}>
            30 дни
          </button>
          <button
            type="button"
            className="subtle"
            disabled={loading}
            onClick={() => {
              void refresh();
            }}
          >
            Обнови
          </button>
        </div>
      </header>

      <div className="settings-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={domain === "maintenance"}
          className={domain === "maintenance" ? "nav-tab active" : "nav-tab"}
          onClick={() => setDomain("maintenance")}
        >
          Поддръжка
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={domain === "housekeeping"}
          className={domain === "housekeeping" ? "nav-tab active" : "nav-tab"}
          onClick={() => setDomain("housekeeping")}
        >
          Камериерска
        </button>
      </div>

      {error && <p className="err-text">{error}</p>}
      {loading && !data && (
        <section className="panel">
          <p className="muted">Зареждане на аналитиката…</p>
        </section>
      )}

      {data && data.domain === "maintenance" && domain === "maintenance" && (
        <>
          <div className="results-kpi-grid">
            <KpiCard
              label="Сигнали"
              value={formatMetric(data.kpis.signals)}
              compare={data.comparison.signals}
            />
            <KpiCard
              label="SLA активни"
              value={formatMetric(data.kpis.slaBreaches.active)}
              compare={data.comparison.slaActive}
              tone={
                data.kpis.slaBreaches.active > 0 ? "danger" : undefined
              }
            />
            <KpiCard
              label="SLA приключили"
              value={formatMetric(data.kpis.slaBreaches.closed)}
              tone={data.kpis.slaBreaches.closed > 0 ? "warn" : undefined}
            />
            <KpiCard
              label="Повторно отворени"
              value={formatMetric(data.kpis.reopened)}
              compare={data.comparison.reopened}
              tone={data.kpis.reopened > 0 ? "warn" : undefined}
            />
            <KpiCard
              label="Рискови стаи"
              value={formatMetric(data.kpis.riskRooms)}
              tone={data.kpis.riskRooms > 0 ? "danger" : undefined}
            />
            <KpiCard
              label="P50 / P90 (мин)"
              value={
                data.kpis.insufficientDurationData
                  ? "няма достатъчно данни"
                  : `${formatMetric(data.kpis.p50ResolveMinutes)} / ${formatMetric(data.kpis.p90ResolveMinutes)}`
              }
              sample={
                data.kpis.durationSampleCount > 0
                  ? `n=${data.kpis.durationSampleCount}${
                      data.kpis.avgResolveMinutes != null
                        ? ` · ср. ${data.kpis.avgResolveMinutes}`
                        : ""
                    }`
                  : undefined
              }
            />
          </div>

          <AnalyticsTrendChart series={data.series} />

          <div className="analytics-grid">
            <AnalyticsBarChart
              title="По категории"
              items={(data.breakdowns.byCategory ?? []).map((i) => ({
                key: labelKey(i.key, "category", categoryLabels),
                count: i.count,
              }))}
            />
            <AnalyticsBarChart
              title="По приоритет"
              items={(data.breakdowns.byPriority ?? []).map((i) => ({
                key: labelKey(i.key, "priority", categoryLabels),
                count: i.count,
              }))}
            />
          </div>
        </>
      )}

      {data && data.domain === "housekeeping" && domain === "housekeeping" && (
        <>
          <div className="results-kpi-grid">
            <KpiCard
              label="Приключени задачи"
              value={formatMetric(data.kpis.cleanedTasks)}
              compare={data.comparison.cleanedTasks}
            />
            <KpiCard
              label="Приети задачи"
              value={formatMetric(data.kpis.acceptedTasks)}
              compare={data.comparison.acceptedTasks}
            />
            <KpiCard
              label="Завършени сесии"
              value={formatMetric(data.kpis.completedSessions)}
            />
            <KpiCard
              label="Повторна работа"
              value={formatMetric(data.kpis.reworkEvents)}
              compare={data.comparison.reworkEvents}
              tone={data.kpis.reworkEvents > 0 ? "warn" : undefined}
            />
            <KpiCard
              label="Аномални сесии"
              value={formatMetric(data.kpis.anomalousSessions)}
              tone={data.kpis.anomalousSessions > 0 ? "warn" : undefined}
            />
            <KpiCard
              label="Готови стаи"
              value={formatMetric(data.kpis.readyRooms)}
            />
            <KpiCard
              label="Навреме %"
              value={
                data.kpis.onTimePct === null
                  ? "няма достатъчно данни"
                  : formatMetric(data.kpis.onTimePct, "%")
              }
              sample={
                data.kpis.onTimeSampleCount > 0
                  ? `n=${data.kpis.onTimeSampleCount}`
                  : undefined
              }
              compare={data.comparison.onTimePct}
            />
            <KpiCard
              label="Одит находки"
              value={formatMetric(data.kpis.auditFindings)}
              compare={data.comparison.auditFindings}
              tone={data.kpis.auditFindings > 0 ? "warn" : undefined}
            />
            <KpiCard
              label="Средно валидни мин/задача"
              value={
                data.kpis.insufficientDurationData
                  ? "няма достатъчно данни"
                  : formatMetric(data.kpis.avgMinutesPerTask)
              }
              sample={
                data.kpis.durationSampleCount > 0
                  ? `n=${data.kpis.durationSampleCount}`
                  : undefined
              }
            />
            <KpiCard
              label="P50 / P90 (валидни мин)"
              value={
                data.kpis.insufficientDurationData
                  ? "няма достатъчно данни"
                  : `${formatMetric(data.kpis.p50SessionMinutes)} / ${formatMetric(data.kpis.p90SessionMinutes)}`
              }
              sample={
                data.kpis.durationSampleCount > 0
                  ? `n=${data.kpis.durationSampleCount}`
                  : undefined
              }
            />
          </div>

          <AnalyticsTrendChart series={data.series} />

          <div className="analytics-grid">
            <AnalyticsBarChart
              title="По тип работа"
              items={(data.breakdowns.byServiceType ?? []).map((i) => ({
                key: labelKey(i.key, "serviceType", categoryLabels),
                count: i.count,
              }))}
            />
            <AnalyticsBarChart
              title="По приоритет"
              items={(data.breakdowns.byPriority ?? []).map((i) => ({
                key: labelKey(i.key, "priority", categoryLabels),
                count: i.count,
              }))}
            />
            <section className="panel analytics-chart-panel">
              <div className="panel-header">
                <h2>Навременност</h2>
                <span className="muted">
                  n={data.kpis.onTimeSampleCount}
                </span>
              </div>
              {data.kpis.onTimePct === null ? (
                <p className="muted">Няма задачи с известен срок в периода.</p>
              ) : (
                <div className="analytics-ontime">
                  <div className="analytics-ontime-head">
                    <strong>{formatMetric(data.kpis.onTimePct, "%")}</strong>
                    <span className="muted">
                      от {data.kpis.onTimeSampleCount} задачичи със срок
                    </span>
                  </div>
                  <div className="analytics-ontime-bar">
                    <div
                      className="analytics-ontime-fill"
                      style={{ width: `${Math.min(100, data.kpis.onTimePct)}%` }}
                    />
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {data && (
        <>
          <section className="panel analytics-forecast">
            <div className="panel-header">
              <h2>Сезонна прогноза</h2>
              <span className="muted">
                {forecastUnitLabel(data.forecast.unit)}
              </span>
            </div>
            <div className="owner-banner analytics-forecast-formula">
              {data.forecast.formula}
            </div>
            <div className="results-kpi-grid">
              <div className="stat-card">
                <span className="muted">Дневна средна</span>
                <strong>{formatMetric(data.forecast.dailyRate)}</strong>
              </div>
              <div className="stat-card">
                <span className="muted">Оставащи дни</span>
                <strong>{data.forecast.remainingDaysInMonth}</strong>
              </div>
              <div className="stat-card">
                <span className="muted">
                  Прогноза ({forecastUnitLabel(data.forecast.unit)})
                </span>
                <strong>{formatMetric(data.forecast.predicted)}</strong>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Рискови стаи</h2>
              <div className="analytics-risk-actions">
                <span className="muted">{data.riskRooms.length}</span>
                {data.riskRooms.length > 0 && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      exportRiskCsv(
                        data.riskRooms,
                        `risk-rooms-${domain}-${from}_${to}.csv`,
                      )
                    }
                  >
                    Експорт CSV
                  </button>
                )}
              </div>
            </div>
            {data.riskRooms.length === 0 ? (
              <p className="muted">Няма рискови стаи за периода.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Помещение</th>
                      <th>Брой</th>
                      <th>Фактори</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.riskRooms.map((r) => (
                      <tr key={r.locationId}>
                        <td>{r.label}</td>
                        <td>{r.ticketCount}</td>
                        <td>
                          <div className="analytics-factors">
                            {r.factors.map((f) => (
                              <span
                                key={f}
                                className={`pill ${factorBadgeClass(f)}`}
                              >
                                {factorLabel(f)}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
