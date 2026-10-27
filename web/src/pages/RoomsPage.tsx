/** Rooms board entry — LocationsPage with `kind="room"`. */
import type { AuthUser, PublicSettings } from "../api/client";
import { LocationsPage } from "./LocationsPage";

type Props = {
  user: AuthUser;
  publicSettings?: PublicSettings | null;
  locale?: "bg" | "en";
};

/** Thin route wrapper that opens the locations board filtered to rooms. */
export function RoomsPage({ user, publicSettings, locale }: Props) {
  return (
    <LocationsPage
      user={user}
      kind="room"
      publicSettings={publicSettings}
      locale={locale}
    />
  );
}
