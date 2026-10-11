import { Role } from "@prisma/client";
import { prisma } from "../../db";
import type { AuthUser } from "../../middleware/auth";
import type { DataScope } from "./types";

export async function resolveDataScope(user: AuthUser): Promise<DataScope> {
  const base = {
    employeeId: user.employeeId,
    role: user.role,
  };

  switch (user.role) {
    case Role.owner:
    case Role.manager:
    case Role.admin:
    case Role.reception:
      return { ...base, kind: "all", sectorIds: [] };

    case Role.supervisor: {
      const sectors = await prisma.sector.findMany({
        where: {
          primarySupervisorEmployeeId: user.employeeId,
          isActive: true,
        },
        select: { id: true },
      });
      return {
        ...base,
        kind: "sectors",
        sectorIds: sectors.map((s) => s.id),
      };
    }

    case Role.housekeeper:
      return { ...base, kind: "assigned_tasks", sectorIds: [] };

    case Role.technician:
      return { ...base, kind: "assigned_tickets", sectorIds: [] };

    default:
      return { ...base, kind: "assigned_tasks", sectorIds: [] };
  }
}
