import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import type { DataScope } from "./types";

export function taskWhere(scope: DataScope): Prisma.CleaningTaskWhereInput {
  switch (scope.kind) {
    case "all":
      return {};
    case "sectors":
      if (scope.sectorIds.length === 0) {
        return { id: "__none__" };
      }
      return {
        OR: [
          { sectorId: { in: scope.sectorIds } },
          {
            sectorId: null,
            location: {
              sectorMembership: { sectorId: { in: scope.sectorIds } },
            },
          },
        ],
      };
    case "assigned_tasks":
      return { assignedEmployeeId: scope.employeeId };
    case "assigned_tickets":
      // Technicians do not get a cleaning-task queue by default.
      return { id: "__none__" };
  }
}

export function locationWhere(scope: DataScope): Prisma.LocationWhereInput {
  switch (scope.kind) {
    case "all":
      return {};
    case "sectors":
      if (scope.sectorIds.length === 0) {
        return { id: "__none__" };
      }
      return {
        sectorMembership: { sectorId: { in: scope.sectorIds } },
      };
    case "assigned_tasks":
      return {
        cleaningTasks: {
          some: { assignedEmployeeId: scope.employeeId },
        },
      };
    case "assigned_tickets":
      return {
        maintenanceTickets: {
          some: { assigneeId: scope.employeeId },
        },
      };
  }
}

export function ticketWhere(scope: DataScope): Prisma.MaintenanceTicketWhereInput {
  switch (scope.kind) {
    case "all":
      return {};
    case "sectors":
      if (scope.sectorIds.length === 0) {
        return { id: "__none__" };
      }
      return {
        location: {
          sectorMembership: { sectorId: { in: scope.sectorIds } },
        },
      };
    case "assigned_tasks":
      // Housekeeper: own reports + tickets on rooms they are assigned to clean.
      return {
        OR: [
          { reportedByEmployeeId: scope.employeeId },
          {
            location: {
              cleaningTasks: {
                some: { assignedEmployeeId: scope.employeeId },
              },
            },
          },
        ],
      };
    case "assigned_tickets":
      return { assigneeId: scope.employeeId };
  }
}

export function sessionTaskWhere(scope: DataScope): Prisma.CleaningSessionWhereInput {
  const tw = taskWhere(scope);
  if (Object.keys(tw).length === 0) return {};
  return { task: tw };
}

export function sectorWhere(scope: DataScope): Prisma.SectorWhereInput {
  switch (scope.kind) {
    case "all":
      return {};
    case "sectors":
      if (scope.sectorIds.length === 0) {
        return { id: "__none__" };
      }
      return { id: { in: scope.sectorIds } };
    case "assigned_tasks":
    case "assigned_tickets":
      return { id: "__none__" };
  }
}

/** Location IDs visible under this scope, or null when scope is unrestricted. */
export async function scopedLocationIdsFor(
  scope: DataScope,
): Promise<string[] | null> {
  if (scope.kind === "all") return null;
  const where = locationWhere(scope);
  if (Object.keys(where).length === 0) return null;
  const rows = await prisma.location.findMany({
    where,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
