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
import type { Tx } from "../db/types";
import type { DataScope } from "../dataScope";
import { resolveDataScope } from "../dataScope";
import { lockEmployeesForLiveAccess } from "../liveAccessLocks";
import { mapSector, sectorInclude } from "./format";
import {
  peekSourceSectorIds,
  replaceMembership,
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
  const ordered = [...new Set(sectorIds)].sort();
  for (const sectorId of ordered) {
    await tx.$executeRaw`
      SELECT id FROM "Sector" WHERE id = ${sectorId} FOR NO KEY UPDATE
    `;
  }
  return ordered;
}

function throwVersionConflict(currentVersion: number, expectedVersion: number) {
  throw new AppError(
    409,
    "version_conflict",
    "Sector was updated by another user",
    { expectedVersion, currentVersion },
  );
}

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

  const nextCode = patch.fields.code ?? existing.code;
  const nextNameBg = patch.fields.nameBg ?? existing.nameBg;
  const nextNameEn = patch.fields.nameEn ?? existing.nameEn;
  const nextSupervisor =
    patch.primarySupervisorEmployeeId !== undefined
      ? patch.primarySupervisorEmployeeId
      : existing.primarySupervisorEmployeeId;
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
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
  const owns =
    input.sector.primarySupervisorEmployeeId === input.scope.employeeId;
  if (!owns) {
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
  // Still active → normal access.
  if (input.sector.isActive) return;
  // Already inactive: only hotel-wide actors may mutate (blocked above for sectors).
  throw new AppError(403, "forbidden", OUT_OF_SCOPE);
}

function mapUniqueConflict(err: unknown): never {
  if (isP2002(err)) {
    throw new AppError(409, "conflict", "Sector code already exists");
  }
  throw err;
}

export type SectorSaveActor = {
  employeeId?: string;
  userId?: string;
  role: Role;
};

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
  const propertyId = await resolvePropertyId(input.propertyId);
  const fields = normalizeSectorFields({
    code: input.code,
    nameBg: input.nameBg,
    nameEn: input.nameEn,
  });
  assertValidSectorFields(fields, { requireAll: true });
  await assertSupervisor(input.primarySupervisorEmployeeId);
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
  const locationIds =
    input.locationIds !== undefined
      ? normalizeLocationIds(input.locationIds)
      : undefined;

  // Live-access serialization when supervisor/active flags change (R1):
  // User locks must precede Sector locks (see liveAccessLocks.ts).
  const accessChanging =
    input.primarySupervisorEmployeeId !== undefined ||
    input.isActive !== undefined;

  try {
    await prisma.$transaction(
      async (tx) => {
        const lockedEmployeeIds = new Set<string>();
        if (accessChanging) {
          const peek = await tx.sector.findUnique({
            where: { id },
            select: { primarySupervisorEmployeeId: true },
          });
          if (!peek) {
            throw new AppError(404, "not_found", "Sector not found");
          }
          const targets = [
            peek.primarySupervisorEmployeeId,
            input.primarySupervisorEmployeeId,
          ].filter((employeeId): employeeId is string => Boolean(employeeId));
          for (const employeeId of targets) lockedEmployeeIds.add(employeeId);
          await lockEmployeesForLiveAccess(tx, targets);
        }

        // Destination (+ peeked source sectors when membership changes) in
        // stable id order — prevents AB-BA with concurrent cross-sector moves.
        const sectorLockTargets = [id];
        if (locationIds !== undefined && locationIds.length) {
          sectorLockTargets.push(
            ...(await peekSourceSectorIds(tx, locationIds, id)),
          );
        }
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
          throw new AppError(404, "not_found", "Sector not found");
        }

        // Fail fast on stale version before access re-check / membership work.
        if (existing.version !== input.expectedVersion) {
          throwVersionConflict(existing.version, input.expectedVersion);
        }

        if (accessChanging) {
          const needed = [
            existing.primarySupervisorEmployeeId,
            input.primarySupervisorEmployeeId,
          ].filter((employeeId): employeeId is string => Boolean(employeeId));
          // Supervisor race between peek and sector lock — fail closed / retry
          // instead of taking User locks after Sector (deadlock with SSE).
          if (needed.some((employeeId) => !lockedEmployeeIds.has(employeeId))) {
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
            ? { ...liveScope, kind: "all", sectorIds: [] }
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
            ? await tx.sectorLocation.findMany({
                where: { sectorId: id },
                select: { locationId: true },
              })
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
                ? "sector.save"
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
                ? {
                    locationIds: beforeLocations.map((b) => b.locationId),
                  }
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
        throw new AppError(
          409,
          "conflict",
          "Location already assigned to another sector",
        );
      }
      throw new AppError(409, "conflict", "Sector code already exists");
    }
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
