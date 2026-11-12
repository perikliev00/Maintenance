/**
 * Sector mutations: create/update metadata and replace location membership.
 * Update accepts optional locationIds for an atomic metadata+membership save.
 * Access is re-checked under the sector lock (BUG-11); audit before is read
 * after locks (BUG-12); version CAS prevents lost updates (BUG-07).
 */
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { recordAudit } from "../audit";
import { isP2002 } from "../db/prismaErrors";
// Import type(s) Tx for typing without runtime cost.
import type { Tx } from "../db/types";
// Import type(s) DataScope for typing without runtime cost.
import type { DataScope } from "../dataScope";
import { resolveDataScope } from "../dataScope";
import { lockEmployeesForLiveAccess } from "../liveAccessLocks";
import { mapSector, sectorInclude } from "./format";
import {
  peekSourceSectorIds,
  replaceMembership,
  // Declare type SectorMembershipAuth for callers and internals.
  type SectorMembershipAuth,
} from "./membership";
import { getSector } from "./queries";
import {
  runAfterAccessRechecked,
  runAfterPreTxAuth,
  runAfterSectorLocked,
} from "./testHooks";
import {
  assertValidSectorFields,
  normalizeLocationIds,
  normalizeSectorFields,
} from "./validation";

// Capture out of scope for use in this scope.
const OUT_OF_SCOPE = "Outside your permitted data scope";

/** Roles allowed as primary sector supervisor. */
const SUPERVISOR_ROLES: ReadonlySet<Role> = new Set([
  Role.supervisor,
  Role.manager,
  Role.admin,
  Role.owner,
]);

async function resolvePropertyId(explicit?: string) {
  if (explicit) {
    const property = await prisma.property.findUnique({
      where: { id: explicit },
    });
    if (!property) {
      throw new AppError(404, "not_found", "Property not found");
    }
    return property.id;
  }
  const first = await prisma.property.findFirst({ orderBy: { createdAt: "asc" } });
  if (!first) {
    throw new AppError(400, "validation", "No property configured");
  }
  return first.id;
}

/**
 * Ensure assigned primary supervisor exists, is active, and has an eligible role.
 */
async function assertSupervisor(
  employeeId: string | null | undefined,
  db: Tx | typeof prisma = prisma,
) {
  if (!employeeId) return;
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: { user: true },
  });
  if (!employee) {
    throw new AppError(400, "validation", "Supervisor employee not found");
  }
  if (employee.archivedAt) {
    throw new AppError(
      400,
      "validation",
      "Supervisor employee is archived",
    );
  }
  if (!employee.user) {
    throw new AppError(
      400,
      "validation",
      "Supervisor employee has no login account",
    );
  }
  if (!employee.user.isActive) {
    throw new AppError(
      400,
      "validation",
      "Supervisor account is inactive",
    );
  }
  if (!SUPERVISOR_ROLES.has(employee.user.role)) {
    throw new AppError(
      400,
      "validation",
      "Primary supervisor must have a supervisory role",
    );
  }
}

