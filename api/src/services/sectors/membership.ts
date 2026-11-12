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
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../audit for this service.
import { recordAudit } from "../audit";
// Import type(s) DataScope for typing without runtime cost.
import type { DataScope } from "../dataScope";

// Capture out of scope for use in this scope.
const OUT_OF_SCOPE = "Outside your permitted data scope";

/** Actor scope plus whether they may pull locations from foreign/unassigned sectors. */
export type SectorMembershipAuth = {
  // Set scope on the structure being built.
  scope: DataScope;
  // Set allowCrossSectorTransfer on the structure being built.
  allowCrossSectorTransfer: boolean;
};

// Declare type ReplaceMembershipOptions for callers and internals.
export type ReplaceMembershipOptions = {
  // Run next step: actorEmployeeId?: string;
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
  // Set scope on the structure being built.
  scope: DataScope,
  // Set sectorId on the structure being built.
  sectorId: string,
// Run next step: ): Promise<void> {
): Promise<void> {
  // Hotel-wide roles can target any sector.
  if (scope.kind === "all") return;
  // Supervisors may only write into sectors they primarily supervise.
  if (scope.kind === "sectors" && scope.sectorIds.includes(sectorId)) return;
  // Abort with an error so callers can react.
  throw new AppError(403, "forbidden", OUT_OF_SCOPE);
}

/**
 * Pure decision: whether moving location from sourceSectorId → destinationSectorId
 * is allowed for this actor. Exported for unit tests.
 */
