import type { AuthUser, PublicSettings } from "../api/client";
import { LocationsPage } from "./LocationsPage";

type Props = {
  user: AuthUser;
  publicSettings?: PublicSettings | null;
};

export function RoomsPage({ user, publicSettings }: Props) {
  return (
    <LocationsPage user={user} kind="room" publicSettings={publicSettings} />
  );
}
