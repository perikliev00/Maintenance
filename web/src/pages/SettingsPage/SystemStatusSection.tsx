import type { SystemStatus } from "../../api/client";
import type { LabelFn } from "./constants";

type Props = {
  system: SystemStatus;
  label: LabelFn;
};

export function SystemStatusSection({ system, label }: Props) {
  return (
    <section className="panel settings-system">
      <h2>{label("Системно състояние", "System status")}</h2>
      <div className="settings-status-grid">
        <div className="stat-card">
          <span className="muted">API</span>
          <strong className={system.api.ok ? "ok-text" : "err-text"}>
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
