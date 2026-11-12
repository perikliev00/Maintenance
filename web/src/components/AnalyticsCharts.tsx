/**
 * Lightweight SVG analytics charts (horizontal bars + daily trend area).
 * No chart library — paths are built locally for a small dependency footprint.
 */
import { useId, useMemo, useState } from "react";
import type { AnalyticsSeriesPoint } from "../api/client";

const VB_W = 640;
const VB_H = 220;
const PAD = { top: 18, right: 16, bottom: 32, left: 40 };

/**
 * Catmull-Rom–style cubic SVG path through the given points.
 * Single point becomes a move-only path; empty input returns "".
 */
function buildSmoothPath(points: Array<{ x: number; y: number }>): string {
  // Nothing to draw.
  if (points.length === 0) return "";
  // Degenerate: a single move command (no curve segments).
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  // Build cubic segments between consecutive samples.
  for (let i = 0; i < points.length - 1; i++) {
    // Neighbor samples for control-point estimation (clamp at ends).
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * Horizontal bar breakdown chart.
 * Zero counts get zero width; non-zero bars keep a small minimum for visibility.
 */
export function AnalyticsBarChart({
  items,
  title,
  countLabel,
}: {
  items: Array<{ key: string; count: number }>;
  title: string;
  countLabel?: string;
}) {
  // Floor max at 1 so empty datasets do not divide by zero.
  const max = Math.max(1, ...items.map((i) => i.count));
  const total = items.reduce((s, i) => s + i.count, 0);

  return (
    // Render JSX element.
    <section className="panel analytics-chart-panel">
            <div className="panel-header">
                <h2>{title}</h2>
                <span className="muted">
                    {countLabel ?? `${items.length} · общо ${total}`}
                </span>
            </div>
            {/* Empty period vs horizontal bar rows. */}
            {items.length === 0 ? (
        // Render JSX element.
        <p className="muted">Няма данни за периода.</p>
      // Invoke helper or pass arguments.
      ) : (
        // Render JSX element.
        <div className="analytics-hchart" role="img" aria-label={title}>
                    {items.map((item, idx) => {
            // Const arrow/function binding.
            const pctOfMax = (item.count / max) * 100;
            // Minimum 6% width for non-zero bars so tiny counts stay visible.
            const widthPct = Math.max(item.count === 0 ? 0 : 6, pctOfMax);
            const share =
              total > 0 ? Math.round((item.count / total) * 100) : 0;
            // Highlight the busiest category (ties all get is-top).
            const isTop = item.count === max && item.count > 0;
            return (
              // Render JSX element.
              <div
                key={item.key}
                className={`analytics-hchart-row${isTop ? " is-top" : ""}`}
              >
                                <span className="analytics-hchart-label" title={item.key}>
                                    {item.key}
                                </span>
                                <div className="analytics-hchart-track">
                                    <div
                    className="analytics-hchart-bar"
                    style={{
                      width: `${widthPct}%`,
                      animationDelay: `${idx * 45}ms`,
                    }}
                  />
                                </div>
                                <div className="analytics-hchart-meta">
                                    <span className="analytics-hchart-value">{item.count}</span>
                                    {/* Share % omitted when the whole chart totals zero. */}
                                    {total > 0 && (
                    // Render JSX element.
                    <span className="muted analytics-hchart-share">{share}%</span>
                  )}
                                </div>
                            </div>
            );
          })}
                </div>
      )}
        </section>
  );
}

/**
 * Daily count trend SVG with hover guide.
 * Hit-rects are wide so sparse days stay easy to target.
 */
export function AnalyticsTrendChart({
  series,
}: {
  series: AnalyticsSeriesPoint[];
}) {
  // Sanitize useId for SVG fragment URLs (colons break some browsers).
  const gradId = useId().replace(/:/g, "");
  // Index of the hovered day, or null when the pointer left the chart.
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const max = Math.max(1, ...series.map((s) => s.count));
  const total = series.reduce((s, p) => s + p.count, 0);
  // Peak day used for the header callout.
  const peak = useMemo(
    () =>
      series.reduce(
        (best, p) => (p.count > best.count ? p : best),
        series[0] ?? { date: "", count: 0 },
      ),
    [series],
  );

  // Project series into viewBox coordinates + smooth path strings.
  const plot = useMemo(() => {
    const innerW = VB_W - PAD.left - PAD.right;
    const innerH = VB_H - PAD.top - PAD.bottom;
    const n = series.length;
    const coords = series.map((p, i) => {
      // Center a single point; otherwise space evenly across the inner width.
      const x =
        n <= 1 ? PAD.left + innerW / 2 : PAD.left + (i / (n - 1)) * innerW;
      const y = PAD.top + innerH * (1 - p.count / max);
      return { x, y, ...p };
    });
    const line = buildSmoothPath(coords.map(({ x, y }) => ({ x, y })));
    // Close the line down to the baseline for the filled area.
    const area =
      coords.length === 0
        // Continue module logic.
        ? ""
        // Continue module logic.
        : `${line} L ${coords[coords.length - 1].x} ${PAD.top + innerH} L ${coords[0].x} ${PAD.top + innerH} Z`;
    const yTicks = [max, Math.round(max / 2), 0];
    // Thin out x-axis labels on dense series (~6 labels).
    const labelEvery = Math.max(1, Math.ceil(n / 6));
    return { coords, line, area, yTicks, innerH, labelEvery };
  }, [series, max]);

  const hover = hoverIndex !== null ? plot.coords[hoverIndex] : null;
  const allZero = series.every((s) => s.count === 0);

  return (
    // Render JSX element.
    <section className="panel analytics-chart-panel">
            <div className="panel-header">
                <h2>Тренд</h2>
                <span className="muted">
                    {series.length} дни · общо {total}
                    {/* Peak callout only when there is a non-zero max day. */}
                    {peak.count > 0 ? ` · връх ${peak.count}` : ""}
                </span>
            </div>
            {/* Empty / all-zero / chart branches. */}
            {series.length === 0 ? (
        // Render JSX element.
        <p className="muted">Няма данни за периода.</p>
      // Invoke helper or pass arguments.
      ) : allZero ? (
        // Render JSX element.
        <p className="muted">Няма движения в избрания период.</p>
      // Invoke helper or pass arguments.
      ) : (
        // Render JSX element.
        <div
          className="analytics-area-chart"
          onMouseLeave={() => setHoverIndex(null)}
        >
                    <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            role="img"
            aria-label="Дневен тренд"
            preserveAspectRatio="xMidYMid meet"
          >
                        <defs>
                            <linearGradient id={`fill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
                                <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
                            </linearGradient>
                            <filter
                id={`soft-${gradId}`}
                x="-20%"
                y="-20%"
                width="140%"
                height="140%"
              >
                                <feDropShadow
                  dx="0"
                  dy="2"
                  stdDeviation="2.5"
                  floodColor="#14b8a6"
                  floodOpacity="0.28"
                />
                            </filter>
                        </defs>

                        {/* Horizontal grid + y-axis tick labels. */}
                        {plot.yTicks.map((tick, i) => {
              const y =
                // Continue module logic.
                PAD.top +
                (plot.innerH * i) / Math.max(1, plot.yTicks.length - 1);
              return (
                // Render JSX element.
                <g key={`yt-${tick}-${i}`}>
                                    <line
                    className="analytics-area-grid"
                    x1={PAD.left}
                    x2={VB_W - PAD.right}
                    y1={y}
                    y2={y}
                  />
                                    <text
                    className="analytics-area-axis"
                    x={PAD.left - 8}
                    y={y + 3}
                    textAnchor="end"
                  >
                                        {tick}
                                    </text>
                                </g>
              );
            })}

                        <path
              className="analytics-area-fill"
              d={plot.area}
              fill={`url(#fill-${gradId})`}
            />
                        <path
              className="analytics-area-line"
              d={plot.line}
              filter={`url(#soft-${gradId})`}
            />

                        {hover && (
              // Continue module logic.
              <>
                                <line
                  className="analytics-guide"
                  x1={hover.x}
                  x2={hover.x}
                  y1={PAD.top}
                  y2={PAD.top + plot.innerH}
                />
                                <circle
                  className="analytics-point"
                  cx={hover.x}
                  cy={hover.y}
                  r={5}
                />
                            </>
            )}

                        {plot.coords.map((p, i) => {
              const showLabel =
                i === 0 ||
                i === plot.coords.length - 1 ||
                i % plot.labelEvery === 0;
              return (
                // Render JSX element.
                <g key={p.date}>
                                    {/* Date label only on first/last/every Nth day. */}
                                    {showLabel && (
                    // Render JSX element.
                    <text
                      className="analytics-area-axis"
                      x={p.x}
                      y={VB_H - 10}
                      textAnchor="middle"
                    >
                                            {p.date.slice(5)}
                                        </text>
                  )}
                                    <rect
                    className="analytics-hit"
                    x={p.x - Math.max(8, VB_W / series.length / 2)}
                    y={PAD.top}
                    width={Math.max(16, VB_W / series.length)}
                    height={plot.innerH}
                    onMouseEnter={() => setHoverIndex(i)}
                    onFocus={() => setHoverIndex(i)}
                  />
                                </g>
              );
            })}
                    </svg>

                    {hover && (
            // Render JSX element.
            <div
              className="analytics-tooltip"
              style={{
                left: `${(hover.x / VB_W) * 100}%`,
                top: `${(hover.y / VB_H) * 100}%`,
              }}
            >
                            <strong>{hover.count}</strong>
                            <span>{hover.date}</span>
                        </div>
          )}
                </div>
      )}
        </section>
  );
}
