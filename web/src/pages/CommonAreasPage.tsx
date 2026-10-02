import type { AuthUser, PublicSettings } from "../api/client";
import { LocationsPage } from "./LocationsPage";

type Props = {
  user: AuthUser;
  publicSettings?: PublicSettings | null;
};

export function CommonAreasPage({ user, publicSettings }: Props) {
  return (
    <LocationsPage
      user={user}
      kind="common_area"
      publicSettings={publicSettings}
    />
  );
}
