/**
 * Sector read APIs: list (scoped), "my" sectors for a supervisor, get by id.
 */
import type { Prisma } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ./format for this service.
import { mapSector, sectorInclude } from "./format";

/** List sectors; `scopeFilter` ANDed for data-scoped callers. */
export async function listSectors(
  // Update include inactive as control flow progresses.
  includeInactive = false,
  // Run next step: scopeFilter?: Prisma.SectorWhereInput,
  scopeFilter?: Prisma.SectorWhereInput,
// Run next step: ) {
) {
  // Default hides inactive; scopeFilter further restricts for supervisors.
  const rows = await prisma.sector.findMany({
    // Set where on the structure being built.
    where: {
      // Run next step: ...(includeInactive ? {} : { isActive: true }),
      ...(includeInactive ? {} : { isActive: true }),
      // Run next step: ...(scopeFilter ?? {}),
      ...(scopeFilter ?? {}),
    },
    // Set include on the structure being built.
    include: sectorInclude,
    // Set orderBy on the structure being built.
    orderBy: [{ code: "asc" }],
  });
  // Return the computed result to the caller.
  return rows.map(mapSector);
}

/** Active sectors where the employee is primary supervisor (§5 „свои сектори“). */
export async function listMySectors(employeeId: string) {
  // Supervisor home list — only sectors they primarily own.
  const rows = await prisma.sector.findMany({
    // Set where on the structure being built.
    where: {
      // Set primarySupervisorEmployeeId on the structure being built.
      primarySupervisorEmployeeId: employeeId,
      // Set isActive on the structure being built.
      isActive: true,
    },
    // Set include on the structure being built.
    include: sectorInclude,
    // Set orderBy on the structure being built.
    orderBy: [{ code: "asc" }],
  });
  // Return the computed result to the caller.
  return rows.map(mapSector);
}

/** Single sector by id, or 404. */
export async function getSector(id: string) {
  // Full include for the sector editor / membership UI.
  const sector = await prisma.sector.findUnique({
    // Set where on the structure being built.
    where: { id },
    // Set include on the structure being built.
    include: sectorInclude,
  });
  // Branch when this condition holds so the right path runs.
  if (!sector) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Sector not found");
  }
  // Return the computed result to the caller.
  return mapSector(sector);
}
