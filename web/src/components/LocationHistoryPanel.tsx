/**
 * Side panel for a single location: status pills, optional occupancy/service
 * controls (permission-gated), and audit timeline. Backdrop click closes;
 * clicks inside the aside are stopped so they do not dismiss.
 */
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
  /** When false, occupancy select is omitted. */
  canSetOccupancy: boolean;
  /** When false, service-status select is omitted. */
  canSetServiceStatus: boolean;
  onClose: () => void;
  onOccupancyChange?: (next: LocationOccupancy) => void;
  onServiceStatusChange?: (next: LocationServiceStatus) => void;
};

/**
 * Side panel for a single location: status pills, optional occupancy/service
 * controls (permission-gated), and audit timeline.
 */
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
  // Render output.
  return (
    // Backdrop click closes; stopPropagation on aside keeps inner clicks open.
    <div className="location-detail-backdrop" onClick={onClose}>
      {/* Side panel. */}
      <aside
        className="location-detail-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Panel header. */}
        <header>
          <div>
            {/* Section heading. */}
            <h3>
              {unitLabelCap} {location.number}
            </h3>
            <div className="muted">
              {location.buildingCode} · ет. {location.floor}
              {/* Optional sector code suffix. */}
              {location.sector ? ` · ${location.sector.code}` : ""}
            </div>
          </div>
          {/* Action control. */}
          <button type="button" className="ghost" onClick={onClose}>
            ✕
          </button>
        </header>
        {/* Live status pills from the location board row. */}
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

        {/* Ops controls only when at least one permission is granted. */}
        {/* Panel section. */}
        {(canSetOccupancy || canSetServiceStatus) && (
          <section className="location-ops-controls">
            {/* Section heading. */}
            <h4>Оперативни състояния</h4>
            {/* Occupancy select — requires canSetOccupancy + handler. */}
            {/* Form field. */}
            {canSetOccupancy && onOccupancyChange && (
              <label>
                Occupancy
                {/* Select input. */}
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
            {/* Service-status select — requires canSetServiceStatus + handler. */}
            {/* Form field. */}
            {canSetServiceStatus && onServiceStatusChange && (
              <label>
                Service status
                {/* Select input. */}
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

        {/* Panel section. */}
        <section>
          {/* Section heading. */}
          <h4>Хронология</h4>
          {/* Map auditError kind to timeline's accessDenied vs error props. */}
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
