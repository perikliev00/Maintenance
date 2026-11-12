/**
 * Map an authenticated user to a {@link DataScope} based on role.
 * Supervisors get active sectors they primarily supervise.
 */
import { Role, type Prisma } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import type(s) AuthUser for typing without runtime cost.
import type { AuthUser } from "../../auth/tokens";
// Import type(s) DataScope for typing without runtime cost.
import type { DataScope } from "./types";

/**
 * Resolve list/mutation scope for the current auth user.
 * Unknown / future roles default to the narrowest task-scoped view.
 */
export async function resolveDataScope(user: AuthUser, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<DataScope> {
  // Common identity fields shared by every scope kind.
  const base = {
    // Set employeeId on the structure being built.
    employeeId: user.employeeId,
    // Set role on the structure being built.
    role: user.role,
  };

  // Dispatch on the discriminant to pick the matching case.
  switch (user.role) {
    // Hotel-wide roles see every location; sectorIds unused.
    case Role.owner:
    // Handle this specific case value.
    case Role.manager:
    // Handle this specific case value.
    case Role.admin:
    // Handle this specific case value.
    case Role.reception:
      // Return the computed result to the caller.
      return { ...base, kind: "all", sectorIds: [] };

    // Handle this specific case value.
    case Role.supervisor: {
      // Only active sectors where this employee is the primary supervisor.
      const sectors = await db.sector.findMany({
        // Set where on the structure being built.
        where: {
          // Set primarySupervisorEmployeeId on the structure being built.
          primarySupervisorEmployeeId: user.employeeId,
          // Set isActive on the structure being built.
          isActive: true,
        },
        // Set select on the structure being built.
        select: { id: true },
      });
      // Empty list is intentional — where-builders use a sentinel, not "all".
      return {
        // Run next step: ...base,
        ...base,
        // Set kind on the structure being built.
        kind: "sectors",
        // Set sectorIds on the structure being built.
        sectorIds: sectors.map((s) => s.id),
      };
    }

    // Housekeepers only see cleaning work assigned to them.
    case Role.housekeeper:
      // Return the computed result to the caller.
      return { ...base, kind: "assigned_tasks", sectorIds: [] };

    // Technicians only see maintenance tickets assigned to them.
    case Role.technician:
      // Return the computed result to the caller.
      return { ...base, kind: "assigned_tickets", sectorIds: [] };

    // Unknown / future roles default to the narrowest task-scoped view.
    default:
      // Return the computed result to the caller.
      return { ...base, kind: "assigned_tasks", sectorIds: [] };
  }
}
