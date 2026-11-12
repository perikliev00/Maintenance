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
      // Fire-and-forget async work without awaiting in this path.
      void runAction(location.id, async () => {
        await setLocationServiceStatus(location.id, next);
        setMessage(`Service → ${next} (${location.number})`);
      });
    },
  };
}
