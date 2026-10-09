import type {
  AuditEventRow,
  LocationOccupancy,
  LocationServiceStatus,
  Room,
} from "../api/client";
import { AuditTimeline } from "./AuditTimeline";

const OCCUPANCY_OPTIONS: LocationOccupancy[] = [
  "vacant",
  "occupied",
  "unknown",
];
const SERVICE_OPTIONS: LocationServiceStatus[] = [
  "in_service",
  "out_of_service",
  "unknown",
];

type AuditError = {
  kind: "forbidden" | "error";
  message: string;
} | null;

type Props = {
  location: Room;
  unitLabelCap: string;
  events: AuditEventRow[];
  loading: boolean;
  auditError: AuditError;
  busy: boolean;
  canSetOccupancy: boolean;
  canSetServiceStatus: boolean;
  onClose: () => void;
  onOccupancyChange?: (next: LocationOccupancy) => void;
  onServiceStatusChange?: (next: LocationServiceStatus) => void;
};

export function LocationHistoryPanel({
  location,
  unitLabelCap,
  events,
  loading,
  auditError,
  busy,
  canSetOccupancy,
  canSetServiceStatus,
  onClose,
  onOccupancyChange,
  onServiceStatusChange,
}: Props) {
  return (
    <div className="location-detail-backdrop" onClick={onClose}>
      <aside
        className="location-detail-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <h3>
              {unitLabelCap} {location.number}
            </h3>
            <div className="muted">
              {location.buildingCode} · ет. {location.floor}
              {location.sector ? ` · ${location.sector.code}` : ""}
            </div>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            ✕
          </button>
        </header>
        <div>
          <span className={`pill cleaning-${location.cleaningStatus}`}>
            {location.cleaningStatus}
          </span>{" "}
          <span className={`pill service-${location.serviceStatus}`}>
            {location.serviceStatus}
          </span>{" "}
          <span className={`pill ready-${location.readiness}`}>
            {location.readiness}
          </span>
        </div>

        {(canSetOccupancy || canSetServiceStatus) && (
          <section className="location-ops-controls">
            <h4>Оперативни състояния</h4>
            {canSetOccupancy && onOccupancyChange && (
              <label>
                Occupancy
                <select
                  value={location.occupancy}
                  disabled={busy}
                  onChange={(e) =>
                    onOccupancyChange(e.target.value as LocationOccupancy)
                  }
                >
                  {OCCUPANCY_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {canSetServiceStatus && onServiceStatusChange && (
              <label>
                Service status
                <select
                  value={location.serviceStatus}
                  disabled={busy}
                  onChange={(e) =>
                    onServiceStatusChange(
                      e.target.value as LocationServiceStatus,
                    )
                  }
                >
                  {SERVICE_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>
        )}

        <section>
          <h4>Хронология</h4>
          <AuditTimeline
            events={events}
            loading={loading}
            accessDenied={auditError?.kind === "forbidden"}
            error={auditError?.kind === "error" ? auditError.message : null}
            emptyLabel="Няма одит записи за това помещение."
          />
        </section>
      </aside>
    </div>
  );
}
