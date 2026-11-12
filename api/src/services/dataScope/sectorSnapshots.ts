/**
 * Freeze sector membership onto tasks/tickets at create time so later sector
 * moves do not rewrite historical work ownership.
 */
import { Prisma } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";

/**
 * Sector id + primary supervisor at snapshot time for a location.
 * Unassigned locations snapshot as nulls (work is still creatable).
 */
export async function sectorSnapshotForLocation(
  // Set locationId on the structure being built.
  locationId: string,
  // Set client on the structure being built.
  client: Prisma.TransactionClient | typeof prisma = prisma,
// Run next step: ): Promise<{ sectorId: string | null; sectorSupervisorEmploy…
): Promise<{ sectorId: string | null; sectorSupervisorEmployeeId: string | null }> {
  // Current SectorLocation membership for this room/common area.
  const membership = await client.sectorLocation.findUnique({
    // Set where on the structure being built.
    where: { locationId },
    // Set select on the structure being built.
    select: {
      // Set sectorId on the structure being built.
      sectorId: true,
      // Set sector on the structure being built.
      sector: { select: { primarySupervisorEmployeeId: true } },
    },
  });
  // Unassigned locations snapshot as nulls (work is still creatable).
  if (!membership) {
    // Return the computed result to the caller.
    return { sectorId: null, sectorSupervisorEmployeeId: null };
  }
  // Stamp both sector and supervisor so notify paths work without a re-join.
  return {
    // Set sectorId on the structure being built.
    sectorId: membership.sectorId,
    // Supervisor may be unset even when the sector exists.
    sectorSupervisorEmployeeId:
      // Run next step: membership.sector.primarySupervisorEmployeeId ?? null,
      membership.sector.primarySupervisorEmployeeId ?? null,
  };
}

/**
 * Supervisor snapshot for an already-known sector id.
 * Returns null when sectorId is null or the sector has no primary supervisor.
 */
export async function sectorSupervisorForSector(
  // Set sectorId on the structure being built.
  sectorId: string | null,
  // Set client on the structure being built.
  client: Prisma.TransactionClient | typeof prisma = prisma,
// Run next step: ): Promise<string | null> {
): Promise<string | null> {
  // No sector → no supervisor to stamp.
  if (!sectorId) return null;
  // Load only the supervisor foreign key.
  const sector = await client.sector.findUnique({
    // Set where on the structure being built.
    where: { id: sectorId },
    // Set select on the structure being built.
    select: { primarySupervisorEmployeeId: true },
  });
  // Sector may exist without a primary supervisor configured.
  return sector?.primarySupervisorEmployeeId ?? null;
}
