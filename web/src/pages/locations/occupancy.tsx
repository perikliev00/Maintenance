/**
 * Occupancy column helpers (hidden for common areas) and detail-panel handlers
 * that persist occupancy / service status via `runAction`.
 */
import {
  setLocationOccupancy,
  setLocationServiceStatus,
  type LocationOccupancy,
  type LocationServiceStatus,
  type Room,
} from "../../api/client";

/** Table header cell for occupancy — hidden on common-area boards. */
export function OccupancyHeaderCell({ isCommon }: { isCommon: boolean }) {
  // Common areas have no guest occupancy concept.
  if (isCommon) return null;
  return <th>Occupancy</th>;
}

/** Table body cell showing occupancy — hidden on common-area boards. */
export function OccupancyCell({
  isCommon,
  occupancy,
}: {
  isCommon: boolean;
  occupancy: Room["occupancy"];
}) {
  if (isCommon) return null;
  return <td>{occupancy}</td>;
}

/**
 * Build detail-panel handlers that persist occupancy / service status
 * through the shared `runAction` busy/error wrapper.
 */
export function makeOccupancyHandlers(opts: {
  location: Room;
  runAction: (locationId: string, action: () => Promise<void>) => Promise<void>;
  setMessage: (message: string | null) => void;
}): {
  onOccupancyChange: (next: LocationOccupancy) => void;
  onServiceStatusChange: (next: LocationServiceStatus) => void;
} {
  const { location, runAction, setMessage } = opts;
  return {
    onOccupancyChange: (next) => {
      // Wrap API write so the parent can set busyId + surface errors.
      void runAction(location.id, async () => {
        await setLocationOccupancy(location.id, next);
        setMessage(`Occupancy → ${next} (${location.number})`);
      });
    },
    onServiceStatusChange: (next) => {
      void runAction(location.id, async () => {
        await setLocationServiceStatus(location.id, next);
        setMessage(`Service → ${next} (${location.number})`);
      });
    },
  };
}
