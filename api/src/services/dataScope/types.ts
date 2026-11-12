/**
 * Data-scope kinds derived from auth role (property-wide, sector, or assigned).
 */
import type { Role } from "@prisma/client";

/**
 * all = unrestricted; sectors = supervisor sectors; assigned_* = own work only.
 */
export type DataScopeKind =
  | "all"
  | "sectors"
  | "assigned_tasks"
  | "assigned_tickets";

/** Resolved scope attached to a request after auth. */
export type DataScope = {
  kind: DataScopeKind;
  employeeId: string;
  role: Role;
  /** Set when kind === "sectors". */
  sectorIds: string[];
};
