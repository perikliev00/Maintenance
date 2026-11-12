/**
 * Centered modal for a single location: status pills, optional occupancy/service
 * controls (permission-gated), and audit timeline. Backdrop click / Escape / X close.
 * Portaled to document.body so position:fixed is always viewport-relative.
 * Body scroll is locked while open so the rooms list keeps its scroll position.
 */
import { createPortal } from "react-dom";
// Import dependency used by this module.
import type {
  // List item in import/export/params.
  AuditEventRow,
  // List item in import/export/params.
  LocationOccupancy,
  // List item in import/export/params.
  LocationServiceStatus,
  // List item in import/export/params.
  Room,
// Close multi-line construct with trailing syntax.
} from "../api/client";
// Import dependency used by this module.
import { useModalLifecycle } from "../hooks/useModalLifecycle";
// Import dependency used by this module.
import { AuditTimeline } from "./AuditTimeline";

// Local constant binding.
const OCCUPANCY_OPTIONS: LocationOccupancy[] = [
  // Continue multi-line list/arguments.
  "vacant",
  // Continue multi-line list/arguments.
  "occupied",
  // Continue multi-line list/arguments.
  "unknown",
];
// Local constant binding.
const SERVICE_OPTIONS: LocationServiceStatus[] = [
  // Continue multi-line list/arguments.
  "in_service",
  // Continue multi-line list/arguments.
  "out_of_service",
  // Continue multi-line list/arguments.
  "unknown",
];

// Local type alias shaping data.
type AuditError = {
  // Field/property in this shape.
  kind: "forbidden" | "error";
  // Field/property in this shape.
  message: string;
// Close multi-line construct with trailing syntax.
} | null;

// Local type alias shaping data.
type Props = {
  // Field/property in this shape.
  location: Room;
  // Field/property in this shape.
  unitLabelCap: string;
  // Field/property in this shape.
  events: AuditEventRow[];
  // Field/property in this shape.
  loading: boolean;
  // Field/property in this shape.
  auditError: AuditError;
  // Field/property in this shape.
  busy: boolean;
  /** When false, occupancy select is omitted. */
  canSetOccupancy: boolean;
  /** When false, service-status select is omitted. */
  canSetServiceStatus: boolean;
  // Arrow function / callback body.
  onClose: () => void;
  // Arrow function / callback body.
  onOccupancyChange?: (next: LocationOccupancy) => void;
  // Arrow function / callback body.
  onServiceStatusChange?: (next: LocationServiceStatus) => void;
};

/**
 * Centered location detail modal with the same ops controls and audit timeline
 * as the former side panel.
 */
