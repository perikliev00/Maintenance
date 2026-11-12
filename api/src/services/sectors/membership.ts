/**
 * Sector location membership: scope checks and TOCTOU-safe replaceMembership.
 *
 * Lock protocol (Postgres):
 * 1. All involved Sector rows (destination + candidate sources) FOR NO KEY
 *    UPDATE in stable id order — serializes writers without conflicting with
 *    KEY SHARE from CleaningTask FK inserts, and with SSE FOR SHARE.
 * 2. Location FOR UPDATE (ORDER BY id) for requested + current members.
 * 3. Re-read destination members; if any unlocked id appeared, expand locks
 *    and retry until currentMembers ⊆ lockedSet (avoids deleteMany removing
 *    a room whose Location was never locked).
 * 4. Auth re-check + writes under those locks.
 * 5. Source sectors that lose rooms get version++ and an audit event so a
 *    stale full-replace on the source cannot CAS-succeed and pull rooms back.
 *
 * Supervisor User FOR UPDATE is intentionally not taken here: that lock order
 * (User before Location) deadlocks Location-first holders. Live delivery
 * instead takes Sector FOR SHARE after resolving scope (see liveAuthorization).
 * Callers that change supervisor/isActive must take User locks before Sector
 * (see saveSector).
 */
import { Prisma } from "@prisma/client";
// Import type(s) Prisma as PrismaTypes for typing without runtime cost.
import type { Prisma as PrismaTypes } from "@prisma/client";
import { AppError } from "../../errors";
import { recordAudit } from "../audit";
// Import type(s) DataScope for typing without runtime cost.
import type { DataScope } from "../dataScope";

// Capture out of scope for use in this scope.
const OUT_OF_SCOPE = "Outside your permitted data scope";

/** Actor scope plus whether they may pull locations from foreign/unassigned sectors. */
export type SectorMembershipAuth = {
  scope: DataScope;
  allowCrossSectorTransfer: boolean;
};