export function assertLocationTransferAllowed(
  // Set auth on the structure being built.
  auth: SectorMembershipAuth,
  // Set destinationSectorId on the structure being built.
  destinationSectorId: string,
  // Set sourceSectorId on the structure being built.
  sourceSectorId: string | null,
// Run next step: ): void {
): void {
  // Already in destination — no-op transfer, always allowed.
  if (sourceSectorId === destinationSectorId) return;

  // Rebalancing among the supervisor's own sectors does not need the transfer flag.
  const sourceInOwnSectors =
    // Run next step: auth.scope.kind === "sectors" &&
    auth.scope.kind === "sectors" &&
    // Run next step: sourceSectorId != null &&
    sourceSectorId != null &&
    // Run next step: auth.scope.sectorIds.includes(sourceSectorId);
    auth.scope.sectorIds.includes(sourceSectorId);

  // Branch when this condition holds so the right path runs.
  if (sourceInOwnSectors) return;

  // Unassigned / foreign sector moves require allowCrossSectorTransfer.
  if (!auth.allowCrossSectorTransfer) {
    // Abort with an error so callers can react.
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
}

// Define lockSectorsNoKeyUpdateSorted — core behavior for this module.
async function lockSectorsNoKeyUpdateSorted(
  // Set tx on the structure being built.
  tx: PrismaTypes.TransactionClient,
  // Set sectorIds on the structure being built.
  sectorIds: readonly string[],
// Run next step: ): Promise<string[]> {
): Promise<string[]> {
  // Collect ordered list for later processing.
  const ordered = [...new Set(sectorIds)].sort();
  // Iterate items to apply the same logic to each entry.
  for (const sectorId of ordered) {
    // Wait for the async step before continuing.
    await tx.$executeRaw`
      SELECT id FROM "Sector" WHERE id = ${sectorId} FOR NO KEY UPDATE
    `;
  }
  // Return the computed result to the caller.
  return ordered;
}

// Define lockLocationsForUpdate — core behavior for this module.
async function lockLocationsForUpdate(
  // Set tx on the structure being built.
  tx: PrismaTypes.TransactionClient,
  // Set locationIds on the structure being built.
  locationIds: string[],
// Run next step: ): Promise<void> {
): Promise<void> {
  // Branch when this condition holds so the right path runs.
  if (!locationIds.length) return;
  // Stable order avoids deadlocks between concurrent membership replaces.
  const ordered = [...locationIds].sort();
  // Wait for the async step before continuing.
  await tx.$executeRaw`
    SELECT id FROM "Location"
    WHERE id IN (${Prisma.join(ordered)})
    ORDER BY id
    FOR UPDATE
  `;
}

// Define currentMemberIds — core behavior for this module.
async function currentMemberIds(
  // Set tx on the structure being built.
  tx: PrismaTypes.TransactionClient,
  // Set sectorId on the structure being built.
  sectorId: string,
// Run next step: ): Promise<string[]> {
): Promise<string[]> {
  // Load rows asynchronously for the next steps.
  const rows = await tx.sectorLocation.findMany({
    // Set where on the structure being built.
    where: { sectorId },
    // Set select on the structure being built.
    select: { locationId: true },
  });
  // Return the computed result to the caller.
  return rows.map((r) => r.locationId);
}

/** Peek current sector owners of locations (no row locks). */
export async function peekSourceSectorIds(
  // Set tx on the structure being built.
  tx: PrismaTypes.TransactionClient,
  // Set locationIds on the structure being built.
  locationIds: readonly string[],
  // Set destinationSectorId on the structure being built.
  destinationSectorId: string,
// Run next step: ): Promise<string[]> {
): Promise<string[]> {
  // Branch when this condition holds so the right path runs.
  if (!locationIds.length) return [];
  // Load memberships asynchronously for the next steps.
  const memberships = await tx.sectorLocation.findMany({
    // Set where on the structure being built.
    where: { locationId: { in: [...locationIds] } },
    // Set select on the structure being built.
    select: { sectorId: true },
  });
  // Return the computed result to the caller.
  return [
    // Run next step: ...new Set(
    ...new Set(
      // Run next step: memberships
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
  // Set tx on the structure being built.
  tx: PrismaTypes.TransactionClient,
  // Set sectorId on the structure being built.
  sectorId: string,
  // Set locationIds on the structure being built.
  locationIds: string[],
  // Set auth on the structure being built.
  auth: SectorMembershipAuth,
  // Set options on the structure being built.
  options: ReplaceMembershipOptions = {},
// Run next step: ) {
) {
  // Fail fast if the destination itself is outside the actor's scope.
  await assertDestinationInScope(auth.scope, sectorId);

  // Deduplicate so createMany does not hit unique constraints.
  const unique = [...new Set(locationIds)];

  // Capture pre locked for use in this scope.
  const preLocked = new Set(options.preLockedSectorIds ?? []);
  // Capture locked sector ids for use in this scope.
  let lockedSectorIds: Set<string>;

  // Branch when this condition holds so the right path runs.
  if (options.preLockedSectorIds) {
    // Branch when this condition holds so the right path runs.
    if (!preLocked.has(sectorId)) {
      // Abort with an error so callers can react.
      throw new AppError(
        // Run next step: 500,
        500,
        // Run next step: "internal",
        "internal",
        // Run next step: "replaceMembership preLockedSectorIds must include the desti…
        "replaceMembership preLockedSectorIds must include the destination",
      );
    }
    // Update locked sector ids as control flow progresses.
    lockedSectorIds = preLocked;
  // Run next step: } else {
  } else {
    // Load candidates asynchronously for the next steps.
    const candidates = await peekSourceSectorIds(tx, unique, sectorId);
    // Load ordered asynchronously for the next steps.
    const ordered = await lockSectorsNoKeyUpdateSorted(tx, [
      // Run next step: sectorId,
      sectorId,
      // Run next step: ...candidates,
      ...candidates,
    ]);
    // Update locked sector ids as control flow progresses.
    lockedSectorIds = new Set(ordered);
  }

  // Branch when this condition holds so the right path runs.
  if (unique.length) {
    // Reject unknown location ids before mutating membership.
    const found = await tx.location.findMany({
      // Set where on the structure being built.
      where: { id: { in: unique } },
      // Set select on the structure being built.
      select: { id: true },
    });
    // Branch when this condition holds so the right path runs.
    if (found.length !== unique.length) {
      // Abort with an error so callers can react.
      throw new AppError(400, "validation", "One or more locations not found");
    }
  }

  // Lock requested locations + current destination members; expand if re-read grows.
  const locked = new Set<string>();
  // Iterate items to apply the same logic to each entry.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    // Load members asynchronously for the next steps.
    const members = await currentMemberIds(tx, sectorId);
    // Capture needed for use in this scope.
    const needed = new Set<string>([...unique, ...members]);
    // Collect missing list for later processing.
    const missing = [...needed].filter((id) => !locked.has(id));
    // Branch when this condition holds so the right path runs.
    if (missing.length) {
      // Wait for the async step before continuing.
      await lockLocationsForUpdate(tx, missing);
      // Iterate items to apply the same logic to each entry.
      for (const id of missing) locked.add(id);
      // Skip to the next loop iteration.
      continue;
    }
    // Re-read after locks: another writer may have added a member while we waited.
    const membersAfter = await currentMemberIds(tx, sectorId);
    // Capture stale for use in this scope.
    const stale = membersAfter.filter((id) => !locked.has(id));
    // Branch when this condition holds so the right path runs.
    if (stale.length) {
      // Wait for the async step before continuing.
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
    // Capture uncovered for use in this scope.
    const uncovered = membersFinal.filter((id) => !locked.has(id));
    // Branch when this condition holds so the right path runs.
    if (uncovered.length) {
      // Abort with an error so callers can react.
      throw new AppError(
        // Run next step: 409,
        409,
        // Run next step: "conflict",
        "conflict",
        // Run next step: "Sector membership changed concurrently; retry",
        "Sector membership changed concurrently; retry",
      );
    }
  }

  /** locationId → source sector (excluding destination / unassigned). */
  const detachBySource = new Map<string, string[]>();

  // Branch when this condition holds so the right path runs.
  if (unique.length) {
    // Current sector for each location (null = unassigned) — under Location locks.
    const memberships = await tx.sectorLocation.findMany({
      // Set where on the structure being built.
      where: { locationId: { in: unique } },
      // Set select on the structure being built.
      select: { locationId: true, sectorId: true },
    });
    // Capture source by location for use in this scope.
    const sourceByLocation = new Map(
      // Run next step: memberships.map((m) => [m.locationId, m.sectorId]),
      memberships.map((m) => [m.locationId, m.sectorId]),
    );

    // Per-location transfer auth inside the same transaction (TOCTOU-safe).
    for (const locationId of unique) {
      // Capture source sector id for use in this scope.
      const sourceSectorId = sourceByLocation.get(locationId) ?? null;
      // Run next step: assertLocationTransferAllowed(auth, sectorId, sourceSectorId…
      assertLocationTransferAllowed(auth, sectorId, sourceSectorId);
      // Branch when this condition holds so the right path runs.
      if (sourceSectorId && sourceSectorId !== sectorId) {
        // Capture list for use in this scope.
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
      // Branch when this condition holds so the right path runs.
      if (!lockedSectorIds.has(sourceId)) {
        // Abort with an error so callers can react.
        throw new AppError(
          // Run next step: 409,
          409,
          // Run next step: "conflict",
          "conflict",
          // Run next step: "Sector membership sources changed concurrently; retry",
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
      // Set where on the structure being built.
      where: {
        // Set locationId on the structure being built.
        locationId: { in: unique },
        // Set sectorId on the structure being built.
        sectorId: { not: sectorId },
      },
    });

    // R2: bump + audit each source that lost rooms.
    for (const [sourceId, removedIds] of detachBySource) {
      // Capture before locations for use in this scope.
      const beforeLocations = sourceBefore.get(sourceId) ?? [];
      // Load source asynchronously for the next steps.
      const source = await tx.sector.findUnique({
        // Set where on the structure being built.
        where: { id: sourceId },
        // Set select on the structure being built.
        select: {
          // Set id on the structure being built.
          id: true,
          // Set code on the structure being built.
          code: true,
          // Set version on the structure being built.
          version: true,
        },
      });
      // Branch when this condition holds so the right path runs.
      if (!source) continue;

      // Load after locations asynchronously for the next steps.
      const afterLocations = await currentMemberIds(tx, sourceId);
      // Load updated asynchronously for the next steps.
      const updated = await tx.sector.update({
        // Set where on the structure being built.
        where: { id: sourceId },
        // Set data on the structure being built.
        data: { version: { increment: 1 } },
        // Set select on the structure being built.
        select: { version: true, code: true },
      });

      // Wait for the async step before continuing.
      await recordAudit(
        // Run next step: {
        {
          // Set actorEmployeeId on the structure being built.
          actorEmployeeId: options.actorEmployeeId,
          // Set action on the structure being built.
          action: "sector.update",
          // Set entityType on the structure being built.
          entityType: "sector",
          // Set entityId on the structure being built.
          entityId: sourceId,
          // Set before on the structure being built.
          before: {
            // Set code on the structure being built.
            code: source.code,
            // Set version on the structure being built.
            version: source.version,
            // Set locationIds on the structure being built.
            locationIds: beforeLocations,
            // Set removedLocationIds on the structure being built.
            removedLocationIds: removedIds,
          },
          // Set after on the structure being built.
          after: {
            // Set code on the structure being built.
            code: updated.code,
            // Set version on the structure being built.
            version: updated.version,
            // Set locationIds on the structure being built.
            locationIds: afterLocations,
          },
          // Set summary on the structure being built.
          summary: `Membership reduced on sector ${source.code} by cross-sector transfer`,
        },
        // Run next step: tx,
        tx,
      );
    }
  }

  // Clear existing membership for this sector, then insert the new set.
  await tx.sectorLocation.deleteMany({ where: { sectorId } });
  // Branch when this condition holds so the right path runs.
  if (unique.length) {
    // Wait for the async step before continuing.
    await tx.sectorLocation.createMany({
      // Set data on the structure being built.
      data: unique.map((locationId) => ({ sectorId, locationId })),
    });
  }
}
