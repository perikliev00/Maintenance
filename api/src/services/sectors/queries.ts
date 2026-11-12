/**
 * Sector read APIs: list (scoped), "my" sectors for a supervisor, get by id.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { mapSector, sectorInclude } from "./format";

/** List sectors; `scopeFilter` ANDed for data-scoped callers. */
export async function listSectors(
  // Update include inactive as control flow progresses.
  includeInactive = false,
  scopeFilter?: Prisma.SectorWhereInput,
) {
  // Default hides inactive; scopeFilter further restricts for supervisors.
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
  // Supervisor home list — only sectors they primarily own.
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

/** Single sector by id, or 404. */
export async function getSector(id: string) {
  // Full include for the sector editor / membership UI.
  const sector = await prisma.sector.findUnique({
    where: { id },
    include: sectorInclude,
  });
  if (!sector) {
    throw new AppError(404, "not_found", "Sector not found");
  }
  return mapSector(sector);
}
