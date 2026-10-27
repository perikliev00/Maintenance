/** Common-areas board entry — LocationsPage with `kind="common_area"`. */
import type { AuthUser, PublicSettings } from "../api/client";
import { LocationsPage } from "./LocationsPage";

type Props = {
  user: AuthUser;
  publicSettings?: PublicSettings | null;
  locale?: "bg" | "en";
};

/** Thin route wrapper that opens the locations board filtered to common areas. */
export function CommonAreasPage({ user, publicSettings, locale }: Props) {
  return (
    <LocationsPage
      user={user}
      kind="common_area"
      publicSettings={publicSettings}
      locale={locale}
    />
  );
}
