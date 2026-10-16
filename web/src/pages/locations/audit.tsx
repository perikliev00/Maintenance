/**
 * Location detail audit hook + thin wrapper around LocationHistoryPanel.
 * 403 responses become `forbidden` (soft deny) rather than a generic error.
 */
import { useEffect, useState } from "react";
import {
  ApiRequestError,
  fetchAuditEvents,
  type AuditEventRow,
  type LocationOccupancy,
  type LocationServiceStatus,
  type Room,
} from "../../api/client";
import { LocationHistoryPanel } from "../../components/LocationHistoryPanel";
import type { DetailAuditError } from "./types";

/**
 * Loads audit events for the open detail location; clears when id is null.
 * 403 becomes `forbidden` (soft deny) rather than a generic error.
 */
export function useLocationAudit(detailLocationId: string | null): {
  detailEvents: AuditEventRow[];
  detailLoading: boolean;
  detailAuditError: DetailAuditError | null;
} {
  const [detailEvents, setDetailEvents] = useState<AuditEventRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailAuditError, setDetailAuditError] =
    useState<DetailAuditError | null>(null);

  useEffect(() => {
    // Closed panel — reset audit state.
    if (!detailLocationId) {
      setDetailEvents([]);
      setDetailAuditError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setDetailLoading(true);
        setDetailAuditError(null);
        const rows = await fetchAuditEvents({
          locationId: detailLocationId,
          limit: 40,
        });
        if (!cancelled) {
          setDetailEvents(rows);
          setDetailAuditError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setDetailEvents([]);
          // Soft-deny for missing audit.view rather than a hard error banner.
          if (err instanceof ApiRequestError && err.status === 403) {
            setDetailAuditError({
              kind: "forbidden",
              message: "Нямате достъп до хронологията за това помещение.",
            });
          } else {
            setDetailAuditError({
              kind: "error",
              message:
                err instanceof Error
                  ? err.message
                  : "Неуспешно зареждане на хронологията.",
            });
          }
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailLocationId]);

  return { detailEvents, detailLoading, detailAuditError };
}

type LocationDetailPanelProps = {
  location: Room;
  unitLabelCap: string;
  events: AuditEventRow[];
  loading: boolean;
  auditError: DetailAuditError | null;
  busy: boolean;
  canSetOccupancy: boolean;
  canSetServiceStatus: boolean;
  onClose: () => void;
  onOccupancyChange: (next: LocationOccupancy) => void;
  onServiceStatusChange: (next: LocationServiceStatus) => void;
};

/**
 * Thin adapter that wires LocationsPage detail state into LocationHistoryPanel.
 */
export function LocationDetailPanel({
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
}: LocationDetailPanelProps) {
  // Props are already shaped for the shared panel — pass through.
  return (
    <LocationHistoryPanel
      location={location}
      unitLabelCap={unitLabelCap}
      events={events}
      loading={loading}
      auditError={auditError}
      busy={busy}
      canSetOccupancy={canSetOccupancy}
      canSetServiceStatus={canSetServiceStatus}
      onClose={onClose}
      onOccupancyChange={onOccupancyChange}
      onServiceStatusChange={onServiceStatusChange}
    />
  );
}
