/**
 * Lightweight SVG analytics charts (horizontal bars + daily trend area).
 * No chart library — paths are built locally for a small dependency footprint.
 */
import { useId, useMemo, useState } from "react";
// Import dependency used by this module.
import type { AnalyticsSeriesPoint } from "../api/client";

// Local constant binding.
const VB_W = 640;
// Local constant binding.
const VB_H = 220;
// Local constant binding.
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
    // Local constant binding.
    const p = points[0];
    // Return computed result to caller.
    return `M ${p.x} ${p.y}`;
  }
  // Mutable local binding.
  let d = `M ${points[0].x} ${points[0].y}`;
  // Build cubic segments between consecutive samples.
  for (let i = 0; i < points.length - 1; i++) {
    // Neighbor samples for control-point estimation (clamp at ends).
    const p0 = points[i === 0 ? i : i - 1];
    // Local constant binding.
    const p1 = points[i];
    // Local constant binding.
    const p2 = points[i + 1];
    // Local constant binding.
    const p3 = points[i + 2] ?? p2;
    // Local constant binding.
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    // Local constant binding.
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    // Local constant binding.
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    // Local constant binding.
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    // Assign value for subsequent use.
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  // Return computed result to caller.
  return d;
}

/**
 * Horizontal bar breakdown chart.
 * Zero counts get zero width; non-zero bars keep a small minimum for visibility.
 */
export function AnalyticsBarChart({
  // List item in import/export/params.
  items,
  // List item in import/export/params.
  title,
  // List item in import/export/params.
  countLabel,
// Open multi-line construct.
}: {
  // Field/property in this shape.
  items: Array<{ key: string; count: number }>;
  // Field/property in this shape.
  title: string;
  // Field/property in this shape.
  countLabel?: string;
// Open multi-line construct.
}) {
  // Floor max at 1 so empty datasets do not divide by zero.
  const max = Math.max(1, ...items.map((i) => i.count));
  // Local constant binding.
  const total = items.reduce((s, i) => s + i.count, 0);

  // Return computed result to caller.
  return (
    // Render JSX element.
    <section className="panel analytics-chart-panel">
      // Render JSX element.
      <div className="panel-header">
        // Render JSX element.
        <h2>{title}</h2>
        // Render JSX element.
        <span className="muted">
          // JSX expression container.
          {countLabel ?? `${items.length} · общо ${total}`}
        // JSX element boundary.
        </span>
      // JSX element boundary.
      </div>
      // JSX block comment.
      {/* Empty period vs horizontal bar rows. */}
      // JSX expression container.
      {items.length === 0 ? (
        // Render JSX element.
        <p className="muted">Няма данни за периода.</p>
      // Invoke helper or pass arguments.
      ) : (
        // Render JSX element.
        <div className="analytics-hchart" role="img" aria-label={title}>
          // JSX expression container.
          {items.map((item, idx) => {
            // Const arrow/function binding.
            const pctOfMax = (item.count / max) * 100;
            // Minimum 6% width for non-zero bars so tiny counts stay visible.
            const widthPct = Math.max(item.count === 0 ? 0 : 6, pctOfMax);
            // Local constant binding.
            const share =
              // Invoke helper or pass arguments.
              total > 0 ? Math.round((item.count / total) * 100) : 0;
            // Highlight the busiest category (ties all get is-top).
            const isTop = item.count === max && item.count > 0;
            // Return computed result to caller.
            return (
              // Render JSX element.
              <div
                // Assign value for subsequent use.
                key={item.key}
                // Assign value for subsequent use.
                className={`analytics-hchart-row${isTop ? " is-top" : ""}`}
              >
                // Render JSX element.
                <span className="analytics-hchart-label" title={item.key}>
                  // JSX expression container.
                  {item.key}
                // JSX element boundary.
                </span>
                // Render JSX element.
                <div className="analytics-hchart-track">
                  // Render JSX element.
                  <div
                    // Assign value for subsequent use.
                    className="analytics-hchart-bar"
                    // Assign value for subsequent use.
                    style={{
                      // Field/property in this shape.
                      width: `${widthPct}%`,
                      // Field/property in this shape.
                      animationDelay: `${idx * 45}ms`,
                    }}
                  />
                // JSX element boundary.
                </div>
                // Render JSX element.
                <div className="analytics-hchart-meta">
                  // Render JSX element.
                  <span className="analytics-hchart-value">{item.count}</span>
                  // JSX block comment.
                  {/* Share % omitted when the whole chart totals zero. */}
                  // JSX expression container.
                  {total > 0 && (
                    // Render JSX element.
                    <span className="muted analytics-hchart-share">{share}%</span>
                  )}
                // JSX element boundary.
                </div>
              // JSX element boundary.
              </div>
            );
          })}
        // JSX element boundary.
        </div>
      )}
    // JSX element boundary.
    </section>
  );
}

/**
 * Daily count trend SVG with hover guide.
 * Hit-rects are wide so sparse days stay easy to target.
 */
