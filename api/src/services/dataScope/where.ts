/**
 * Prisma where-builders that restrict queries to a caller's {@link DataScope}.
 * Empty sector lists use a non-matching sentinel id so "no sectors" ≠ "all".
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
// Import type(s) DataScope for typing without runtime cost.
import type { DataScope } from "./types";

/**
 * Cleaning-task filter for the given scope.
 * Sentinel `__none__` matches nothing when the role has an empty sector list.
 */
export function taskWhere(scope: DataScope): Prisma.CleaningTaskWhereInput {
  // Dispatch on the discriminant to pick the matching case.
  switch (scope.kind) {
    // Hotel-wide roles: no task restriction.
    case "all":
      return {};
    // Handle this specific case value.
    case "sectors":
      // Empty sector list must not match everything — use a sentinel id.
      if (scope.sectorIds.length === 0) {
        return { id: "__none__" };
      }
      // Match snapshotted sectorId or live membership when snapshot is null.
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
    // Housekeepers: only tasks assigned to them.
    case "assigned_tasks":
      return { assignedEmployeeId: scope.employeeId };
    // Handle this specific case value.
    case "assigned_tickets":
      // Technicians do not get a cleaning-task queue by default.
      return { id: "__none__" };
  }
}

/**
 * Location filter for the given scope.
 * Field roles see rooms linked to their own tasks/tickets.
 */
export function locationWhere(scope: DataScope): Prisma.LocationWhereInput {
  // Dispatch on the discriminant to pick the matching case.
  switch (scope.kind) {
    // Hotel-wide roles: no location restriction.
    case "all":
      return {};
    // Handle this specific case value.
    case "sectors":
      // Empty supervisor sector list → match nothing.
      if (scope.sectorIds.length === 0) {
        return { id: "__none__" };
      }
      // Live SectorLocation membership for the supervisor's sectors.
      return {
        sectorMembership: { sectorId: { in: scope.sectorIds } },
      };
    // Housekeepers see rooms they have cleaning work on.
    case "assigned_tasks":
      return {
        cleaningTasks: {
          some: { assignedEmployeeId: scope.employeeId },
        },
      };
    // Technicians see rooms with tickets assigned to them.
    case "assigned_tickets":
      return {
        maintenanceTickets: {
          some: { assigneeId: scope.employeeId },
        },
      };
  }
}

/**
 * Maintenance-ticket filter for the given scope.
 * Housekeepers see own reports plus tickets on rooms they clean.
 */
export function ticketWhere(scope: DataScope): Prisma.MaintenanceTicketWhereInput {
  // Dispatch on the discriminant to pick the matching case.
  switch (scope.kind) {
    // Hotel-wide roles: no ticket restriction.
    case "all":
      return {};
    // Handle this specific case value.
    case "sectors":
      // Empty supervisor sector list → match nothing.
      if (scope.sectorIds.length === 0) {
        return { id: "__none__" };
      }
      // Tickets whose location sits in one of the supervisor's sectors.
      return {
        location: {
          sectorMembership: { sectorId: { in: scope.sectorIds } },
        },
      };
    // Handle this specific case value.
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
    // Technicians: only tickets assigned to them.
    case "assigned_tickets":
      return { assigneeId: scope.employeeId };
  }
}

/**
 * Session filter via nested task scope (empty when unrestricted).
 * Delegates to {@link taskWhere} so sector/assignee rules stay in one place.
 */
export function sessionTaskWhere(scope: DataScope): Prisma.CleaningSessionWhereInput {
  const tw = taskWhere(scope);
  // Unrestricted taskWhere → no session restriction either.
  if (Object.keys(tw).length === 0) return {};
  // Nest the task predicate under the session → task relation.
  return { task: tw };
}

/**
 * Sector filter; assigned_* roles see no sectors.
 * Empty sector lists again use the `__none__` sentinel.
 */
export function sectorWhere(scope: DataScope): Prisma.SectorWhereInput {
  // Dispatch on the discriminant to pick the matching case.
  switch (scope.kind) {
    // Hotel-wide roles: browse every sector.
    case "all":
      return {};
    // Handle this specific case value.
    case "sectors":
      // Empty supervisor list → match nothing.
      if (scope.sectorIds.length === 0) {
        return { id: "__none__" };
      }
      return { id: { in: scope.sectorIds } };
    // Field roles do not browse the sector catalog.
    case "assigned_tasks":
    // Handle this specific case value.
    case "assigned_tickets":
      return { id: "__none__" };
  }
}

/**
 * Location IDs visible under this scope, or null when scope is unrestricted.
 * Callers use null to skip `IN` filters entirely.
 */
export async function scopedLocationIdsFor(
  scope: DataScope,
): Promise<string[] | null> {
  // null = unrestricted (callers skip IN filters).
  if (scope.kind === "all") return null;
  // Build the same location predicate used by list queries.
  const where = locationWhere(scope);
  // Defensive: empty where object also means unrestricted.
  if (Object.keys(where).length === 0) return null;
  // Materialize ids for audit / notification scope filters.
  const rows = await prisma.location.findMany({
    where,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
