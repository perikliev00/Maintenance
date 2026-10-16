/**
 * Shared analytics types: domain selection and optional Prisma where-clauses
 * used to restrict summaries to the caller's data scope.
 */
import { Prisma } from "@prisma/client";

/** Which operational domain the analytics summary covers. */
export type AnalyticsDomain = "maintenance" | "housekeeping";

/**
 * Optional Prisma filters applied to underlying queries so summaries
 * respect sector/location scope without duplicating auth logic here.
 */
export type AnalyticsScopeFilters = {
  taskWhere?: Prisma.CleaningTaskWhereInput;
  ticketWhere?: Prisma.MaintenanceTicketWhereInput;
  locationWhere?: Prisma.LocationWhereInput;
  sessionWhere?: Prisma.CleaningSessionWhereInput;
};