export function LocationHistoryPanel({
  // List item in import/export/params.
  location,
  // List item in import/export/params.
  unitLabelCap,
  // List item in import/export/params.
  events,
  // List item in import/export/params.
  loading,
  // List item in import/export/params.
  auditError,
  // List item in import/export/params.
  busy,
  // List item in import/export/params.
  canSetOccupancy,
  // List item in import/export/params.
  canSetServiceStatus,
  // List item in import/export/params.
  onClose,
  // List item in import/export/params.
  onOccupancyChange,
  // List item in import/export/params.
  onServiceStatusChange,
// Open multi-line construct.
}: Props) {
  // Invoke helper or pass arguments.
  useModalLifecycle(onClose);

  // Return computed result to caller.
  return createPortal(
    // Render JSX element.
    <div
      // Assign value for subsequent use.
      className="location-detail-backdrop"
      // Assign value for subsequent use.
      role="presentation"
      // Assign value for subsequent use.
      onClick={onClose}
    >
      // Render JSX element.
      <div
        // Assign value for subsequent use.
        className="location-detail-modal"
        // Assign value for subsequent use.
        role="dialog"
        // Assign value for subsequent use.
        aria-modal="true"
        // Assign value for subsequent use.
        aria-labelledby="location-detail-title"
        // Arrow function / callback body.
        onClick={(e) => e.stopPropagation()}
      >
        // Render JSX element.
        <header className="location-detail-modal-header">
          // Render JSX element.
          <div>
            // Render JSX element.
            <h3 id="location-detail-title">
              // JSX expression container.
              {unitLabelCap} {location.number}
            // JSX element boundary.
            </h3>
            // Render JSX element.
            <div className="muted">
              // JSX expression container.
              {location.buildingCode} · ет. {location.floor}
              // JSX expression container.
              {location.sector ? ` · ${location.sector.code}` : ""}
            // JSX element boundary.
            </div>
          // JSX element boundary.
          </div>
          // Render JSX element.
          <button
            // Assign value for subsequent use.
            type="button"
            // Assign value for subsequent use.
            className="ghost location-detail-close"
            // Assign value for subsequent use.
            onClick={onClose}
            // Assign value for subsequent use.
            aria-label="Close"
          >
            // Identifier continuation in list.
            X
          // JSX element boundary.
          </button>
        // JSX element boundary.
        </header>

        // Render JSX element.
        <div className="location-detail-modal-body">
          // Render JSX element.
          <div>
            // Render JSX element.
            <span className={`pill cleaning-${location.cleaningStatus}`}>
              // JSX expression container.
              {location.cleaningStatus}
            // JSX element boundary.
            </span>{" "}
            // Render JSX element.
            <span className={`pill service-${location.serviceStatus}`}>
              // JSX expression container.
              {location.serviceStatus}
            // JSX element boundary.
            </span>{" "}
            // Render JSX element.
            <span className={`pill ready-${location.readiness}`}>
              // JSX expression container.
              {location.readiness}
            // JSX element boundary.
            </span>
          // JSX element boundary.
          </div>

          // JSX expression container.
          {(canSetOccupancy || canSetServiceStatus) && (
            // Render JSX element.
            <section className="location-ops-controls">
              // Render JSX element.
              <h4>Оперативни състояния</h4>
              // JSX expression container.
              {canSetOccupancy && onOccupancyChange && (
                // Render JSX element.
                <label>
                  // JSX boolean prop or identifier.
                  Occupancy
                  // Render JSX element.
                  <select
                    // Assign value for subsequent use.
                    value={location.occupancy}
                    // Assign value for subsequent use.
                    disabled={busy}
                    // Arrow function / callback body.
                    onChange={(e) =>
                      // Invoke helper or pass arguments.
                      onOccupancyChange(e.target.value as LocationOccupancy)
                    }
                  >
                    // JSX expression container.
                    {OCCUPANCY_OPTIONS.map((o) => (
                      // Render JSX element.
                      <option key={o} value={o}>
                        // JSX expression container.
                        {o}
                      // JSX element boundary.
                      </option>
                    ))}
                  // JSX element boundary.
                  </select>
                // JSX element boundary.
                </label>
              )}
              // JSX expression container.
              {canSetServiceStatus && onServiceStatusChange && (
                // Render JSX element.
                <label>
                  Service status
                  // Render JSX element.
                  <select
                    // Assign value for subsequent use.
                    value={location.serviceStatus}
                    // Assign value for subsequent use.
                    disabled={busy}
                    // Arrow function / callback body.
                    onChange={(e) =>
                      // Open multi-line construct.
                      onServiceStatusChange(
                        // Continue multi-line list/arguments.
                        e.target.value as LocationServiceStatus,
                      )
                    }
                  >
                    // JSX expression container.
                    {SERVICE_OPTIONS.map((o) => (
                      // Render JSX element.
                      <option key={o} value={o}>
                        // JSX expression container.
                        {o}
                      // JSX element boundary.
                      </option>
                    ))}
                  // JSX element boundary.
                  </select>
                // JSX element boundary.
                </label>
              )}
            // JSX element boundary.
            </section>
          )}

          // Render JSX element.
          <section>
            // Render JSX element.
            <h4>Хронология</h4>
            // Render JSX element.
            <AuditTimeline
              // Assign value for subsequent use.
              events={events}
              // Assign value for subsequent use.
              loading={loading}
              // Assign value for subsequent use.
              accessDenied={auditError?.kind === "forbidden"}
              // Assign value for subsequent use.
              error={auditError?.kind === "error" ? auditError.message : null}
              // Assign value for subsequent use.
              emptyLabel="Няма одит записи за това помещение."
            />
          // JSX element boundary.
          </section>
        // JSX element boundary.
        </div>
      // JSX element boundary.
      </div>
    // JSX element boundary.
    </div>,
    // Continue multi-line list/arguments.
    document.body,
  );
}
