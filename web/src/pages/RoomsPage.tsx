/** Rooms board entry — LocationsPage with `kind="room"`. */
import type { AuthUser, PublicSettings } from "../api/client";
import { LocationsPage } from "./LocationsPage";

type Props = {
  user: AuthUser;
  publicSettings?: PublicSettings | null;
};

/** Thin route wrapper that opens the locations board filtered to rooms. */
export function RoomsPage({ user, publicSettings }: Props) {
  // Delegate all list/actions UI to LocationsPage with kind=room.
  return (
    <LocationsPage user={user} kind="room" publicSettings={publicSettings} />
  );
}
