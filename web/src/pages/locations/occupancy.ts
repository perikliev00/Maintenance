/**
 * Occupancy column helpers (hidden for common areas) and detail-panel handlers
 * that persist occupancy / service status via `runAction`.
 */
import {
  // Support the surrounding logic for this step.
  setLocationOccupancy,
  // Support the surrounding logic for this step.
  setLocationServiceStatus,
  // Declare type alias LocationOccupancy.
  type LocationOccupancy,
  // Declare type alias LocationServiceStatus.
  type LocationServiceStatus,
  // Declare type alias Room.
  type Room,
// Support the surrounding logic for this step.
} from "../../api/client";

/**
 * Build detail-panel handlers that persist occupancy / service status
 * through the shared `runAction` busy/error wrapper.
 */
export function makeOccupancyHandlers(opts: {
  // Provide location field used by this structure.
  location: Room;
  // Provide runAction field used by this structure.
  runAction: (locationId: string, action: () => Promise<void>) => Promise<void>;
  // Provide setMessage field used by this structure.
  setMessage: (message: string | null) => void;
// Support the surrounding logic for this step.
}): {
  // Provide onOccupancyChange field used by this structure.
  onOccupancyChange: (next: LocationOccupancy) => void;
  // Provide onServiceStatusChange field used by this structure.
  onServiceStatusChange: (next: LocationServiceStatus) => void;
// Support the surrounding logic for this step.
} {
  // Bind a local value for the following logic.
  const { location, runAction, setMessage } = opts;
  // Return early result or rendered output from this path.
  return {
    // Provide onOccupancyChange field used by this structure.
    onOccupancyChange: (next) => {
      // Wrap API write so the parent can set busyId + surface errors.
      void runAction(location.id, async () => {
        // Wait for an async operation before continuing.
        await setLocationOccupancy(location.id, next);
        // Update React state so the UI reflects the new value.
        setMessage(`Occupancy → ${next} (${location.number})`);
      });
    },
    // Provide onServiceStatusChange field used by this structure.
    onServiceStatusChange: (next) => {
      // Fire-and-forget async work without awaiting in this path.
      void runAction(location.id, async () => {
        // Wait for an async operation before continuing.
        await setLocationServiceStatus(location.id, next);
        // Update React state so the UI reflects the new value.
        setMessage(`Service → ${next} (${location.number})`);
      });
    },
  };
}
