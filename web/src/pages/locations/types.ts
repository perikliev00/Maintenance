/** Shared types for the Locations board (rooms vs common areas). */
import type { AuthUser, PublicSettings } from "../../api/client";

export type LocationKindFilter = "room" | "common_area";

export type DetailAuditError = {
  kind: "forbidden" | "error";
  message: string;
};

export type LocationsPageProps = {
  user: AuthUser;
  kind: LocationKindFilter;
  publicSettings?: PublicSettings | null;
  locale?: "bg" | "en";
  /** Open this location detail when arriving from the live board. */
  focusLocationId?: string | null;
  /** Optional task/session ids from live board — used to validate/highlight. */
  focusTaskId?: string | null;
  focusSessionId?: string | null;
  onFocusConsumed?: () => void;
};
