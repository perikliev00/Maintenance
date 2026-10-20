/**
 * Sector location membership: scope checks and TOCTOU-safe replaceMembership.
 *
 * Lock protocol (Postgres):
 * 1. Sector FOR NO KEY UPDATE — serializes writers to this sector without
 *    conflicting with KEY SHARE taken by CleaningTask FK inserts, and with
 *    SSE delivery FOR SHARE on the subscriber's sectors.
 * 2. Location FOR UPDATE (ORDER BY id) for requested + current members.
 * 3. Re-read destination members; if any unlocked id appeared, expand locks
 *    and retry until currentMembers ⊆ lockedSet (avoids deleteMany removing
 *    a room whose Location was never locked).
 * 4. Auth re-check + writes under those locks.
 *
 * Supervisor User FOR UPDATE is intentionally not taken here: that lock order
 * (User before Location) deadlocks Location-first holders. Live delivery
 * instead takes Sector FOR SHARE after resolving scope (see liveAuthorization).
 */
import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes } from "@prisma/client";
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

async function lockSectorNoKeyUpdate(
  tx: PrismaTypes.TransactionClient,
  sectorId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT id FROM "Sector" WHERE id = ${sectorId} FOR NO KEY UPDATE
  `;
}

async function lockLocationsForUpdate(
  tx: PrismaTypes.TransactionClient,
  locationIds: string[],
): Promise<void> {
  if (!locationIds.length) return;
  // Stable order avoids deadlocks between concurrent membership replaces.
  const ordered = [...locationIds].sort();
  await tx.$executeRaw`
    SELECT id FROM "Location"
    WHERE id IN (${Prisma.join(ordered)})
    ORDER BY id
    FOR UPDATE
  `;
}

async function currentMemberIds(
  tx: PrismaTypes.TransactionClient,
  sectorId: string,
): Promise<string[]> {
  const rows = await tx.sectorLocation.findMany({
    where: { sectorId },
    select: { locationId: true },
  });
  return rows.map((r) => r.locationId);
}

/**
 * Authoritative membership replace: destination + per-location source checks
 * run inside the same transaction as the writes (TOCTOU-safe under row locks).
 *
 * - Rebalance among own sectors (kind=sectors, source in sectorIds): allowed.
 * - Unassigned / foreign / any inter-sector move for kind=all: requires
 *   allowCrossSectorTransfer.
 */
export async function replaceMembership(
  tx: PrismaTypes.TransactionClient,
  sectorId: string,
  locationIds: string[],
  auth: SectorMembershipAuth,
) {
  // Fail fast if the destination itself is outside the actor's scope.
  await assertDestinationInScope(auth.scope, sectorId);

  // Deduplicate so createMany does not hit unique constraints.
  const unique = [...new Set(locationIds)];

  // Serialize writers targeting this sector (compatible with CleaningTask KEY SHARE).
  await lockSectorNoKeyUpdate(tx, sectorId);

  if (unique.length) {
    // Reject unknown location ids before mutating membership.
    const found = await tx.location.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new AppError(400, "validation", "One or more locations not found");
    }
  }

  // Lock requested locations + current destination members; expand if re-read grows.
  const locked = new Set<string>();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const members = await currentMemberIds(tx, sectorId);
    const needed = new Set<string>([...unique, ...members]);
    const missing = [...needed].filter((id) => !locked.has(id));
    if (missing.length) {
      await lockLocationsForUpdate(tx, missing);
      for (const id of missing) locked.add(id);
      continue;
    }
    // Re-read after locks: another writer may have added a member while we waited.
    const membersAfter = await currentMemberIds(tx, sectorId);
    const stale = membersAfter.filter((id) => !locked.has(id));
    if (stale.length) {
      await lockLocationsForUpdate(tx, stale);
      for (const id of stale) locked.add(id);
      continue;
    }
    break;
  }

  // Final member coverage check.
  {
    const membersFinal = await currentMemberIds(tx, sectorId);
    const uncovered = membersFinal.filter((id) => !locked.has(id));
    if (uncovered.length) {
      throw new AppError(
        409,
        "conflict",
        "Sector membership changed concurrently; retry",
      );
    }
  }

  if (unique.length) {
    // Current sector for each location (null = unassigned) — under Location locks.
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