export function AnalyticsTrendChart({
  // List item in import/export/params.
  series,
// Open multi-line construct.
}: {
  // Field/property in this shape.
  series: AnalyticsSeriesPoint[];
// Open multi-line construct.
}) {
  // Sanitize useId for SVG fragment URLs (colons break some browsers).
  const gradId = useId().replace(/:/g, "");
  // Index of the hovered day, or null when the pointer left the chart.
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Local constant binding.
  const max = Math.max(1, ...series.map((s) => s.count));
  // Local constant binding.
  const total = series.reduce((s, p) => s + p.count, 0);
  // Peak day used for the header callout.
  const peak = useMemo(
    // Arrow function / callback body.
    () =>
      // Open multi-line construct.
      series.reduce(
        // Arrow function / callback body.
        (best, p) => (p.count > best.count ? p : best),
        // Continue multi-line list/arguments.
        series[0] ?? { date: "", count: 0 },
      ),
    // Continue multi-line list/arguments.
    [series],
  );

  // Project series into viewBox coordinates + smooth path strings.
  const plot = useMemo(() => {
    // Local constant binding.
    const innerW = VB_W - PAD.left - PAD.right;
    // Local constant binding.
    const innerH = VB_H - PAD.top - PAD.bottom;
    // Local constant binding.
    const n = series.length;
    // Local constant binding.
    const coords = series.map((p, i) => {
      // Center a single point; otherwise space evenly across the inner width.
      const x =
        // Assign value for subsequent use.
        n <= 1 ? PAD.left + innerW / 2 : PAD.left + (i / (n - 1)) * innerW;
      // Local constant binding.
      const y = PAD.top + innerH * (1 - p.count / max);
      // Return computed result to caller.
      return { x, y, ...p };
    });
    // Local constant binding.
    const line = buildSmoothPath(coords.map(({ x, y }) => ({ x, y })));
    // Close the line down to the baseline for the filled area.
    const area =
      // Assign value for subsequent use.
      coords.length === 0
        // Continue module logic.
        ? ""
        // Continue module logic.
        : `${line} L ${coords[coords.length - 1].x} ${PAD.top + innerH} L ${coords[0].x} ${PAD.top + innerH} Z`;
    // Local constant binding.
    const yTicks = [max, Math.round(max / 2), 0];
    // Thin out x-axis labels on dense series (~6 labels).
    const labelEvery = Math.max(1, Math.ceil(n / 6));
    // Return computed result to caller.
    return { coords, line, area, yTicks, innerH, labelEvery };
  // Close multi-line construct with trailing syntax.
  }, [series, max]);

  // Local constant binding.
  const hover = hoverIndex !== null ? plot.coords[hoverIndex] : null;
  // Local constant binding.
  const allZero = series.every((s) => s.count === 0);

  // Return computed result to caller.
  return (
    // Render JSX element.
    <section className="panel analytics-chart-panel">
      // Render JSX element.
      <div className="panel-header">
        // Render JSX element.
        <h2>Тренд</h2>
        // Render JSX element.
        <span className="muted">
          // JSX expression container.
          {series.length} дни · общо {total}
          // JSX block comment.
          {/* Peak callout only when there is a non-zero max day. */}
          // JSX expression container.
          {peak.count > 0 ? ` · връх ${peak.count}` : ""}
        // JSX element boundary.
        </span>
      // JSX element boundary.
      </div>
      // JSX block comment.
      {/* Empty / all-zero / chart branches. */}
      // JSX expression container.
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
          // Assign value for subsequent use.
          className="analytics-area-chart"
          // Arrow function / callback body.
          onMouseLeave={() => setHoverIndex(null)}
        >
          // Render JSX element.
          <svg
            // Assign value for subsequent use.
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            // Assign value for subsequent use.
            role="img"
            // Assign value for subsequent use.
            aria-label="Дневен тренд"
            // Assign value for subsequent use.
            preserveAspectRatio="xMidYMid meet"
          >
            // Render JSX element.
            <defs>
              // Render JSX element.
              <linearGradient id={`fill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                // Render JSX element.
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
                // Render JSX element.
                <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
              // JSX element boundary.
              </linearGradient>
              // Render JSX element.
              <filter
                // Assign value for subsequent use.
                id={`soft-${gradId}`}
                // Assign value for subsequent use.
                x="-20%"
                // Assign value for subsequent use.
                y="-20%"
                // Assign value for subsequent use.
                width="140%"
                // Assign value for subsequent use.
                height="140%"
              >
                // Render JSX element.
                <feDropShadow
                  // Assign value for subsequent use.
                  dx="0"
                  // Assign value for subsequent use.
                  dy="2"
                  // Assign value for subsequent use.
                  stdDeviation="2.5"
                  // Assign value for subsequent use.
                  floodColor="#14b8a6"
                  // Assign value for subsequent use.
                  floodOpacity="0.28"
                />
              // JSX element boundary.
              </filter>
            // JSX element boundary.
            </defs>

            // JSX block comment.
            {/* Horizontal grid + y-axis tick labels. */}
            // JSX expression container.
            {plot.yTicks.map((tick, i) => {
              // Local constant binding.
              const y =
                // Continue module logic.
                PAD.top +
                // Invoke helper or pass arguments.
                (plot.innerH * i) / Math.max(1, plot.yTicks.length - 1);
              // Return computed result to caller.
              return (
                // Render JSX element.
                <g key={`yt-${tick}-${i}`}>
                  // Render JSX element.
                  <line
                    // Assign value for subsequent use.
                    className="analytics-area-grid"
                    // Assign value for subsequent use.
                    x1={PAD.left}
                    // Assign value for subsequent use.
                    x2={VB_W - PAD.right}
                    // Assign value for subsequent use.
                    y1={y}
                    // Assign value for subsequent use.
                    y2={y}
                  />
                  // Render JSX element.
                  <text
                    // Assign value for subsequent use.
                    className="analytics-area-axis"
                    // Assign value for subsequent use.
                    x={PAD.left - 8}
                    // Assign value for subsequent use.
                    y={y + 3}
                    // Assign value for subsequent use.
                    textAnchor="end"
                  >
                    // JSX expression container.
                    {tick}
                  // JSX element boundary.
                  </text>
                // JSX element boundary.
                </g>
              );
            })}

            // Render JSX element.
            <path
              // Assign value for subsequent use.
              className="analytics-area-fill"
              // Assign value for subsequent use.
              d={plot.area}
              // Assign value for subsequent use.
              fill={`url(#fill-${gradId})`}
            />
            // Render JSX element.
            <path
              // Assign value for subsequent use.
              className="analytics-area-line"
              // Assign value for subsequent use.
              d={plot.line}
              // Assign value for subsequent use.
              filter={`url(#soft-${gradId})`}
            />

            // JSX expression container.
            {hover && (
              // Continue module logic.
              <>
                // Render JSX element.
                <line
                  // Assign value for subsequent use.
                  className="analytics-guide"
                  // Assign value for subsequent use.
                  x1={hover.x}
                  // Assign value for subsequent use.
                  x2={hover.x}
                  // Assign value for subsequent use.
                  y1={PAD.top}
                  // Assign value for subsequent use.
                  y2={PAD.top + plot.innerH}
                />
                // Render JSX element.
                <circle
                  // Assign value for subsequent use.
                  className="analytics-point"
                  // Assign value for subsequent use.
                  cx={hover.x}
                  // Assign value for subsequent use.
                  cy={hover.y}
                  // Assign value for subsequent use.
                  r={5}
                />
              // Continue module logic.
              </>
            )}

            // JSX expression container.
            {plot.coords.map((p, i) => {
              // Local constant binding.
              const showLabel =
                // Assign value for subsequent use.
                i === 0 ||
                // Assign value for subsequent use.
                i === plot.coords.length - 1 ||
                // Assign value for subsequent use.
                i % plot.labelEvery === 0;
              // Return computed result to caller.
              return (
                // Render JSX element.
                <g key={p.date}>
                  // JSX block comment.
                  {/* Date label only on first/last/every Nth day. */}
                  // JSX expression container.
                  {showLabel && (
                    // Render JSX element.
                    <text
                      // Assign value for subsequent use.
                      className="analytics-area-axis"
                      // Assign value for subsequent use.
                      x={p.x}
                      // Assign value for subsequent use.
                      y={VB_H - 10}
                      // Assign value for subsequent use.
                      textAnchor="middle"
                    >
                      // JSX expression container.
                      {p.date.slice(5)}
                    // JSX element boundary.
                    </text>
                  )}
                  // Render JSX element.
                  <rect
                    // Assign value for subsequent use.
                    className="analytics-hit"
                    // Assign value for subsequent use.
                    x={p.x - Math.max(8, VB_W / series.length / 2)}
                    // Assign value for subsequent use.
                    y={PAD.top}
                    // Assign value for subsequent use.
                    width={Math.max(16, VB_W / series.length)}
                    // Assign value for subsequent use.
                    height={plot.innerH}
                    // Arrow function / callback body.
                    onMouseEnter={() => setHoverIndex(i)}
                    // Arrow function / callback body.
                    onFocus={() => setHoverIndex(i)}
                  />
                // JSX element boundary.
                </g>
              );
            })}
          // JSX element boundary.
          </svg>

          // JSX expression container.
          {hover && (
            // Render JSX element.
            <div
              // Assign value for subsequent use.
              className="analytics-tooltip"
              // Assign value for subsequent use.
              style={{
                // Field/property in this shape.
                left: `${(hover.x / VB_W) * 100}%`,
                // Field/property in this shape.
                top: `${(hover.y / VB_H) * 100}%`,
              }}
            >
              // Render JSX element.
              <strong>{hover.count}</strong>
              // Render JSX element.
              <span>{hover.date}</span>
            // JSX element boundary.
            </div>
          )}
        // JSX element boundary.
        </div>
      )}
    // JSX element boundary.
    </section>
  );
}
