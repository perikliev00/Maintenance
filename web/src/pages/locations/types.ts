/** Shared types for the Locations board (rooms vs common areas). */
import type { AuthUser, PublicSettings } from "../../api/client";

// Export type definition for consumers of this module.
export type LocationKindFilter = "room" | "common_area";

// Export type definition for consumers of this module.
export type DetailAuditError = {
  // Provide kind field used by this structure.
  kind: "forbidden" | "error";
  // Provide message field used by this structure.
  message: string;
};

// Export type definition for consumers of this module.
export type LocationsPageProps = {
  // Provide user field used by this structure.
  user: AuthUser;
  // Provide kind field used by this structure.
  kind: LocationKindFilter;
  // Support the surrounding logic for this step.
  publicSettings?: PublicSettings | null;
  // Support the surrounding logic for this step.
  locale?: "bg" | "en";
  /** Open this location detail when arriving from the live board. */
  focusLocationId?: string | null;
  /** Optional task/session ids from live board — used to validate/highlight. */
  focusTaskId?: string | null;
  // Support the surrounding logic for this step.
  focusSessionId?: string | null;
  // Support the surrounding logic for this step.
  onFocusConsumed?: () => void;
};
