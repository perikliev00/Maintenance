import { Prisma } from "@prisma/client";
import { prisma } from "../../db";

/** Current sector membership for a location (for snapshots). */
export async function sectorIdForLocation(
  locationId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string | null> {
  const membership = await client.sectorLocation.findUnique({
    where: { locationId },
    select: { sectorId: true },
  });
  return membership?.sectorId ?? null;
}

/** Sector id + primary supervisor at snapshot time for a location. */
export async function sectorSnapshotForLocation(
  locationId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ sectorId: string | null; sectorSupervisorEmployeeId: string | null }> {
  const membership = await client.sectorLocation.findUnique({
    where: { locationId },
    select: {
      sectorId: true,
      sector: { select: { primarySupervisorEmployeeId: true } },
    },
  });
  if (!membership) {
    return { sectorId: null, sectorSupervisorEmployeeId: null };
  }
  return {
    sectorId: membership.sectorId,
    sectorSupervisorEmployeeId:
      membership.sector.primarySupervisorEmployeeId ?? null,
  };
}

/** Supervisor snapshot for an already-known sector id. */
export async function sectorSupervisorForSector(
  sectorId: string | null,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string | null> {
  if (!sectorId) return null;
  const sector = await client.sector.findUnique({
    where: { id: sectorId },
    select: { primarySupervisorEmployeeId: true },
  });
  return sector?.primarySupervisorEmployeeId ?? null;
}
