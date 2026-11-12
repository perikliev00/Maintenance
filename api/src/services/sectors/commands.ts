/**
 * Sector mutations: create/update metadata and replace location membership.
 * Update accepts optional locationIds for an atomic metadata+membership save.
 * Access is re-checked under the sector lock (BUG-11); audit before is read
 * after locks (BUG-12); version CAS prevents lost updates (BUG-07).
 */
import { Prisma, Role } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../audit for this service.
import { recordAudit } from "../audit";
// Import module ../db/prismaErrors for this service.
import { isP2002 } from "../db/prismaErrors";
// Import type(s) Tx for typing without runtime cost.
import type { Tx } from "../db/types";
// Import type(s) DataScope for typing without runtime cost.
import type { DataScope } from "../dataScope";
// Import module ../dataScope for this service.
import { resolveDataScope } from "../dataScope";
// Import module ../liveAccessLocks for this service.
import { lockEmployeesForLiveAccess } from "../liveAccessLocks";
// Import module ./format for this service.
import { mapSector, sectorInclude } from "./format";
// Import module dependency for this service.
import {
  // Run next step: peekSourceSectorIds,
  peekSourceSectorIds,
  // Run next step: replaceMembership,
  replaceMembership,
  // Declare type SectorMembershipAuth for callers and internals.
  type SectorMembershipAuth,
// Run next step: } from "./membership";
} from "./membership";
// Import module ./queries for this service.
import { getSector } from "./queries";
// Import module dependency for this service.
import {
  // Run next step: runAfterAccessRechecked,
  runAfterAccessRechecked,
  // Run next step: runAfterPreTxAuth,
  runAfterPreTxAuth,
  // Run next step: runAfterSectorLocked,
  runAfterSectorLocked,
// Run next step: } from "./testHooks";
} from "./testHooks";
// Import module dependency for this service.
import {
  // Run next step: assertValidSectorFields,
  assertValidSectorFields,
  // Run next step: normalizeLocationIds,
  normalizeLocationIds,
  // Run next step: normalizeSectorFields,
  normalizeSectorFields,
// Run next step: } from "./validation";
} from "./validation";

// Capture out of scope for use in this scope.
const OUT_OF_SCOPE = "Outside your permitted data scope";

/** Roles allowed as primary sector supervisor. */
const SUPERVISOR_ROLES: ReadonlySet<Role> = new Set([
  // Run next step: Role.supervisor,
  Role.supervisor,
  // Run next step: Role.manager,
  Role.manager,
  // Run next step: Role.admin,
  Role.admin,
  // Run next step: Role.owner,
  Role.owner,
]);

// Define resolvePropertyId — core behavior for this module.
async function resolvePropertyId(explicit?: string) {
  // Branch when this condition holds so the right path runs.
  if (explicit) {
    // Load property asynchronously for the next steps.
    const property = await prisma.property.findUnique({
      // Set where on the structure being built.
      where: { id: explicit },
    });
    // Branch when this condition holds so the right path runs.
    if (!property) {
      // Abort with an error so callers can react.
      throw new AppError(404, "not_found", "Property not found");
    }
    // Return the computed result to the caller.
    return property.id;
  }
  // Load first asynchronously for the next steps.
  const first = await prisma.property.findFirst({ orderBy: { createdAt: "asc" } });
  // Branch when this condition holds so the right path runs.
  if (!first) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "No property configured");
  }
  // Return the computed result to the caller.
  return first.id;
}

/**
 * Ensure assigned primary supervisor exists, is active, and has an eligible role.
 */
async function assertSupervisor(
  // Set employeeId on the structure being built.
  employeeId: string | null | undefined,
  // Set db on the structure being built.
  db: Tx | typeof prisma = prisma,
// Run next step: ) {
) {
  // Branch when this condition holds so the right path runs.
  if (!employeeId) return;
  // Load employee asynchronously for the next steps.
  const employee = await db.employee.findUnique({
    // Set where on the structure being built.
    where: { id: employeeId },
    // Set include on the structure being built.
    include: { user: true },
  });
  // Branch when this condition holds so the right path runs.
  if (!employee) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "Supervisor employee not found");
  }
  // Branch when this condition holds so the right path runs.
  if (employee.archivedAt) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 400,
      400,
      // Run next step: "validation",
      "validation",
      // Run next step: "Supervisor employee is archived",
      "Supervisor employee is archived",
    );
  }
  // Branch when this condition holds so the right path runs.
  if (!employee.user) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 400,
      400,
      // Run next step: "validation",
      "validation",
      // Run next step: "Supervisor employee has no login account",
      "Supervisor employee has no login account",
    );
  }
  // Branch when this condition holds so the right path runs.
  if (!employee.user.isActive) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 400,
      400,
      // Run next step: "validation",
      "validation",
      // Run next step: "Supervisor account is inactive",
      "Supervisor account is inactive",
    );
  }
  // Branch when this condition holds so the right path runs.
  if (!SUPERVISOR_ROLES.has(employee.user.role)) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 400,
      400,
      // Run next step: "validation",
      "validation",
      // Run next step: "Primary supervisor must have a supervisory role",
      "Primary supervisor must have a supervisory role",
    );
  }
}

