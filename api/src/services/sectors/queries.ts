import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { mapSector, sectorInclude } from "./format";

export async function listSectors(
  includeInactive = false,
  scopeFilter?: Prisma.SectorWhereInput,
) {
  const rows = await prisma.sector.findMany({
    where: {
      ...(includeInactive ? {} : { isActive: true }),
      ...(scopeFilter ?? {}),
    },
    include: sectorInclude,
    orderBy: [{ code: "asc" }],
  });
  return rows.map(mapSector);
}

/** Active sectors where the employee is primary supervisor (§5 „свои сектори“). */
export async function listMySectors(employeeId: string) {
  const rows = await prisma.sector.findMany({
    where: {
      primarySupervisorEmployeeId: employeeId,
      isActive: true,
    },
    include: sectorInclude,
    orderBy: [{ code: "asc" }],
  });
  return rows.map(mapSector);
}

export async function getSector(id: string) {
  const sector = await prisma.sector.findUnique({
    where: { id },
    include: sectorInclude,
  });
  if (!sector) {
    throw new AppError(404, "not_found", "Sector not found");
  }
  return mapSector(sector);
}
