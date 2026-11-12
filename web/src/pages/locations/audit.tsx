/**
 * Location detail audit hook + thin wrapper around LocationHistoryPanel.
 * 403 responses become `forbidden` (soft deny) rather than a generic error.
 */
import { useEffect, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  ApiRequestError,
  // Support the surrounding logic for this step.
  fetchAuditEvents,
  // Declare type alias AuditEventRow.
  type AuditEventRow,
  // Declare type alias LocationOccupancy.
  type LocationOccupancy,
  // Declare type alias LocationServiceStatus.
  type LocationServiceStatus,
  // Declare type alias Room.
  type Room,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ../../components/LocationHistoryPanel.
import { LocationHistoryPanel } from "../../components/LocationHistoryPanel";
// Import type-only dependency for typing without runtime cost.
import type { DetailAuditError } from "./types";

/**
 * Loads audit events for the open detail location; clears when id is null.
 * 403 becomes `forbidden` (soft deny) rather than a generic error.
 */
export function useLocationAudit(detailLocationId: string | null): {
  // Provide detailEvents field used by this structure.
  detailEvents: AuditEventRow[];
  // Provide detailLoading field used by this structure.
  detailLoading: boolean;
  // Provide detailAuditError field used by this structure.
  detailAuditError: DetailAuditError | null;
// Support the surrounding logic for this step.
} {
  // React state slot for local UI/data that can change over time.
  const [detailEvents, setDetailEvents] = useState<AuditEventRow[]>([]);
  // React state slot for local UI/data that can change over time.
  const [detailLoading, setDetailLoading] = useState(false);
  // Bind a local value for the following logic.
  const [detailAuditError, setDetailAuditError] =
    // Support the surrounding logic for this step.
    useState<DetailAuditError | null>(null);

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Closed panel — reset audit state.
    if (!detailLocationId) {
      // Update React state so the UI reflects the new value.
      setDetailEvents([]);
      // Update React state so the UI reflects the new value.
      setDetailAuditError(null);
      // Return early result or rendered output from this path.
      return;
    }
    // Bind cancelled for use in the following logic.
    let cancelled = false;
    // Support the surrounding logic for this step.
    (async () => {
      // Begin guarded block to catch runtime failures.
      try {
        // Update React state so the UI reflects the new value.
        setDetailLoading(true);
        // Update React state so the UI reflects the new value.
        setDetailAuditError(null);
        // Bind rows for use in the following logic.
        const rows = await fetchAuditEvents({
          // Provide locationId field used by this structure.
          locationId: detailLocationId,
          // Provide limit field used by this structure.
          limit: 40,
        });
        // Conditional branch for the case described by this guard.
        if (!cancelled) {
          // Update React state so the UI reflects the new value.
          setDetailEvents(rows);
          // Update React state so the UI reflects the new value.
          setDetailAuditError(null);
        }
      // Support the surrounding logic for this step.
      } catch (err) {
        // Conditional branch for the case described by this guard.
        if (!cancelled) {
          // Update React state so the UI reflects the new value.
          setDetailEvents([]);
          // Soft-deny for missing audit.view rather than a hard error banner.
          if (err instanceof ApiRequestError && err.status === 403) {
            // Update React state so the UI reflects the new value.
            setDetailAuditError({
              // Provide kind field used by this structure.
              kind: "forbidden",
              // Provide message field used by this structure.
              message: "Нямате достъп до хронологията за това помещение.",
            });
          // Support the surrounding logic for this step.
          } else {
            // Update React state so the UI reflects the new value.
            setDetailAuditError({
              // Provide kind field used by this structure.
              kind: "error",
              // Provide message field used by this structure.
              message:
                // Support the surrounding logic for this step.
                err instanceof Error
                  // Support the surrounding logic for this step.
                  ? err.message
                  // Support the surrounding logic for this step.
                  : "Неуспешно зареждане на хронологията.",
            });
          }
        }
      // Support the surrounding logic for this step.
      } finally {
        // Conditional branch for the case described by this guard.
        if (!cancelled) setDetailLoading(false);
      }
    // Support the surrounding logic for this step.
    })();
    // Return early result or rendered output from this path.
    return () => {
      // Support the surrounding logic for this step.
      cancelled = true;
    };
  // Support the surrounding logic for this step.
  }, [detailLocationId]);

  // Return early result or rendered output from this path.
  return { detailEvents, detailLoading, detailAuditError };
}

// Declare type alias LocationDetailPanelProps.
type LocationDetailPanelProps = {
  // Provide location field used by this structure.
  location: Room;
  // Provide unitLabelCap field used by this structure.
  unitLabelCap: string;
  // Provide events field used by this structure.
  events: AuditEventRow[];
  // Provide loading field used by this structure.
  loading: boolean;
  // Provide auditError field used by this structure.
  auditError: DetailAuditError | null;
  // Provide busy field used by this structure.
  busy: boolean;
  // Provide canSetOccupancy field used by this structure.
  canSetOccupancy: boolean;
  // Provide canSetServiceStatus field used by this structure.
  canSetServiceStatus: boolean;
  // Provide onClose field used by this structure.
  onClose: () => void;
  // Provide onOccupancyChange field used by this structure.
  onOccupancyChange: (next: LocationOccupancy) => void;
  // Provide onServiceStatusChange field used by this structure.
  onServiceStatusChange: (next: LocationServiceStatus) => void;
};

/**
 * Thin adapter that wires LocationsPage detail state into the centered
 * LocationHistoryPanel modal (same props / business logic as before).
 */
export function LocationDetailPanel({
  // Support the surrounding logic for this step.
  location,
  // Support the surrounding logic for this step.
  unitLabelCap,
  // Support the surrounding logic for this step.
  events,
  // Support the surrounding logic for this step.
  loading,
  // Support the surrounding logic for this step.
  auditError,
  // Support the surrounding logic for this step.
  busy,
  // Support the surrounding logic for this step.
  canSetOccupancy,
  // Support the surrounding logic for this step.
  canSetServiceStatus,
  // Support the surrounding logic for this step.
  onClose,
  // Support the surrounding logic for this step.
  onOccupancyChange,
  // Support the surrounding logic for this step.
  onServiceStatusChange,
// Support the surrounding logic for this step.
}: LocationDetailPanelProps) {
  // Return the JSX/UI tree for this render path.
  return (
    // Render LocationHistoryPanel as part of this view composition.
    <LocationHistoryPanel
      // Pass location prop/value into the element or config.
      location={location}
      // Pass unitLabelCap prop/value into the element or config.
      unitLabelCap={unitLabelCap}
      // Pass events prop/value into the element or config.
      events={events}
      // Pass loading prop/value into the element or config.
      loading={loading}
      // Pass auditError prop/value into the element or config.
      auditError={auditError}
      // Pass busy prop/value into the element or config.
      busy={busy}
      // Pass canSetOccupancy prop/value into the element or config.
      canSetOccupancy={canSetOccupancy}
      // Pass canSetServiceStatus prop/value into the element or config.
      canSetServiceStatus={canSetServiceStatus}
      // Pass onClose prop/value into the element or config.
      onClose={onClose}
      // Pass onOccupancyChange prop/value into the element or config.
      onOccupancyChange={onOccupancyChange}
      // Pass onServiceStatusChange prop/value into the element or config.
      onServiceStatusChange={onServiceStatusChange}
    />
  );
}