// Define lockSectorsNoKeyUpdateSorted — core behavior for this module.
async function lockSectorsNoKeyUpdateSorted(
  // Set tx on the structure being built.
  tx: Tx,
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

// Define throwVersionConflict — core behavior for this module.
function throwVersionConflict(currentVersion: number, expectedVersion: number) {
  // Abort with an error so callers can react.
  throw new AppError(
    // Run next step: 409,
    409,
    // Run next step: "version_conflict",
    "version_conflict",
    // Run next step: "Sector was updated by another user",
    "Sector was updated by another user",
    // Run next step: { expectedVersion, currentVersion },
    { expectedVersion, currentVersion },
  );
}

// Declare type SectorPatchFields for callers and internals.
type SectorPatchFields = ReturnType<typeof normalizeSectorFields>;

/** In-tx metadata CAS update; returns the next field snapshot for audit. */
async function applySectorPatch(
  // Set tx on the structure being built.
  tx: Tx,
  // Set id on the structure being built.
  id: string,
  // Set existing on the structure being built.
  existing: {
    // Set code on the structure being built.
    code: string;
    // Set nameBg on the structure being built.
    nameBg: string;
    // Set nameEn on the structure being built.
    nameEn: string;
    // Set primarySupervisorEmployeeId on the structure being built.
    primarySupervisorEmployeeId: string | null;
    // Set isActive on the structure being built.
    isActive: boolean;
    // Set version on the structure being built.
    version: number;
  },
  // Set patch on the structure being built.
  patch: {
    // Set fields on the structure being built.
    fields: SectorPatchFields;
    // Run next step: primarySupervisorEmployeeId?: string | null;
    primarySupervisorEmployeeId?: string | null;
    // Run next step: isActive?: boolean;
    isActive?: boolean;
    // Set expectedVersion on the structure being built.
    expectedVersion: number;
  },
// Run next step: ) {
) {
  // Branch when this condition holds so the right path runs.
  if (existing.version !== patch.expectedVersion) {
    // Run next step: throwVersionConflict(existing.version, patch.expectedVersion…
    throwVersionConflict(existing.version, patch.expectedVersion);
  }

  // Capture next code for use in this scope.
  const nextCode = patch.fields.code ?? existing.code;
  // Capture next name bg for use in this scope.
  const nextNameBg = patch.fields.nameBg ?? existing.nameBg;
  // Capture next name en for use in this scope.
  const nextNameEn = patch.fields.nameEn ?? existing.nameEn;
  // Capture next supervisor for use in this scope.
  const nextSupervisor =
    // Run next step: patch.primarySupervisorEmployeeId !== undefined
    patch.primarySupervisorEmployeeId !== undefined
      // Complete the ternary or optional chain started above.
      ? patch.primarySupervisorEmployeeId
      // Complete the ternary or optional chain started above.
      : existing.primarySupervisorEmployeeId;
  // Capture next active for use in this scope.
  const nextActive =
    // Run next step: patch.isActive !== undefined ? patch.isActive : existing.isA…
    patch.isActive !== undefined ? patch.isActive : existing.isActive;

  // Wait for the async step before continuing.
  await tx.sector.update({
    // Set where on the structure being built.
    where: { id },
    // Set data on the structure being built.
    data: {
      // Set code on the structure being built.
      code: nextCode,
      // Set nameBg on the structure being built.
      nameBg: nextNameBg,
      // Set nameEn on the structure being built.
      nameEn: nextNameEn,
      // Set primarySupervisorEmployeeId on the structure being built.
      primarySupervisorEmployeeId: nextSupervisor,
      // Set isActive on the structure being built.
      isActive: nextActive,
      // Set version on the structure being built.
      version: { increment: 1 },
    },
  });

  // Return the computed result to the caller.
  return { nextCode, nextNameBg, nextNameEn, nextSupervisor, nextActive };
}

/**
 * Re-check sector write access under the sector lock.
 * Allows a sector-scoped actor to deactivate their own active sector in the
 * same transaction that still holds ownership.
 */
function assertSectorWriteAccessUnderLock(input: {
  // Set scope on the structure being built.
  scope: DataScope;
  // Set sector on the structure being built.
  sector: {
    // Set id on the structure being built.
    id: string;
    // Set isActive on the structure being built.
    isActive: boolean;
    // Set primarySupervisorEmployeeId on the structure being built.
    primarySupervisorEmployeeId: string | null;
  };
  // Run next step: nextIsActive?: boolean;
  nextIsActive?: boolean;
// Run next step: }): void {
}): void {
  // Branch when this condition holds so the right path runs.
  if (input.scope.kind === "all") return;
  // Branch when this condition holds so the right path runs.
  if (input.scope.kind !== "sectors") {
    // Abort with an error so callers can react.
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
  // Capture owns for use in this scope.
  const owns =
    // Run next step: input.sector.primarySupervisorEmployeeId === input.scope.emp…
    input.sector.primarySupervisorEmployeeId === input.scope.employeeId;
  // Branch when this condition holds so the right path runs.
  if (!owns) {
    // Abort with an error so callers can react.
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
  // Still active → normal access.
  if (input.sector.isActive) return;
  // Already inactive: only hotel-wide actors may mutate (blocked above for sectors).
  throw new AppError(403, "forbidden", OUT_OF_SCOPE);
}

// Define mapUniqueConflict — core behavior for this module.
function mapUniqueConflict(err: unknown): never {
  // Branch when this condition holds so the right path runs.
  if (isP2002(err)) {
    // Abort with an error so callers can react.
    throw new AppError(409, "conflict", "Sector code already exists");
  }
  // Abort with an error so callers can react.
  throw err;
}

// Declare type SectorSaveActor for callers and internals.
export type SectorSaveActor = {
  // Run next step: employeeId?: string;
  employeeId?: string;
  // Run next step: userId?: string;
  userId?: string;
  // Set role on the structure being built.
  role: Role;
};

// Declare type SectorSaveInput for callers and internals.
export type SectorSaveInput = {
  // Run next step: code?: string;
  code?: string;
  // Run next step: nameBg?: string;
  nameBg?: string;
  // Run next step: nameEn?: string;
  nameEn?: string;
  // Run next step: primarySupervisorEmployeeId?: string | null;
  primarySupervisorEmployeeId?: string | null;
  // Run next step: isActive?: boolean;
  isActive?: boolean;
  /** When provided, membership is replaced in the same transaction as metadata. */
  locationIds?: string[];
  /** Required — optimistic concurrency for every sector update path. */
  expectedVersion: number;
  // Set actor on the structure being built.
  actor: SectorSaveActor;
  // Set scope on the structure being built.
  scope: DataScope;
  // Set allowCrossSectorTransfer on the structure being built.
  allowCrossSectorTransfer: boolean;
};

/**
 * Create sector; optional initial locationIds run through membership auth.
 */
export async function createSector(input: {
  // Run next step: propertyId?: string;
  propertyId?: string;
  // Set code on the structure being built.
  code: string;
  // Set nameBg on the structure being built.
  nameBg: string;
  // Set nameEn on the structure being built.
  nameEn: string;
  // Run next step: primarySupervisorEmployeeId?: string | null;
  primarySupervisorEmployeeId?: string | null;
  // Run next step: locationIds?: string[];
  locationIds?: string[];
  // Run next step: isActive?: boolean;
  isActive?: boolean;
  // Run next step: actorEmployeeId?: string;
  actorEmployeeId?: string;
  // Set scope on the structure being built.
  scope: DataScope;
  // Set allowCrossSectorTransfer on the structure being built.
  allowCrossSectorTransfer: boolean;
// Run next step: }) {
}) {
  // Load property id asynchronously for the next steps.
  const propertyId = await resolvePropertyId(input.propertyId);
  // Capture fields for use in this scope.
  const fields = normalizeSectorFields({
    // Set code on the structure being built.
    code: input.code,
    // Set nameBg on the structure being built.
    nameBg: input.nameBg,
    // Set nameEn on the structure being built.
    nameEn: input.nameEn,
  });
  // Run next step: assertValidSectorFields(fields, { requireAll: true });
  assertValidSectorFields(fields, { requireAll: true });
  // Wait for the async step before continuing.
  await assertSupervisor(input.primarySupervisorEmployeeId);
  // Capture location ids for use in this scope.
  const locationIds = normalizeLocationIds(input.locationIds ?? []);

  // Capture auth for use in this scope.
  const auth: SectorMembershipAuth = {
    // Set scope on the structure being built.
    scope: input.scope,
    // Set allowCrossSectorTransfer on the structure being built.
    allowCrossSectorTransfer: input.allowCrossSectorTransfer,
  };

  // Attempt the fallible work so errors can be handled below.
  try {
    // Load sector asynchronously for the next steps.
    const sector = await prisma.$transaction(
      // Run next step: async (tx) => {
      async (tx) => {
        // Wait for the async step before continuing.
        await lockEmployeesForLiveAccess(tx, [
          // Run next step: input.primarySupervisorEmployeeId,
          input.primarySupervisorEmployeeId,
        ]);
        // Load created asynchronously for the next steps.
        const created = await tx.sector.create({
          // Set data on the structure being built.
          data: {
            // Run next step: propertyId,
            propertyId,
            // Set code on the structure being built.
            code: fields.code!,
            // Set nameBg on the structure being built.
            nameBg: fields.nameBg!,
            // Set nameEn on the structure being built.
            nameEn: fields.nameEn!,
            // Set primarySupervisorEmployeeId on the structure being built.
            primarySupervisorEmployeeId:
              // Run next step: input.primarySupervisorEmployeeId ?? null,
              input.primarySupervisorEmployeeId ?? null,
            // Set isActive on the structure being built.
            isActive: input.isActive ?? true,
            // Set version on the structure being built.
            version: 1,
          },
        });
        // Branch when this condition holds so the right path runs.
        if (locationIds.length) {
          // Wait for the async step before continuing.
          await replaceMembership(tx, created.id, locationIds, auth, {
            // Set actorEmployeeId on the structure being built.
            actorEmployeeId: input.actorEmployeeId,
          });
        }
        // Load full asynchronously for the next steps.
        const full = await tx.sector.findUniqueOrThrow({
          // Set where on the structure being built.
          where: { id: created.id },
          // Set include on the structure being built.
          include: sectorInclude,
        });
        // Wait for the async step before continuing.
        await recordAudit(
          // Run next step: {
          {
            // Set actorEmployeeId on the structure being built.
            actorEmployeeId: input.actorEmployeeId,
            // Set action on the structure being built.
            action: "sector.create",
            // Set entityType on the structure being built.
            entityType: "sector",
            // Set entityId on the structure being built.
            entityId: created.id,
            // Set after on the structure being built.
            after: {
              // Set code on the structure being built.
              code: created.code,
              // Set nameBg on the structure being built.
              nameBg: created.nameBg,
              // Run next step: locationIds,
              locationIds,
              // Set version on the structure being built.
              version: created.version,
            },
            // Set summary on the structure being built.
            summary: `Created sector ${created.code}`,
          },
          // Run next step: tx,
          tx,
        );
        // Return the computed result to the caller.
        return full;
      },
      // Run next step: { timeout: 20_000, maxWait: 20_000 },
      { timeout: 20_000, maxWait: 20_000 },
    );
    // Return the computed result to the caller.
    return mapSector(sector);
  // Run next step: } catch (err) {
  } catch (err) {
    // Run next step: mapUniqueConflict(err);
    mapUniqueConflict(err);
  }
}

/**
 * Atomic sector save: metadata (+ optional membership) under one transaction,
 * with version CAS and in-TX access re-check.
 */
export async function saveSector(id: string, input: SectorSaveInput) {
  // Branch when this condition holds so the right path runs.
  if (
    // Run next step: !Number.isInteger(input.expectedVersion) ||
    !Number.isInteger(input.expectedVersion) ||
    // Run next step: input.expectedVersion < 1
    input.expectedVersion < 1
  // Run next step: ) {
  ) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 400,
      400,
      // Run next step: "validation",
      "validation",
      // Run next step: "expectedVersion is required for sector updates",
      "expectedVersion is required for sector updates",
    );
  }

  // Wait for the async step before continuing.
  await runAfterPreTxAuth({ sectorId: id, scope: input.scope });

  // Capture fields for use in this scope.
  const fields = normalizeSectorFields({
    // Set code on the structure being built.
    code: input.code,
    // Set nameBg on the structure being built.
    nameBg: input.nameBg,
    // Set nameEn on the structure being built.
    nameEn: input.nameEn,
  });
  // Run next step: assertValidSectorFields(fields);
  assertValidSectorFields(fields);
  // Branch when this condition holds so the right path runs.
  if (input.primarySupervisorEmployeeId !== undefined) {
    // Wait for the async step before continuing.
    await assertSupervisor(input.primarySupervisorEmployeeId);
  }
  // Capture location ids for use in this scope.
  const locationIds =
    // Run next step: input.locationIds !== undefined
    input.locationIds !== undefined
      // Complete the ternary or optional chain started above.
      ? normalizeLocationIds(input.locationIds)
      // Complete the ternary or optional chain started above.
      : undefined;

  // Live-access serialization when supervisor/active flags change (R1):
  // User locks must precede Sector locks (see liveAccessLocks.ts).
  const accessChanging =
    // Run next step: input.primarySupervisorEmployeeId !== undefined ||
    input.primarySupervisorEmployeeId !== undefined ||
    // Run next step: input.isActive !== undefined;
    input.isActive !== undefined;

  // Attempt the fallible work so errors can be handled below.
  try {
    // Wait for the async step before continuing.
    await prisma.$transaction(
      // Run next step: async (tx) => {
      async (tx) => {
        // Capture locked employee ids for use in this scope.
        const lockedEmployeeIds = new Set<string>();
        // Branch when this condition holds so the right path runs.
        if (accessChanging) {
          // Load peek asynchronously for the next steps.
          const peek = await tx.sector.findUnique({
            // Set where on the structure being built.
            where: { id },
            // Set select on the structure being built.
            select: { primarySupervisorEmployeeId: true },
          });
          // Branch when this condition holds so the right path runs.
          if (!peek) {
            // Abort with an error so callers can react.
            throw new AppError(404, "not_found", "Sector not found");
          }
          // Collect targets list for later processing.
          const targets = [
            // Run next step: peek.primarySupervisorEmployeeId,
            peek.primarySupervisorEmployeeId,
            // Run next step: input.primarySupervisorEmployeeId,
            input.primarySupervisorEmployeeId,
          // Run next step: ].filter((employeeId): employeeId is string => Boolean(emplo…
          ].filter((employeeId): employeeId is string => Boolean(employeeId));
          // Iterate items to apply the same logic to each entry.
          for (const employeeId of targets) lockedEmployeeIds.add(employeeId);
          // Wait for the async step before continuing.
          await lockEmployeesForLiveAccess(tx, targets);
        }

        // Destination (+ peeked source sectors when membership changes) in
        // stable id order — prevents AB-BA with concurrent cross-sector moves.
        const sectorLockTargets = [id];
        // Branch when this condition holds so the right path runs.
        if (locationIds !== undefined && locationIds.length) {
          // Append an entry to the accumulating collection.
          sectorLockTargets.push(
            // Run next step: ...(await peekSourceSectorIds(tx, locationIds, id)),
            ...(await peekSourceSectorIds(tx, locationIds, id)),
          );
        }
        // Load pre locked sector ids asynchronously for the next steps.
        const preLockedSectorIds = await lockSectorsNoKeyUpdateSorted(
          // Run next step: tx,
          tx,
          // Run next step: sectorLockTargets,
          sectorLockTargets,
        );

        // Wait for the async step before continuing.
        await runAfterSectorLocked({
          // Set sectorId on the structure being built.
          sectorId: id,
          // Set scope on the structure being built.
          scope: input.scope,
          // Run next step: tx,
          tx,
        });

        // Load existing asynchronously for the next steps.
        const existing = await tx.sector.findUnique({ where: { id } });
        // Branch when this condition holds so the right path runs.
        if (!existing) {
          // Abort with an error so callers can react.
          throw new AppError(404, "not_found", "Sector not found");
        }

        // Fail fast on stale version before access re-check / membership work.
        if (existing.version !== input.expectedVersion) {
          // Run next step: throwVersionConflict(existing.version, input.expectedVersion…
          throwVersionConflict(existing.version, input.expectedVersion);
        }

        // Branch when this condition holds so the right path runs.
        if (accessChanging) {
          // Collect needed list for later processing.
          const needed = [
            // Run next step: existing.primarySupervisorEmployeeId,
            existing.primarySupervisorEmployeeId,
            // Run next step: input.primarySupervisorEmployeeId,
            input.primarySupervisorEmployeeId,
          // Run next step: ].filter((employeeId): employeeId is string => Boolean(emplo…
          ].filter((employeeId): employeeId is string => Boolean(employeeId));
          // Supervisor race between peek and sector lock — fail closed / retry
          // instead of taking User locks after Sector (deadlock with SSE).
          if (needed.some((employeeId) => !lockedEmployeeIds.has(employeeId))) {
            // Abort with an error so callers can react.
            throw new AppError(
              // Run next step: 409,
              409,
              // Run next step: "conflict",
              "conflict",
              // Run next step: "Sector access changed concurrently; retry",
              "Sector access changed concurrently; retry",
            );
          }
        }

        // Fresh scope under locks — defeats revoked-access races (BUG-11).
        const liveScope = await resolveDataScope(
          // Run next step: {
          {
            // Set userId on the structure being built.
            userId: input.actor.userId ?? "",
            // Set employeeId on the structure being built.
            employeeId: input.actor.employeeId ?? input.scope.employeeId,
            // Set role on the structure being built.
            role: input.actor.role,
            // Set email on the structure being built.
            email: "",
            // Set sid on the structure being built.
            sid: "",
          },
          // Run next step: tx,
          tx,
        );
        // Preserve hotel-wide vs sector kind from the caller's role.
        const effectiveScope: DataScope =
          // Run next step: input.scope.kind === "all"
          input.scope.kind === "all"
            // Complete the ternary or optional chain started above.
            ? { ...liveScope, kind: "all", sectorIds: [] }
            // Complete the ternary or optional chain started above.
            : liveScope;

        // Run next step: assertSectorWriteAccessUnderLock({
        assertSectorWriteAccessUnderLock({
          // Set scope on the structure being built.
          scope: effectiveScope,
          // Set sector on the structure being built.
          sector: existing,
          // Set nextIsActive on the structure being built.
          nextIsActive: input.isActive,
        });
        // Wait for the async step before continuing.
        await runAfterAccessRechecked({
          // Set sectorId on the structure being built.
          sectorId: id,
          // Set scope on the structure being built.
          scope: effectiveScope,
          // Run next step: tx,
          tx,
        });

        // Membership before snapshot under sector + (later) location locks.
        const beforeLocations =
          // Run next step: locationIds !== undefined
          locationIds !== undefined
            // Complete the ternary or optional chain started above.
            ? await tx.sectorLocation.findMany({
                // Set where on the structure being built.
                where: { sectorId: id },
                // Set select on the structure being built.
                select: { locationId: true },
              })
            // Complete the ternary or optional chain started above.
            : null;

        // Load patched asynchronously for the next steps.
        const patched = await applySectorPatch(tx, id, existing, {
          // Run next step: fields,
          fields,
          // Set primarySupervisorEmployeeId on the structure being built.
          primarySupervisorEmployeeId: input.primarySupervisorEmployeeId,
          // Set isActive on the structure being built.
          isActive: input.isActive,
          // Set expectedVersion on the structure being built.
          expectedVersion: input.expectedVersion,
        });
        // Destructure value fields needed locally.
        const { nextCode, nextNameBg, nextNameEn, nextSupervisor, nextActive } =
          // Run next step: patched;
          patched;

        // Branch when this condition holds so the right path runs.
        if (locationIds !== undefined) {
          // Capture auth for use in this scope.
          const auth: SectorMembershipAuth = {
            // Set scope on the structure being built.
            scope: effectiveScope,
            // Set allowCrossSectorTransfer on the structure being built.
            allowCrossSectorTransfer: input.allowCrossSectorTransfer,
          };
          // Wait for the async step before continuing.
          await replaceMembership(tx, id, locationIds, auth, {
            // Set actorEmployeeId on the structure being built.
            actorEmployeeId: input.actor.employeeId,
            // Run next step: preLockedSectorIds,
            preLockedSectorIds,
          });
        }

        // Wait for the async step before continuing.
        await recordAudit(
          // Run next step: {
          {
            // Set actorEmployeeId on the structure being built.
            actorEmployeeId: input.actor.employeeId,
            // Set action on the structure being built.
            action:
              // Run next step: locationIds !== undefined
              locationIds !== undefined
                // Complete the ternary or optional chain started above.
                ? "sector.save"
                // Complete the ternary or optional chain started above.
                : "sector.update",
            // Set entityType on the structure being built.
            entityType: "sector",
            // Set entityId on the structure being built.
            entityId: id,
            // Set before on the structure being built.
            before: {
              // Set code on the structure being built.
              code: existing.code,
              // Set nameBg on the structure being built.
              nameBg: existing.nameBg,
              // Set nameEn on the structure being built.
              nameEn: existing.nameEn,
              // Set primarySupervisorEmployeeId on the structure being built.
              primarySupervisorEmployeeId: existing.primarySupervisorEmployeeId,
              // Set isActive on the structure being built.
              isActive: existing.isActive,
              // Set version on the structure being built.
              version: existing.version,
              // Run next step: ...(beforeLocations
              ...(beforeLocations
                // Complete the ternary or optional chain started above.
                ? {
                    // Set locationIds on the structure being built.
                    locationIds: beforeLocations.map((b) => b.locationId),
                  }
                // Complete the ternary or optional chain started above.
                : {}),
            },
            // Set after on the structure being built.
            after: {
              // Set code on the structure being built.
              code: nextCode,
              // Set nameBg on the structure being built.
              nameBg: nextNameBg,
              // Set nameEn on the structure being built.
              nameEn: nextNameEn,
              // Set primarySupervisorEmployeeId on the structure being built.
              primarySupervisorEmployeeId: nextSupervisor,
              // Set isActive on the structure being built.
              isActive: nextActive,
              // Set version on the structure being built.
              version: existing.version + 1,
              // Run next step: ...(locationIds !== undefined ? { locationIds } : {}),
              ...(locationIds !== undefined ? { locationIds } : {}),
            },
            // Set summary on the structure being built.
            summary: `Updated sector ${existing.code}`,
          },
          // Run next step: tx,
          tx,
        );
      },
      // Run next step: { timeout: 20_000, maxWait: 20_000 },
      { timeout: 20_000, maxWait: 20_000 },
    );
  // Run next step: } catch (err) {
  } catch (err) {
    // Branch when this condition holds so the right path runs.
    if (isP2002(err)) {
      // Branch when this condition holds so the right path runs.
      if (String(err.meta?.target ?? "").includes("locationId")) {
        // Abort with an error so callers can react.
        throw new AppError(
          // Run next step: 409,
          409,
          // Run next step: "conflict",
          "conflict",
          // Run next step: "Location already assigned to another sector",
          "Location already assigned to another sector",
        );
      }
      // Abort with an error so callers can react.
      throw new AppError(409, "conflict", "Sector code already exists");
    }
    // Abort with an error so callers can react.
    throw err;
  }

  // Return the computed result to the caller.
  return getSector(id);
}

/**
 * Authoritative membership replace for one sector (TOCTOU-safe via transaction).
 * Re-checks access under the sector lock and audits after locks (BUG-11/12).
 */
export async function setSectorLocations(
  // Set id on the structure being built.
  id: string,
  // Set locationIds on the structure being built.
  locationIds: string[],
  // Set options on the structure being built.
  options: {
    // Run next step: actorEmployeeId?: string;
    actorEmployeeId?: string;
    // Run next step: actorUserId?: string;
    actorUserId?: string;
    // Run next step: actorRole?: Role;
    actorRole?: Role;
    // Set scope on the structure being built.
    scope: DataScope;
    // Set allowCrossSectorTransfer on the structure being built.
    allowCrossSectorTransfer: boolean;
    // Set expectedVersion on the structure being built.
    expectedVersion: number;
  },
// Run next step: ) {
) {
  // Return the computed result to the caller.
  return saveSector(id, {
    // Run next step: locationIds,
    locationIds,
    // Set expectedVersion on the structure being built.
    expectedVersion: options.expectedVersion,
    // Set actor on the structure being built.
    actor: {
      // Set employeeId on the structure being built.
      employeeId: options.actorEmployeeId,
      // Set userId on the structure being built.
      userId: options.actorUserId,
      // Set role on the structure being built.
      role: options.actorRole ?? options.scope.role,
    },
    // Set scope on the structure being built.
    scope: options.scope,
    // Set allowCrossSectorTransfer on the structure being built.
    allowCrossSectorTransfer: options.allowCrossSectorTransfer,
  });
}
