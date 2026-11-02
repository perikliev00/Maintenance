/**
 * Centered modal for a single location: status pills, optional occupancy/service
 * controls (permission-gated), and audit timeline. Backdrop click / Escape / X close.
 * Portaled to document.body so position:fixed is always viewport-relative.
 * Body scroll is locked while open so the rooms list keeps its scroll position.
 */
import { createPortal } from "react-dom";
import type {
  AuditEventRow,
  LocationOccupancy,
  LocationServiceStatus,
  Room,
} from "../api/client";
import { useModalLifecycle } from "../hooks/useModalLifecycle";
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
 * Centered location detail modal with the same ops controls and audit timeline
 * as the former side panel.
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
  useModalLifecycle(onClose);

  return createPortal(
    <div
      className="location-detail-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="location-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="location-detail-modal-header">
          <div>
            <h3 id="location-detail-title">
              {unitLabelCap} {location.number}
            </h3>
            <div className="muted">
              {location.buildingCode} · ет. {location.floor}
              {location.sector ? ` · ${location.sector.code}` : ""}
            </div>
          </div>
          <button
            type="button"
            className="ghost location-detail-close"
            onClick={onClose}
            aria-label="Close"
          >
            X
          </button>
        </header>

        <div className="location-detail-modal-body">
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
        </div>
      </div>
    </div>,
    document.body,
  );
}
