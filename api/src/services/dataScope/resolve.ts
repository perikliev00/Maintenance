/**
 * Map an authenticated user to a {@link DataScope} based on role.
 * Supervisors get active sectors they primarily supervise.
 */
import { Role, type Prisma } from "@prisma/client";
import { prisma } from "../../db";
import type { AuthUser } from "../../auth/tokens";
import type { DataScope } from "./types";

/**
 * Resolve list/mutation scope for the current auth user.
 * Unknown / future roles default to the narrowest task-scoped view.
 */
export async function resolveDataScope(user: AuthUser, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<DataScope> {
  // Common identity fields shared by every scope kind.
  const base = {
    employeeId: user.employeeId,
    role: user.role,
  };

  switch (user.role) {
    // Hotel-wide roles see every location; sectorIds unused.
    case Role.owner:
    case Role.manager:
    case Role.admin:
    case Role.reception:
      return { ...base, kind: "all", sectorIds: [] };

    case Role.supervisor: {
      // Only active sectors where this employee is the primary supervisor.
      const sectors = await db.sector.findMany({
        where: {
          primarySupervisorEmployeeId: user.employeeId,
          isActive: true,
        },
        select: { id: true },
      });
      // Empty list is intentional — where-builders use a sentinel, not "all".
      return {
        ...base,
        kind: "sectors",
        sectorIds: sectors.map((s) => s.id),
      };
    }

    // Housekeepers only see cleaning work assigned to them.
    case Role.housekeeper:
      return { ...base, kind: "assigned_tasks", sectorIds: [] };

    // Technicians only see maintenance tickets assigned to them.
    case Role.technician:
      return { ...base, kind: "assigned_tickets", sectorIds: [] };

    // Unknown / future roles default to the narrowest task-scoped view.
    default:
      return { ...base, kind: "assigned_tasks", sectorIds: [] };
  }
}
