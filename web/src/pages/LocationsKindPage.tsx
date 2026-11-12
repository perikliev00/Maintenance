/** Shared LocationsPage wrapper parameterized by location kind. */
import type { AuthUser, PublicSettings } from "../api/client";
// Import module dependency from ./LocationsPage.
import { LocationsPage } from "./LocationsPage";

// Declare type alias Props.
type Props = {
  // Provide kind field used by this structure.
  kind: "room" | "common_area";
  // Provide user field used by this structure.
  user: AuthUser;
  // Support the surrounding logic for this step.
  publicSettings?: PublicSettings | null;
  // Support the surrounding logic for this step.
  locale?: "bg" | "en";
  // Support the surrounding logic for this step.
  focusLocationId?: string | null;
  // Support the surrounding logic for this step.
  focusTaskId?: string | null;
  // Support the surrounding logic for this step.
  focusSessionId?: string | null;
  // Support the surrounding logic for this step.
  onFocusConsumed?: () => void;
};

/** Thin route wrapper that opens the locations board filtered by kind. */
export function LocationsKindPage({
  // Support the surrounding logic for this step.
  kind,
  // Support the surrounding logic for this step.
  user,
  // Support the surrounding logic for this step.
  publicSettings,
  // Support the surrounding logic for this step.
  locale,
  // Support the surrounding logic for this step.
  focusLocationId,
  // Support the surrounding logic for this step.
  focusTaskId,
  // Support the surrounding logic for this step.
  focusSessionId,
  // Support the surrounding logic for this step.
  onFocusConsumed,
// Support the surrounding logic for this step.
}: Props) {
  // Return the JSX/UI tree for this render path.
  return (
    // Render LocationsPage as part of this view composition.
    <LocationsPage
      // Pass user prop/value into the element or config.
      user={user}
      // Pass kind prop/value into the element or config.
      kind={kind}
      // Pass publicSettings prop/value into the element or config.
      publicSettings={publicSettings}
      // Pass locale prop/value into the element or config.
      locale={locale}
      // Pass focusLocationId prop/value into the element or config.
      focusLocationId={focusLocationId}
      // Pass focusTaskId prop/value into the element or config.
      focusTaskId={focusTaskId}
      // Pass focusSessionId prop/value into the element or config.
      focusSessionId={focusSessionId}
      // Pass onFocusConsumed prop/value into the element or config.
      onFocusConsumed={onFocusConsumed}
    />
  );
}

// Declare type alias RouteProps.
type RouteProps = Omit<Props, "kind">;

/** Rooms board entry — LocationsPage with `kind="room"`. */
export function RoomsPage(props: RouteProps) {
  // Return early result or rendered output from this path.
  return <LocationsKindPage kind="room" {...props} />;
}

/** Common-areas board entry — LocationsPage with `kind="common_area"`. */
export function CommonAreasPage(props: RouteProps) {
  // Return early result or rendered output from this path.
  return <LocationsKindPage kind="common_area" {...props} />;
}