async function lockSectorsNoKeyUpdateSorted(
  tx: Tx,
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

function throwVersionConflict(currentVersion: number, expectedVersion: number) {
  // Abort with an error so callers can react.
  throw new AppError(
    409,
    "version_conflict",
    "Sector was updated by another user",
    { expectedVersion, currentVersion },
  );
}

// Declare type SectorPatchFields for callers and internals.
type SectorPatchFields = ReturnType<typeof normalizeSectorFields>;

/** In-tx metadata CAS update; returns the next field snapshot for audit. */
async function applySectorPatch(
  tx: Tx,
  id: string,
  existing: {
    code: string;
    nameBg: string;
    nameEn: string;
    primarySupervisorEmployeeId: string | null;
    isActive: boolean;
    version: number;
  },
  patch: {
    fields: SectorPatchFields;
    primarySupervisorEmployeeId?: string | null;
    isActive?: boolean;
    expectedVersion: number;
  },
) {
  if (existing.version !== patch.expectedVersion) {
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
    patch.primarySupervisorEmployeeId !== undefined
      // Complete the ternary or optional chain started above.
      ? patch.primarySupervisorEmployeeId
      // Complete the ternary or optional chain started above.
      : existing.primarySupervisorEmployeeId;
  // Capture next active for use in this scope.
  const nextActive =
    patch.isActive !== undefined ? patch.isActive : existing.isActive;

  await tx.sector.update({
    where: { id },
    data: {
      code: nextCode,
      nameBg: nextNameBg,
      nameEn: nextNameEn,
      primarySupervisorEmployeeId: nextSupervisor,
      isActive: nextActive,
      version: { increment: 1 },
    },
  });

  return { nextCode, nextNameBg, nextNameEn, nextSupervisor, nextActive };
}

/**
 * Re-check sector write access under the sector lock.
 * Allows a sector-scoped actor to deactivate their own active sector in the
 * same transaction that still holds ownership.
 */
function assertSectorWriteAccessUnderLock(input: {
  scope: DataScope;
  sector: {
    id: string;
    isActive: boolean;
    primarySupervisorEmployeeId: string | null;
  };
  nextIsActive?: boolean;
}): void {
  if (input.scope.kind === "all") return;
  if (input.scope.kind !== "sectors") {
    // Abort with an error so callers can react.
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
  const owns =
    input.sector.primarySupervisorEmployeeId === input.scope.employeeId;
  if (!owns) {
    // Abort with an error so callers can react.
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
  // Still active → normal access.
  if (input.sector.isActive) return;
  // Already inactive: only hotel-wide actors may mutate (blocked above for sectors).
  throw new AppError(403, "forbidden", OUT_OF_SCOPE);
}

function mapUniqueConflict(err: unknown): never {
  if (isP2002(err)) {
    // Abort with an error so callers can react.
    throw new AppError(409, "conflict", "Sector code already exists");
  }
  // Abort with an error so callers can react.
  throw err;
}

// Declare type SectorSaveActor for callers and internals.
export type SectorSaveActor = {
  employeeId?: string;
  userId?: string;
  role: Role;
};

// Declare type SectorSaveInput for callers and internals.
export type SectorSaveInput = {
  code?: string;
  nameBg?: string;
  nameEn?: string;
  primarySupervisorEmployeeId?: string | null;
  isActive?: boolean;
  /** When provided, membership is replaced in the same transaction as metadata. */
  locationIds?: string[];
  /** Required — optimistic concurrency for every sector update path. */
  expectedVersion: number;
  actor: SectorSaveActor;
  scope: DataScope;
  allowCrossSectorTransfer: boolean;
};

/**
 * Create sector; optional initial locationIds run through membership auth.
 */
export async function createSector(input: {
  propertyId?: string;
  code: string;
  nameBg: string;
  nameEn: string;
  primarySupervisorEmployeeId?: string | null;
  locationIds?: string[];
  isActive?: boolean;
  actorEmployeeId?: string;
  scope: DataScope;
  allowCrossSectorTransfer: boolean;
}) {
  // Load property id asynchronously for the next steps.
  const propertyId = await resolvePropertyId(input.propertyId);
  const fields = normalizeSectorFields({
    code: input.code,
    nameBg: input.nameBg,
    nameEn: input.nameEn,
  });
  assertValidSectorFields(fields, { requireAll: true });
  await assertSupervisor(input.primarySupervisorEmployeeId);
  // Capture location ids for use in this scope.
  const locationIds = normalizeLocationIds(input.locationIds ?? []);

  const auth: SectorMembershipAuth = {
    scope: input.scope,
    allowCrossSectorTransfer: input.allowCrossSectorTransfer,
  };

  try {
    const sector = await prisma.$transaction(
      async (tx) => {
        await lockEmployeesForLiveAccess(tx, [
          input.primarySupervisorEmployeeId,
        ]);
        const created = await tx.sector.create({
          data: {
            propertyId,
            code: fields.code!,
            nameBg: fields.nameBg!,
            nameEn: fields.nameEn!,
            primarySupervisorEmployeeId:
              input.primarySupervisorEmployeeId ?? null,
            isActive: input.isActive ?? true,
            version: 1,
          },
        });
        if (locationIds.length) {
          await replaceMembership(tx, created.id, locationIds, auth, {
            actorEmployeeId: input.actorEmployeeId,
          });
        }
        const full = await tx.sector.findUniqueOrThrow({
          where: { id: created.id },
          include: sectorInclude,
        });
        await recordAudit(
          {
            actorEmployeeId: input.actorEmployeeId,
            action: "sector.create",
            entityType: "sector",
            entityId: created.id,
            after: {
              code: created.code,
              nameBg: created.nameBg,
              locationIds,
              version: created.version,
            },
            summary: `Created sector ${created.code}`,
          },
          tx,
        );
        return full;
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
    return mapSector(sector);
  } catch (err) {
    mapUniqueConflict(err);
  }
}

/**
 * Atomic sector save: metadata (+ optional membership) under one transaction,
 * with version CAS and in-TX access re-check.
 */
export async function saveSector(id: string, input: SectorSaveInput) {
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  ) {
    // Abort with an error so callers can react.
    throw new AppError(
      400,
      "validation",
      "expectedVersion is required for sector updates",
    );
  }

  await runAfterPreTxAuth({ sectorId: id, scope: input.scope });

  const fields = normalizeSectorFields({
    code: input.code,
    nameBg: input.nameBg,
    nameEn: input.nameEn,
  });
  assertValidSectorFields(fields);
  if (input.primarySupervisorEmployeeId !== undefined) {
    await assertSupervisor(input.primarySupervisorEmployeeId);
  }
  // Capture location ids for use in this scope.
  const locationIds =
    input.locationIds !== undefined
      // Complete the ternary or optional chain started above.
      ? normalizeLocationIds(input.locationIds)
      // Complete the ternary or optional chain started above.
      : undefined;

  // Live-access serialization when supervisor/active flags change (R1):
  // User locks must precede Sector locks (see liveAccessLocks.ts).
  const accessChanging =
    input.primarySupervisorEmployeeId !== undefined ||
    input.isActive !== undefined;

  try {
    await prisma.$transaction(
      async (tx) => {
        // Capture locked employee ids for use in this scope.
        const lockedEmployeeIds = new Set<string>();
        if (accessChanging) {
          const peek = await tx.sector.findUnique({
            where: { id },
            select: { primarySupervisorEmployeeId: true },
          });
          if (!peek) {
            // Abort with an error so callers can react.
            throw new AppError(404, "not_found", "Sector not found");
          }
          // Collect targets list for later processing.
          const targets = [
            peek.primarySupervisorEmployeeId,
            input.primarySupervisorEmployeeId,
          ].filter((employeeId): employeeId is string => Boolean(employeeId));
          // Iterate items to apply the same logic to each entry.
          for (const employeeId of targets) lockedEmployeeIds.add(employeeId);
          await lockEmployeesForLiveAccess(tx, targets);
        }

        // Destination (+ peeked source sectors when membership changes) in
        // stable id order — prevents AB-BA with concurrent cross-sector moves.
        const sectorLockTargets = [id];
        if (locationIds !== undefined && locationIds.length) {
          // Append an entry to the accumulating collection.
          sectorLockTargets.push(
            ...(await peekSourceSectorIds(tx, locationIds, id)),
          );
        }
        // Load pre locked sector ids asynchronously for the next steps.
        const preLockedSectorIds = await lockSectorsNoKeyUpdateSorted(
          tx,
          sectorLockTargets,
        );

        await runAfterSectorLocked({
          sectorId: id,
          scope: input.scope,
          tx,
        });

        const existing = await tx.sector.findUnique({ where: { id } });
        if (!existing) {
          // Abort with an error so callers can react.
          throw new AppError(404, "not_found", "Sector not found");
        }

        // Fail fast on stale version before access re-check / membership work.
        if (existing.version !== input.expectedVersion) {
          throwVersionConflict(existing.version, input.expectedVersion);
        }

        if (accessChanging) {
          // Collect needed list for later processing.
          const needed = [
            existing.primarySupervisorEmployeeId,
            input.primarySupervisorEmployeeId,
          ].filter((employeeId): employeeId is string => Boolean(employeeId));
          // Supervisor race between peek and sector lock — fail closed / retry
          // instead of taking User locks after Sector (deadlock with SSE).
          if (needed.some((employeeId) => !lockedEmployeeIds.has(employeeId))) {
            // Abort with an error so callers can react.
            throw new AppError(
              409,
              "conflict",
              "Sector access changed concurrently; retry",
            );
          }
        }

        // Fresh scope under locks — defeats revoked-access races (BUG-11).
        const liveScope = await resolveDataScope(
          {
            userId: input.actor.userId ?? "",
            employeeId: input.actor.employeeId ?? input.scope.employeeId,
            role: input.actor.role,
            email: "",
            sid: "",
          },
          tx,
        );
        // Preserve hotel-wide vs sector kind from the caller's role.
        const effectiveScope: DataScope =
          input.scope.kind === "all"
            // Complete the ternary or optional chain started above.
            ? { ...liveScope, kind: "all", sectorIds: [] }
            // Complete the ternary or optional chain started above.
            : liveScope;

        assertSectorWriteAccessUnderLock({
          scope: effectiveScope,
          sector: existing,
          nextIsActive: input.isActive,
        });
        await runAfterAccessRechecked({
          sectorId: id,
          scope: effectiveScope,
          tx,
        });

        // Membership before snapshot under sector + (later) location locks.
        const beforeLocations =
          locationIds !== undefined
            // Complete the ternary or optional chain started above.
            ? await tx.sectorLocation.findMany({
                where: { sectorId: id },
                select: { locationId: true },
              })
            // Complete the ternary or optional chain started above.
            : null;

        const patched = await applySectorPatch(tx, id, existing, {
          fields,
          primarySupervisorEmployeeId: input.primarySupervisorEmployeeId,
          isActive: input.isActive,
          expectedVersion: input.expectedVersion,
        });
        const { nextCode, nextNameBg, nextNameEn, nextSupervisor, nextActive } =
          patched;

        if (locationIds !== undefined) {
          const auth: SectorMembershipAuth = {
            scope: effectiveScope,
            allowCrossSectorTransfer: input.allowCrossSectorTransfer,
          };
          await replaceMembership(tx, id, locationIds, auth, {
            actorEmployeeId: input.actor.employeeId,
            preLockedSectorIds,
          });
        }

        await recordAudit(
          {
            actorEmployeeId: input.actor.employeeId,
            action:
              locationIds !== undefined
                // Complete the ternary or optional chain started above.
                ? "sector.save"
                // Complete the ternary or optional chain started above.
                : "sector.update",
            entityType: "sector",
            entityId: id,
            before: {
              code: existing.code,
              nameBg: existing.nameBg,
              nameEn: existing.nameEn,
              primarySupervisorEmployeeId: existing.primarySupervisorEmployeeId,
              isActive: existing.isActive,
              version: existing.version,
              ...(beforeLocations
                // Complete the ternary or optional chain started above.
                ? {
                    locationIds: beforeLocations.map((b) => b.locationId),
                  }
                // Complete the ternary or optional chain started above.
                : {}),
            },
            after: {
              code: nextCode,
              nameBg: nextNameBg,
              nameEn: nextNameEn,
              primarySupervisorEmployeeId: nextSupervisor,
              isActive: nextActive,
              version: existing.version + 1,
              ...(locationIds !== undefined ? { locationIds } : {}),
            },
            summary: `Updated sector ${existing.code}`,
          },
          tx,
        );
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
  } catch (err) {
    if (isP2002(err)) {
      if (String(err.meta?.target ?? "").includes("locationId")) {
        // Abort with an error so callers can react.
        throw new AppError(
          409,
          "conflict",
          "Location already assigned to another sector",
        );
      }
      // Abort with an error so callers can react.
      throw new AppError(409, "conflict", "Sector code already exists");
    }
    // Abort with an error so callers can react.
    throw err;
  }

  return getSector(id);
}

/**
 * Authoritative membership replace for one sector (TOCTOU-safe via transaction).
 * Re-checks access under the sector lock and audits after locks (BUG-11/12).
 */
export async function setSectorLocations(
  id: string,
  locationIds: string[],
  options: {
    actorEmployeeId?: string;
    actorUserId?: string;
    actorRole?: Role;
    scope: DataScope;
    allowCrossSectorTransfer: boolean;
    expectedVersion: number;
  },
) {
  return saveSector(id, {
    locationIds,
    expectedVersion: options.expectedVersion,
    actor: {
      employeeId: options.actorEmployeeId,
      userId: options.actorUserId,
      role: options.actorRole ?? options.scope.role,
    },
    scope: options.scope,
    allowCrossSectorTransfer: options.allowCrossSectorTransfer,
  });
}
