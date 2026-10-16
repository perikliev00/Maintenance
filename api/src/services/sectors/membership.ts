/**
 * Sector location membership: scope checks and TOCTOU-safe replaceMembership.
 */
import type { Prisma } from "@prisma/client";
import { AppError } from "../../errors";
import type { DataScope } from "../dataScope";

const OUT_OF_SCOPE = "Outside your permitted data scope";

/** Actor scope plus whether they may pull locations from foreign/unassigned sectors. */
export type SectorMembershipAuth = {
  scope: DataScope;
  allowCrossSectorTransfer: boolean;
};

/** Ensure the actor may write membership into the destination sector. */
async function assertDestinationInScope(
  scope: DataScope,
  sectorId: string,
): Promise<void> {
  // Hotel-wide roles can target any sector.
  if (scope.kind === "all") return;
  // Supervisors may only write into sectors they primarily supervise.
  if (scope.kind === "sectors" && scope.sectorIds.includes(sectorId)) return;
  throw new AppError(403, "forbidden", OUT_OF_SCOPE);
}

/**
 * Pure decision: whether moving location from sourceSectorId → destinationSectorId
 * is allowed for this actor. Exported for unit tests.
 */
export function assertLocationTransferAllowed(
  auth: SectorMembershipAuth,
  destinationSectorId: string,
  sourceSectorId: string | null,
): void {
  // Already in destination — no-op transfer, always allowed.
  if (sourceSectorId === destinationSectorId) return;

  // Rebalancing among the supervisor's own sectors does not need the transfer flag.
  const sourceInOwnSectors =
    auth.scope.kind === "sectors" &&
    sourceSectorId != null &&
    auth.scope.sectorIds.includes(sourceSectorId);

  if (sourceInOwnSectors) return;

  // Unassigned / foreign sector moves require allowCrossSectorTransfer.
  if (!auth.allowCrossSectorTransfer) {
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
}

/**
 * Authoritative membership replace: destination + per-location source checks
 * run inside the same transaction as the writes (TOCTOU-safe).
 *
 * - Rebalance among own sectors (kind=sectors, source in sectorIds): allowed.
 * - Unassigned / foreign / any inter-sector move for kind=all: requires
 *   allowCrossSectorTransfer.
 */
export async function replaceMembership(
  tx: Prisma.TransactionClient,
  sectorId: string,
  locationIds: string[],
  auth: SectorMembershipAuth,
) {
  // Fail fast if the destination itself is outside the actor's scope.
  await assertDestinationInScope(auth.scope, sectorId);

  // Deduplicate so createMany does not hit unique constraints.
  const unique = [...new Set(locationIds)];
  if (unique.length) {
    // Reject unknown location ids before mutating membership.
    const found = await tx.location.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new AppError(400, "validation", "One or more locations not found");
    }

    // Current sector for each location (null = unassigned).
    const memberships = await tx.sectorLocation.findMany({
      where: { locationId: { in: unique } },
      select: { locationId: true, sectorId: true },
    });
    const sourceByLocation = new Map(
      memberships.map((m) => [m.locationId, m.sectorId]),
    );

    // Per-location transfer auth inside the same transaction (TOCTOU-safe).
    for (const locationId of unique) {
      const sourceSectorId = sourceByLocation.get(locationId) ?? null;
      assertLocationTransferAllowed(auth, sectorId, sourceSectorId);
    }

    // Detach these locations from any other sector before re-adding here.
    await tx.sectorLocation.deleteMany({
      where: {
        locationId: { in: unique },
        sectorId: { not: sectorId },
      },
    });
  }
  // Clear existing membership for this sector, then insert the new set.
  await tx.sectorLocation.deleteMany({ where: { sectorId } });
  if (unique.length) {
    await tx.sectorLocation.createMany({
      data: unique.map((locationId) => ({ sectorId, locationId })),
    });
  }
}
