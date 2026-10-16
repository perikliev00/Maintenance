/** Common-areas board entry — LocationsPage with `kind="common_area"`. */
import type { AuthUser, PublicSettings } from "../api/client";
import { LocationsPage } from "./LocationsPage";

type Props = {
  user: AuthUser;
  publicSettings?: PublicSettings | null;
};

/** Thin route wrapper that opens the locations board filtered to common areas. */
export function CommonAreasPage({ user, publicSettings }: Props) {
  // Delegate all list/actions UI to LocationsPage with kind=common_area.
  return (
    <LocationsPage
      user={user}
      kind="common_area"
      publicSettings={publicSettings}
    />
  );
}
