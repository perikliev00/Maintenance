/**
 * Analytics dashboard: date-range summary with domain filters and bar/trend charts.
 * Metric deltas compare the selected period to the previous window of equal length.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { LoadingIndicator } from "../components/LoadingIndicator";
import { t, type AppLocale } from "../i18n";

// FE-02 backlog: KPI labels, risk-factor strings, chart titles, and
// CATEGORY/PRIORITY/SERVICE_TYPE fallbacks below stay BG-hardcoded for now.
// AttendancePage chrome/SCOPES similarly still need locale wiring.

/** Format a Date as YYYY-MM-DD (UTC date portion). */
function isoDate(d: Date): string {
  // Return value / early exit.
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD for today minus `n` UTC calendar days. */
function daysAgo(n: number): string {
  const d = new Date();
  // Shift calendar day in UTC so presets stay stable across local TZ.
  d.setUTCDate(d.getUTCDate() - n);
  // Return value / early exit.
  return isoDate(d);
}

/**
 * Display a KPI number, or a Bulgarian "insufficient data" placeholder
 * when the value is null/undefined/non-finite.
 */
function formatMetric(value: number | null | undefined, suffix = ""): string {
  // Backend sends null when sample size is too small for a reliable metric.
  if (value === null || value === undefined || !Number.isFinite(value)) {
    // Return value / early exit.
    return "няма достатъчно данни";
  }
  // Return value / early exit.
  return `${value}${suffix}`;
}

/** Human period stamp: single day or `from – to` range. */
function formatPeriodStamp(fromIso: string, toIso: string): string {
  const f = fromIso.slice(0, 10);
  const t = toIso.slice(0, 10);
  // Collapse same-day ranges to one date label.
  return f === t ? f : `${f} – ${t}`;
}

/**
 * Signed percentage delta vs previous equal-length window, or null when
 * comparison data is missing.
 */
function formatDelta(cmp?: AnalyticsMetricCompare): string | null {
  // No prior window / null deltaPct — hide the badge entirely.
  if (!cmp || cmp.deltaPct === null || cmp.previous === null) return null;
  const sign = cmp.deltaPct > 0 ? "+" : "";
  // Return value / early exit.
  return `${sign}${cmp.deltaPct}%`;
}

/** CSS class for up/down/flat delta coloring. */
function deltaClass(cmp?: AnalyticsMetricCompare): string {
  // Branch: conditional gate.
  if (!cmp || cmp.deltaPct === null) return "analytics-delta muted";
  // Branch: conditional gate.
  if (cmp.deltaPct > 0) return "analytics-delta analytics-delta-up";
  // Branch: conditional gate.
  if (cmp.deltaPct < 0) return "analytics-delta analytics-delta-down";
  // Return value / early exit.
  return "analytics-delta muted";
}

/** Bilingual / lookup table `CATEGORY_LABELS` (data only). */
const CATEGORY_LABELS: Record<string, string> = {
  climate: "Климат",
  electrical: "Ел.",
  furniture: "Мебели",
  plumbing: "ВиК",
  other: "Друго",
};

/** Bilingual / lookup table `PRIORITY_LABELS` (data only). */
const PRIORITY_LABELS: Record<string, string> = {
  low: "Нисък",
  normal: "Нормален",
  high: "Висок",
  urgent: "Спешен",
};

/** Bilingual / lookup table `SERVICE_TYPE_LABELS` (data only). */
const SERVICE_TYPE_LABELS: Record<string, string> = {
  stayover: "Престой",
  departure: "Напускане",
  arrival: "Пристигане",
  common_area: "Обща част",
};

/**
 * Resolve a breakdown key to a display label using live catalog names first,
 * then static fallbacks, then the raw key.
 */
function labelKey(
  key: string,
  kind: "category" | "priority" | "serviceType",
  categoryLabels: Record<string, string>,
): string {
  // Prefer API catalog names (may include inactive categories for history).
  if (kind === "category") {
    // Return value / early exit.
    return categoryLabels[key] ?? CATEGORY_LABELS[key] ?? key;
  }
  // Branch: conditional gate.
  if (kind === "serviceType") {
    // Return value / early exit.
    return SERVICE_TYPE_LABELS[key] ?? key;
  }
  // Return value / early exit.
  return PRIORITY_LABELS[key] ?? key;
}

/** Bulgarian labels for risk-room factor codes from the API. */
function factorLabel(factor: string): string {
  // Prefix match: tickets_gte_N collapses to one "repeat tickets" label.
  if (factor.startsWith("tickets_gte_")) return "Повторяеми тикети";
  // Branch: conditional gate.
  if (factor === "blocking_past_sla") return "Блокиране + SLA";
  // Branch: conditional gate.
  if (factor === "rejected_inspections_gte_2") return "Отхвърлени инспекции";
  // Return value / early exit.
  return factor;
}

/** Danger badge for blocking/reject factors; warn otherwise. */
function factorBadgeClass(factor: string): string {
  // Branch: conditional gate.
  if (factor === "blocking_past_sla" || factor === "rejected_inspections_gte_2") {
    // Return value / early exit.
    return "badge-danger";
  }
  // Return value / early exit.
  return "badge-warn";
}

/** Unit wording for the seasonal forecast panel. */
function forecastUnitLabel(unit: string): string {
  // Branch: conditional gate.
  if (unit === "cleaned_tasks") return "почистени задачи";
  // Return value / early exit.
  return "сигнали";
}

/**
 * Download risk-room rows as a CSV blob via a temporary object URL.
 */
function exportRiskCsv(
  rows: AnalyticsSummary["riskRooms"],
  filename: string,
) {
  const header = ["location", "count", "factors"];
  // JSON.stringify escapes commas/quotes in labels and factor lists.
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        // Serialize request body.
        JSON.stringify(r.label),
        String(r.ticketCount),
        // Serialize request body.
        JSON.stringify(r.factors.map(factorLabel).join("; ")),
      ].join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  // Trigger download without navigating away from the SPA.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Single KPI tile with optional sample size and period-over-period delta.
 */
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
  // Return value / early exit.
  return (
    <div
      className={`stat-card analytics-kpi${
        tone === "warn" ? " analytics-kpi-warn" : ""
      }${tone === "danger" ? " analytics-kpi-danger" : ""}`}
    >
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      <div className="analytics-kpi-meta">
        {/* Render branch: sample && <span className="muted analytics-sample">sample */}
        {sample && <span className="muted analytics-sample">{sample}</span>}
        {/* Delta badge when comparable; em-dash when compare exists but delta is null. */}
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

/**
 * Analytics dashboard page: domain tabs, date presets, KPI grids, charts,
 * seasonal forecast, and risk-room CSV export.
 */
export function AnalyticsPage({ locale = "bg" }: { locale?: AppLocale }) {
  // Stable "today" for presets so re-renders do not shift the range mid-session.
  const today = useMemo(() => isoDate(new Date()), []);
  // Local React state.
  const [domain, setDomain] = useState<AnalyticsDomain>("maintenance");
  // Local React state.
  const [from, setFrom] = useState(daysAgo(29));
  // Local React state.
  const [to, setTo] = useState(today);
  // Local React state.
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  // Local React state.
  const [loading, setLoading] = useState(true);
  // Local React state.
  const [error, setError] = useState<string | null>(null);
  // Local React state.
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>(
    () => ({ ...CATEGORY_LABELS }),
  );

  // Load issue-category names once (include inactive for historical breakdown keys).
  useEffect(() => {
    fetchMaintenanceCategories({ includeInactive: true })
      .then((cats) =>
        // State transition.
        setCategoryLabels(
          Object.fromEntries(cats.map((c) => [c.key, c.nameBg])),
        ),
      )
      .catch(() => undefined);
  }, []);

  /** Fetch summary for the current domain + date range. */
  const requestRevision = useRef(0);
  const refresh = useCallback(async () => {
    const revision = ++requestRevision.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAnalyticsSummary({ domain, from, to });
      if (revision === requestRevision.current) setData(result);
    } catch (err) {
      if (revision === requestRevision.current) {
        setError(err instanceof Error ? err.message : "Failed to load analytics");
        setData(null);
      }
    } finally {
      if (revision === requestRevision.current) setLoading(false);
    }
  }, [domain, from, to]);

  useEffect(() => {
    void refresh();
    return () => { requestRevision.current++; };
  }, [refresh]);

  /** Snap the date range to today / last 7 / last 30 UTC days. */
  function applyPreset(kind: "today" | "7d" | "30d") {
    // State transition.
    setTo(today);
    // Branch: conditional gate.
    if (kind === "today") setFrom(today);
    // Else-if branch.
    else if (kind === "7d") setFrom(daysAgo(6));
    else setFrom(daysAgo(29));
  }

  // Return value / early exit.
  return (
    <main className="content">
      <header className="page-header analytics-header">
        <div>
          <h1>{t(locale, "Умна аналитика", "Smart analytics")}</h1>
          <p>
            {t(
              locale,
              "Сигнали, SLA, одит и сезонна прогноза с проверими определения",
              "Signals, SLA, audit, and seasonal forecast with checkable definitions",
            )}
          </p>
          {/* Server-resolved period may differ slightly from local from/to inputs. */}
          {data && (
            <p className="muted analytics-period-stamp">
              {t(locale, "Период", "Period")}:{" "}
              {formatPeriodStamp(data.period.from, data.period.to)}
            </p>
          )}
        </div>
        <div className="analytics-toolbar">
          <label>
            {t(locale, "От", "From")}
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            {t(locale, "До", "To")}
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button type="button" className="ghost" onClick={() => applyPreset("today")}>
            {t(locale, "Днес", "Today")}
          </button>
          <button type="button" className="ghost" onClick={() => applyPreset("7d")}>
            {t(locale, "7 дни", "7 days")}
          </button>
          <button type="button" className="ghost" onClick={() => applyPreset("30d")}>
            {t(locale, "30 дни", "30 days")}
          </button>
          <button
            type="button"
            className="subtle"
            disabled={loading}
            onClick={() => {
              // Fire-and-forget async call.
              void refresh();
            }}
          >
            {t(locale, "Обнови", "Refresh")}
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
          {t(locale, "Поддръжка", "Maintenance")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={domain === "housekeeping"}
          className={domain === "housekeeping" ? "nav-tab active" : "nav-tab"}
          onClick={() => setDomain("housekeeping")}
        >
          {t(locale, "Камериерска", "Housekeeping")}
        </button>
      </div>

      {/* Render branch: error && <p className="err-text">error</p> */}
      {error && <p className="err-text">{error}</p>}
      {/* Initial load only — keep prior KPIs visible while refreshing. */}
      {loading && !data && (
        <section className="panel">
          <LoadingIndicator
            label={t(locale, "Зареждане на аналитиката…", "Loading analytics…")}
          />
        </section>
      )}

      {/* Guard: response domain must match selected tab (stale race). */}
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
            {/* Duration percentiles hide when sample is insufficient. */}
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

      {/* Housekeeping KPIs — same domain-match guard as maintenance. */}
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
              label="Различни стаи"
              value={formatMetric(data.kpis.distinctRooms)}
            />
            <KpiCard
              label="Готови стаи"
              value={formatMetric(data.kpis.readyRooms)}
            />
            {/* onTimePct is null when no deadline-bearing tasks exist. */}
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
              label="Валидни мин."
              value={formatMetric(data.kpis.totalValidSessionMinutes)}
            />
            <KpiCard
              label="Изключени мин."
              value={formatMetric(data.kpis.totalExcludedSessionMinutes)}
              tone={
                data.kpis.totalExcludedSessionMinutes > 0 ? "warn" : undefined
              }
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
              {/* Empty state when no deadline-bearing tasks in the period. */}
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

      {/* Forecast + risk rooms shared across both domains once data is loaded. */}
      {data && (
        <>
          <section className="panel analytics-forecast">
            <div className="panel-header">
              <h2>Сезонна прогноза</h2>
              <span className="muted">
                {forecastUnitLabel(data.forecast.unit)}
              </span>
            </div>
            {/* Server-provided formula string — keep as-is for auditability. */}
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
                {/* CSV export only when there is at least one risk row. */}
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
