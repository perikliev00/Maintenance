/** API/DB health and live entity counts from `fetchSystemStatus`. */
import type { SystemStatus } from "../../api/client";
import type { LabelFn } from "./constants";

type Props = {
  system: SystemStatus;
  label: LabelFn;
};

/**
 * Read-only API/DB health tiles and live entity counts from `fetchSystemStatus`.
 */
export function SystemStatusSection({ system, label }: Props) {
  // Early / value return.
  return (
    <section className="panel settings-system">
      <h2>{label("Системно състояние", "System status")}</h2>
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
          <strong>{system.counts.rooms}</strong>
        </div>
        <div className="stat-card">
          <span className="muted">{label("Общи части", "Common")}</span>
          <strong>{system.counts.commonAreas}</strong>
        </div>
        <div className="stat-card">
          <span className="muted">{label("Отворени тикети", "Open tickets")}</span>
          <strong>{system.counts.openTickets}</strong>
        </div>
        <div className="stat-card">
          <span className="muted">{label("Активни сесии", "Running")}</span>
          <strong>{system.counts.runningSessions}</strong>
        </div>
        <div className="stat-card">
          <span className="muted">v{system.version}</span>
          <strong className="muted" style={{ fontSize: "0.85rem" }}>
            {new Date(system.serverTime).toLocaleString()}
          </strong>
        </div>
      </div>
    </section>
  );
}
