import {
  setLocationOccupancy,
  setLocationServiceStatus,
  type LocationOccupancy,
  type LocationServiceStatus,
  type Room,
} from "../../api/client";

export function OccupancyHeaderCell({ isCommon }: { isCommon: boolean }) {
  if (isCommon) return null;
  return <th>Occupancy</th>;
}

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
