/** API/DB health and live entity counts from `fetchSystemStatus`. */
import type { SystemStatus } from "../../api/client";
import type { LabelFn } from "./constants";
import { formatStatusCount } from "./settingsDraftLogic";

type Props = {
  system: SystemStatus;
  label: LabelFn;
  /** True when the last system refresh failed; prior counts may be stale. */
  stale?: boolean;
  /** ISO timestamp of the last successful system fetch (client-side). */
  lastSuccessAt?: string | null;
};

/**
 * Shown when diagnostics never loaded successfully (no prior counts to show).
 * Isolated from settings errors: settings stay editable while this is visible.
 */
export function SystemStatusUnavailable({
  label,
  onRetry,
}: {
  label: LabelFn;
  onRetry: () => void;
}) {
  return (
    <section className="panel settings-system">
      <h2>{label("Системно състояние", "System status")}</h2>
      <p className="error">
        {label(
          "Диагностиката е недостъпна (вероятно проблем с базата или сесията).",
          "Diagnostics unavailable (likely database or session failure).",
        )}
      </p>
      <button type="button" onClick={onRetry}>
        {label("Опитай отново", "Retry")}
      </button>
    </section>
  );
}

/**
 * Read-only API/DB health tiles and live entity counts from `fetchSystemStatus`.
 */
export function SystemStatusSection({
  system,
  label,
  stale = false,
  lastSuccessAt = null,
}: Props) {
  const successLabel = lastSuccessAt
    ? new Date(lastSuccessAt).toLocaleString()
    : new Date(system.fetchedAt ?? system.serverTime).toLocaleString();

  // Early / value return.
  return (
    <section className="panel settings-system">
      <h2>{label("Системно състояние", "System status")}</h2>
      {stale && (
        <p className="muted" role="status">
                    {label(
            "Последното опресняване не успя — показаните стойности може да са остарели.",
            "Last refresh failed — displayed values may be stale.",
          )}
        </p>
      )}
      <div className="settings-status-grid">
        <div className="stat-card">
          <span className="muted">API</span>
          {/* Color token flips on ok/down for quick scanning. */}
          <strong className={system.api.ok ? "ok-text" : "err-text"}>
            {/* Render branch: system.api.ok ? "OK" : "DOWN" */}
            {system.api.ok ? "OK" : "DOWN"}
          </strong>
        </div>
        <div className="stat-card">
          <span className="muted">DB</span>
          <strong className={system.database.ok ? "ok-text" : "err-text"}>
            {system.database.ok
              ? `OK · ${system.database.pingMs}ms`
              : "DOWN"}
          </strong>
        </div>
        <div className="stat-card">
          <span className="muted">{label("Стаи", "Rooms")}</span>
          <strong>{formatStatusCount(system.counts.rooms)}</strong>
        </div>
        <div className="stat-card">
          <span className="muted">{label("Общи части", "Common")}</span>
          <strong>{formatStatusCount(system.counts.commonAreas)}</strong>
        </div>
        <div className="stat-card">
          <span className="muted">{label("Отворени тикети", "Open tickets")}</span>
          <strong>{formatStatusCount(system.counts.openTickets)}</strong>
        </div>
        <div className="stat-card">
          <span className="muted">{label("Активни сесии", "Running")}</span>
          <strong>{formatStatusCount(system.counts.runningSessions)}</strong>
        </div>
        <div className="stat-card">
          <span className="muted">v{system.version}</span>
          <strong className="muted" style={{ fontSize: "0.85rem" }}>
            {label("Обновено", "Updated")} · {successLabel}
          </strong>
        </div>
      </div>
    </section>
  );
}
