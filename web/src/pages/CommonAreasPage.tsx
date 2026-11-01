/** Common-areas board entry — LocationsPage with `kind="common_area"`. */
import type { AuthUser, PublicSettings } from "../api/client";
import { LocationsPage } from "./LocationsPage";

type Props = {
  user: AuthUser;
  publicSettings?: PublicSettings | null;
  locale?: "bg" | "en";
  focusLocationId?: string | null;
  focusTaskId?: string | null;
  focusSessionId?: string | null;
  onFocusConsumed?: () => void;
};

/** Thin route wrapper that opens the locations board filtered to common areas. */
export function CommonAreasPage({
  user,
  publicSettings,
  locale,
  focusLocationId,
  focusTaskId,
  focusSessionId,
  onFocusConsumed,
}: Props) {
  return (
    <LocationsPage
      user={user}
      kind="common_area"
      publicSettings={publicSettings}
      locale={locale}
      focusLocationId={focusLocationId}
      focusTaskId={focusTaskId}
      focusSessionId={focusSessionId}
      onFocusConsumed={onFocusConsumed}
    />
  );
}
