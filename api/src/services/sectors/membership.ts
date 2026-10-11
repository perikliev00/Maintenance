import type { Prisma } from "@prisma/client";
import { AppError } from "../../errors";
import type { DataScope } from "../dataScope";

const OUT_OF_SCOPE = "Outside your permitted data scope";

export type SectorMembershipAuth = {
  scope: DataScope;
  allowCrossSectorTransfer: boolean;
};

async function assertDestinationInScope(
  scope: DataScope,
  sectorId: string,
): Promise<void> {
  if (scope.kind === "all") return;
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
  if (sourceSectorId === destinationSectorId) return;

  const sourceInOwnSectors =
    auth.scope.kind === "sectors" &&
    sourceSectorId != null &&
    auth.scope.sectorIds.includes(sourceSectorId);

  if (sourceInOwnSectors) return;

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
  await assertDestinationInScope(auth.scope, sectorId);

  const unique = [...new Set(locationIds)];
  if (unique.length) {
    const found = await tx.location.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new AppError(400, "validation", "One or more locations not found");
    }

    const memberships = await tx.sectorLocation.findMany({
      where: { locationId: { in: unique } },
      select: { locationId: true, sectorId: true },
    });
    const sourceByLocation = new Map(
      memberships.map((m) => [m.locationId, m.sectorId]),
    );

    for (const locationId of unique) {
      const sourceSectorId = sourceByLocation.get(locationId) ?? null;
      assertLocationTransferAllowed(auth, sectorId, sourceSectorId);
    }

    await tx.sectorLocation.deleteMany({
      where: {
        locationId: { in: unique },
        sectorId: { not: sectorId },
      },
    });
  }
  await tx.sectorLocation.deleteMany({ where: { sectorId } });
  if (unique.length) {
    await tx.sectorLocation.createMany({
      data: unique.map((locationId) => ({ sectorId, locationId })),
    });
  }
}
