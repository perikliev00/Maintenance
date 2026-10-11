import type { Role } from "@prisma/client";

export type DataScopeKind =
  | "all"
  | "sectors"
  | "assigned_tasks"
  | "assigned_tickets";

export type DataScope = {
  kind: DataScopeKind;
  employeeId: string;
  role: Role;
  /** Set when kind === "sectors". */
  sectorIds: string[];
};
