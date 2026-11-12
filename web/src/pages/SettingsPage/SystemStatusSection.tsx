/** API/DB health and live entity counts from `fetchSystemStatus`. */
import type { SystemStatus } from "../../api/client";
// Import type-only dependency for typing without runtime cost.
import type { LabelFn } from "./constants";
// Import module dependency from ./settingsDraftLogic.
import { formatStatusCount } from "./settingsDraftLogic";

// Declare type alias Props.
type Props = {
  // Provide system field used by this structure.
  system: SystemStatus;
  // Provide label field used by this structure.
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
  // Support the surrounding logic for this step.
  label,
  // Support the surrounding logic for this step.
  onRetry,
// Support the surrounding logic for this step.
}: {
  // Provide label field used by this structure.
  label: LabelFn;
  // Provide onRetry field used by this structure.
  onRetry: () => void;
// Support the surrounding logic for this step.
}) {
  // Return the JSX/UI tree for this render path.
  return (
    // Render a <section> element for layout or semantics.
    <section className="panel settings-system">
      <h2>{label("Системно състояние", "System status")}</h2>
      <p className="error">
        {label(
          // Support the surrounding logic for this step.
          "Диагностиката е недостъпна (вероятно проблем с базата или сесията).",
          // Support the surrounding logic for this step.
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
  // Support the surrounding logic for this step.
  system,
  // Support the surrounding logic for this step.
  label,
  // Support the surrounding logic for this step.
  stale = false,
  // Support the surrounding logic for this step.
  lastSuccessAt = null,
// Support the surrounding logic for this step.
}: Props) {
  // Bind successLabel for use in the following logic.
  const successLabel = lastSuccessAt
    // Support the surrounding logic for this step.
    ? new Date(lastSuccessAt).toLocaleString()
    // Support the surrounding logic for this step.
    : new Date(system.fetchedAt ?? system.serverTime).toLocaleString();

  // Early / value return.
  return (
    // Render a <section> element for layout or semantics.
    <section className="panel settings-system">
      <h2>{label("Системно състояние", "System status")}</h2>
      {stale && (
        // Render a <p> element for layout or semantics.
        <p className="muted" role="status">
          // Support the surrounding logic for this step.
          {label(
            // Support the surrounding logic for this step.
            "Последното опресняване не успя — показаните стойности може да са остарели.",
            // Support the surrounding logic for this step.
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
              // Support the surrounding logic for this step.
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
