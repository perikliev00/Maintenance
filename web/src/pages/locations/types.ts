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
};
