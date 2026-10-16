/**
 * Freeze sector membership onto tasks/tickets at create time so later sector
 * moves do not rewrite historical work ownership.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../db";

/**
 * Sector id + primary supervisor at snapshot time for a location.
 * Unassigned locations snapshot as nulls (work is still creatable).
 */
export async function sectorSnapshotForLocation(
  locationId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ sectorId: string | null; sectorSupervisorEmployeeId: string | null }> {
  // Current SectorLocation membership for this room/common area.
  const membership = await client.sectorLocation.findUnique({
    where: { locationId },
    select: {
      sectorId: true,
      sector: { select: { primarySupervisorEmployeeId: true } },
    },
  });
  // Unassigned locations snapshot as nulls (work is still creatable).
  if (!membership) {
    return { sectorId: null, sectorSupervisorEmployeeId: null };
  }
  // Stamp both sector and supervisor so notify paths work without a re-join.
  return {
    sectorId: membership.sectorId,
    // Supervisor may be unset even when the sector exists.
    sectorSupervisorEmployeeId:
      membership.sector.primarySupervisorEmployeeId ?? null,
  };
}

/**
 * Supervisor snapshot for an already-known sector id.
 * Returns null when sectorId is null or the sector has no primary supervisor.
 */
export async function sectorSupervisorForSector(
  sectorId: string | null,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string | null> {
  // No sector → no supervisor to stamp.
  if (!sectorId) return null;
  // Load only the supervisor foreign key.
  const sector = await client.sector.findUnique({
    where: { id: sectorId },
    select: { primarySupervisorEmployeeId: true },
  });
  // Sector may exist without a primary supervisor configured.
  return sector?.primarySupervisorEmployeeId ?? null;
}
