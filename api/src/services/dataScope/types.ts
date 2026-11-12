/**
 * Data-scope kinds derived from auth role (property-wide, sector, or assigned).
 */
import type { Role } from "@prisma/client";

/**
 * all = unrestricted; sectors = supervisor sectors; assigned_* = own work only.
 */
export type DataScopeKind =
  // Run next step: | "all"
  | "all"
  // Run next step: | "sectors"
  | "sectors"
  // Run next step: | "assigned_tasks"
  | "assigned_tasks"
  // Run next step: | "assigned_tickets";
  | "assigned_tickets";

/** Resolved scope attached to a request after auth. */
export type DataScope = {
  // Set kind on the structure being built.
  kind: DataScopeKind;
  // Set employeeId on the structure being built.
  employeeId: string;
  // Set role on the structure being built.
  role: Role;
  /** Set when kind === "sectors". */
  sectorIds: string[];
};
