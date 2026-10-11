import { Prisma } from "@prisma/client";

export type AnalyticsDomain = "maintenance" | "housekeeping";

export type AnalyticsScopeFilters = {
  taskWhere?: Prisma.CleaningTaskWhereInput;
  ticketWhere?: Prisma.MaintenanceTicketWhereInput;
  locationWhere?: Prisma.LocationWhereInput;
  sessionWhere?: Prisma.CleaningSessionWhereInput;
};
