/** Shared LocationsPage wrapper parameterized by location kind. */
import type { AuthUser, PublicSettings } from "../api/client";
import { LocationsPage } from "./LocationsPage";

type Props = {
  kind: "room" | "common_area";
  user: AuthUser;
  publicSettings?: PublicSettings | null;
  locale?: "bg" | "en";
  focusLocationId?: string | null;
  focusTaskId?: string | null;
  focusSessionId?: string | null;
  onFocusConsumed?: () => void;
};

/** Thin route wrapper that opens the locations board filtered by kind. */
export function LocationsKindPage({
  kind,
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
      kind={kind}
      publicSettings={publicSettings}
      locale={locale}
      focusLocationId={focusLocationId}
      focusTaskId={focusTaskId}
      focusSessionId={focusSessionId}
      onFocusConsumed={onFocusConsumed}
    />
  );
}

type RouteProps = Omit<Props, "kind">;

/** Rooms board entry — LocationsPage with `kind="room"`. */
export function RoomsPage(props: RouteProps) {
  return <LocationsKindPage kind="room" {...props} />;
}

/** Common-areas board entry — LocationsPage with `kind="common_area"`. */
export function CommonAreasPage(props: RouteProps) {
  return <LocationsKindPage kind="common_area" {...props} />;
}