// Declare type ReplaceMembershipOptions for callers and internals.
export type ReplaceMembershipOptions = {
  actorEmployeeId?: string;
  /**
   * Sector ids already locked by the caller in sorted order (destination +
   * peeked sources). When set, this function will not take Sector locks again
   * unless a new source appears — in which case it fails closed with 409.
   */
  preLockedSectorIds?: readonly string[];
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

async function lockSectorsNoKeyUpdateSorted(
  tx: PrismaTypes.TransactionClient,
  sectorIds: readonly string[],
): Promise<string[]> {
  // Collect ordered list for later processing.
  const ordered = [...new Set(sectorIds)].sort();
  // Iterate items to apply the same logic to each entry.
  for (const sectorId of ordered) {
    await tx.$executeRaw`
      SELECT id FROM "Sector" WHERE id = ${sectorId} FOR NO KEY UPDATE
    `;
  }
  return ordered;
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

/** Peek current sector owners of locations (no row locks). */
export async function peekSourceSectorIds(
  tx: PrismaTypes.TransactionClient,
  locationIds: readonly string[],
  destinationSectorId: string,
): Promise<string[]> {
  if (!locationIds.length) return [];
  const memberships = await tx.sectorLocation.findMany({
    where: { locationId: { in: [...locationIds] } },
    select: { sectorId: true },
  });
  return [
    ...new Set(
      memberships
        // Continue the chained call from the previous expression.
        .map((m) => m.sectorId)
        // Continue the chained call from the previous expression.
        .filter((id) => id !== destinationSectorId),
    ),
  ];
}

/**
 * Authoritative membership replace: destination + per-location source checks
 * run inside the same transaction as the writes (TOCTOU-safe under row locks).
 *
 * - Rebalance among own sectors (kind=sectors, source in sectorIds): allowed.
 * - Unassigned / foreign / any inter-sector move for kind=all: requires
 *   allowCrossSectorTransfer.
 * - Source sectors that lose rooms are version-bumped and audited (R2).
 */
export async function replaceMembership(
  tx: PrismaTypes.TransactionClient,
  sectorId: string,
  locationIds: string[],
  auth: SectorMembershipAuth,
  options: ReplaceMembershipOptions = {},
) {
  // Fail fast if the destination itself is outside the actor's scope.
  await assertDestinationInScope(auth.scope, sectorId);

  // Deduplicate so createMany does not hit unique constraints.
  const unique = [...new Set(locationIds)];

  // Capture pre locked for use in this scope.
  const preLocked = new Set(options.preLockedSectorIds ?? []);
  // Capture locked sector ids for use in this scope.
  let lockedSectorIds: Set<string>;

  if (options.preLockedSectorIds) {
    if (!preLocked.has(sectorId)) {
      // Abort with an error so callers can react.
      throw new AppError(
        500,
        "internal",
        "replaceMembership preLockedSectorIds must include the destination",
      );
    }
    // Update locked sector ids as control flow progresses.
    lockedSectorIds = preLocked;
  } else {
    const candidates = await peekSourceSectorIds(tx, unique, sectorId);
    const ordered = await lockSectorsNoKeyUpdateSorted(tx, [
      sectorId,
      ...candidates,
    ]);
    // Update locked sector ids as control flow progresses.
    lockedSectorIds = new Set(ordered);
  }

  if (unique.length) {
    // Reject unknown location ids before mutating membership.
    const found = await tx.location.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      // Abort with an error so callers can react.
      throw new AppError(400, "validation", "One or more locations not found");
    }
  }

  // Lock requested locations + current destination members; expand if re-read grows.
  const locked = new Set<string>();
  // Iterate items to apply the same logic to each entry.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const members = await currentMemberIds(tx, sectorId);
    const needed = new Set<string>([...unique, ...members]);
    // Collect missing list for later processing.
    const missing = [...needed].filter((id) => !locked.has(id));
    if (missing.length) {
      await lockLocationsForUpdate(tx, missing);
      // Iterate items to apply the same logic to each entry.
      for (const id of missing) locked.add(id);
      // Skip to the next loop iteration.
      continue;
    }
    // Re-read after locks: another writer may have added a member while we waited.
    const membersAfter = await currentMemberIds(tx, sectorId);
    const stale = membersAfter.filter((id) => !locked.has(id));
    if (stale.length) {
      await lockLocationsForUpdate(tx, stale);
      // Iterate items to apply the same logic to each entry.
      for (const id of stale) locked.add(id);
      // Skip to the next loop iteration.
      continue;
    }
    // Leave the current loop or switch.
    break;
  }

  // Final member coverage check.
  {
    // Load members final asynchronously for the next steps.
    const membersFinal = await currentMemberIds(tx, sectorId);
    const uncovered = membersFinal.filter((id) => !locked.has(id));
    if (uncovered.length) {
      // Abort with an error so callers can react.
      throw new AppError(
        409,
        "conflict",
        "Sector membership changed concurrently; retry",
      );
    }
  }

  /** locationId → source sector (excluding destination / unassigned). */
  const detachBySource = new Map<string, string[]>();

  if (unique.length) {
    // Current sector for each location (null = unassigned) — under Location locks.
    const memberships = await tx.sectorLocation.findMany({
      where: { locationId: { in: unique } },
      select: { locationId: true, sectorId: true },
    });
    // Capture source by location for use in this scope.
    const sourceByLocation = new Map(
      memberships.map((m) => [m.locationId, m.sectorId]),
    );

    // Per-location transfer auth inside the same transaction (TOCTOU-safe).
    for (const locationId of unique) {
      // Capture source sector id for use in this scope.
      const sourceSectorId = sourceByLocation.get(locationId) ?? null;
      assertLocationTransferAllowed(auth, sectorId, sourceSectorId);
      if (sourceSectorId && sourceSectorId !== sectorId) {
        const list = detachBySource.get(sourceSectorId) ?? [];
        // Append an entry to the accumulating collection.
        list.push(locationId);
        // Store a keyed value for later lookup.
        detachBySource.set(sourceSectorId, list);
      }
    }

    // Fail closed if a source appeared that we did not pre-lock (avoids
    // Sector-after-Location lock expansion / AB-BA deadlock with peers).
    for (const sourceId of detachBySource.keys()) {
      if (!lockedSectorIds.has(sourceId)) {
        // Abort with an error so callers can react.
        throw new AppError(
          409,
          "conflict",
          "Sector membership sources changed concurrently; retry",
        );
      }
    }

    // Snapshot source membership before detach (for audit before.locationIds).
    const sourceBefore = new Map<string, string[]>();
    // Iterate items to apply the same logic to each entry.
    for (const sourceId of detachBySource.keys()) {
      // Store a keyed value for later lookup.
      sourceBefore.set(sourceId, await currentMemberIds(tx, sourceId));
    }

    // Detach these locations from any other sector before re-adding here.
    await tx.sectorLocation.deleteMany({
      where: {
        locationId: { in: unique },
        sectorId: { not: sectorId },
      },
    });

    // R2: bump + audit each source that lost rooms.
    for (const [sourceId, removedIds] of detachBySource) {
      // Capture before locations for use in this scope.
      const beforeLocations = sourceBefore.get(sourceId) ?? [];
      const source = await tx.sector.findUnique({
        where: { id: sourceId },
        select: {
          id: true,
          code: true,
          version: true,
        },
      });
      if (!source) continue;

      // Load after locations asynchronously for the next steps.
      const afterLocations = await currentMemberIds(tx, sourceId);
      const updated = await tx.sector.update({
        where: { id: sourceId },
        data: { version: { increment: 1 } },
        select: { version: true, code: true },
      });

      await recordAudit(
        {
          actorEmployeeId: options.actorEmployeeId,
          action: "sector.update",
          entityType: "sector",
          entityId: sourceId,
          before: {
            code: source.code,
            version: source.version,
            locationIds: beforeLocations,
            removedLocationIds: removedIds,
          },
          after: {
            code: updated.code,
            version: updated.version,
            locationIds: afterLocations,
          },
          summary: `Membership reduced on sector ${source.code} by cross-sector transfer`,
        },
        tx,
      );
    }
  }

  // Clear existing membership for this sector, then insert the new set.
  await tx.sectorLocation.deleteMany({ where: { sectorId } });
  if (unique.length) {
    await tx.sectorLocation.createMany({
      data: unique.map((locationId) => ({ sectorId, locationId })),
    });
  }
}
