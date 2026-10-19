/**
 * Sector mutations: create/update metadata and replace location membership.
 * Membership changes go through replaceMembership (scope + transfer checks).
 */
import { Prisma } from "@prisma/client";
// Module dependency import.
import { prisma } from "../../db";
// Module dependency import.
import { AppError } from "../../errors";
// Module dependency import.
import { recordAudit } from "../audit";
// Module dependency import.
import type { DataScope } from "../dataScope";
// Module dependency import.
import { mapSector, sectorInclude } from "./format";
// Module dependency import.
import {
  replaceMembership,
  type SectorMembershipAuth,
} from "./membership";
// Module dependency import.
import { getSector } from "./queries";

/**
 * Prefer explicit propertyId; otherwise the oldest property (single-property hotels).
 *
 * @param explicit - Optional property id from the create payload.
 */
async function resolvePropertyId(explicit?: string) {
  // Explicit id must resolve to an existing property.
  if (explicit) {
    const property = await prisma.property.findUnique({
      where: { id: explicit },
    });
    if (!property) {
      // propertyId on create must reference a configured property row.
      throw new AppError(404, "not_found", "Property not found");
    }
    return property.id;
  }
  // Single-property installs omit propertyId on create.
  const first = await prisma.property.findFirst({ orderBy: { createdAt: "asc" } });
  if (!first) {
    // Cannot create sectors without at least one property seed.
    throw new AppError(400, "validation", "No property configured");
  }
  // Oldest property is the implicit default for single-hotel deployments.
  return first.id;
}

/**
 * Ensure supervisor employee exists when a non-null id is provided.
 *
 * @param employeeId - Nullable supervisor employee id from the patch/create.
 */
async function assertSupervisor(employeeId: string | null | undefined) {
  // Clearing the supervisor (null/undefined) is always allowed.
  if (!employeeId) return;
  // Existence check only — role suitability is enforced elsewhere.
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: true },
  });
  if (!employee) {
    // primarySupervisorEmployeeId must be a real employee id when set.
    throw new AppError(400, "validation", "Supervisor employee not found");
  }
}

/**
 * Create sector; optional initial locationIds run through membership auth.
 *
 * @param input.propertyId - Explicit property or implicit first property.
 * @param input.locationIds - Optional initial membership replace.
 * @param input.scope - Data scope for membership authorization.
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
  // Resolve property (explicit or first) before creating.
  const propertyId = await resolvePropertyId(input.propertyId);
  await assertSupervisor(input.primarySupervisorEmployeeId);
  // Codes are stored uppercase for uniqueness / display consistency.
  const code = input.code.trim().toUpperCase();
  if (!code) {
    throw new AppError(400, "validation", "code is required");
  }

  // Membership auth for optional initial locationIds.
  // replaceMembership enforces scope + cross-sector transfer rules.
  const auth: SectorMembershipAuth = {
    scope: input.scope,
    allowCrossSectorTransfer: input.allowCrossSectorTransfer,
  };

  try {
    const sector = await prisma.$transaction(
      async (tx) => {
        // Create metadata row first; membership follows when locationIds set.
        const created = await tx.sector.create({
          data: {
            propertyId,
            code,
            nameBg: input.nameBg.trim(),
            nameEn: input.nameEn.trim(),
            primarySupervisorEmployeeId:
              input.primarySupervisorEmployeeId ?? null,
            isActive: input.isActive ?? true,
          },
        });
        // Optional initial membership in the same transaction.
        if (input.locationIds?.length) {
          // Initial membership replace in the same TX as sector create.
          await replaceMembership(tx, created.id, input.locationIds, auth);
        }
        // Reload with joins for mapSector.
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
              locationIds: input.locationIds ?? [],
            },
            summary: `Created sector ${created.code}`,
          },
          tx,
        );
        return full;
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
    // DTO includes locations/supervisor joins from sectorInclude.
    return mapSector(sector);
  } catch (err) {
    // Unique (propertyId, code) → friendly conflict for the UI.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new AppError(409, "conflict", "Sector code already exists");
    }
    // Non-unique errors (validation from membership) propagate.
    throw err;
  }
}

/**
 * Patch sector metadata (not membership). Codes uppercased; P2002 → conflict.
 *
 * @param id - Sector primary key.
 * @param input - Partial metadata patch (not location membership).
 */
export async function updateSector(
  id: string,
  input: {
    code?: string;
    nameBg?: string;
    nameEn?: string;
    primarySupervisorEmployeeId?: string | null;
    isActive?: boolean;
    actorEmployeeId?: string;
  },
) {
  // 404 before patching; before-snapshot for audit.
  const existing = await prisma.sector.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Sector not found");
  }
  // Only validate supervisor when the field is present in the patch.
  if (input.primarySupervisorEmployeeId !== undefined) {
    await assertSupervisor(input.primarySupervisorEmployeeId);
  }

  try {
    // Metadata patch + audit — membership is setSectorLocations.
    await prisma.$transaction(async (tx) => {
      // Partial metadata patch — membership is setSectorLocations.
      await tx.sector.update({
        where: { id },
        data: {
          ...(input.code !== undefined
            ? { code: input.code.trim().toUpperCase() }
            : {}),
          ...(input.nameBg !== undefined ? { nameBg: input.nameBg.trim() } : {}),
          ...(input.nameEn !== undefined ? { nameEn: input.nameEn.trim() } : {}),
          ...(input.primarySupervisorEmployeeId !== undefined
            ? {
                primarySupervisorEmployeeId: input.primarySupervisorEmployeeId,
              }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      // Compact before/after of metadata fields only.
      await recordAudit(
        {
          actorEmployeeId: input.actorEmployeeId,
          action: "sector.update",
          entityType: "sector",
          entityId: id,
          before: {
            code: existing.code,
            nameBg: existing.nameBg,
            nameEn: existing.nameEn,
            primarySupervisorEmployeeId: existing.primarySupervisorEmployeeId,
            isActive: existing.isActive,
          },
          after: {
            code: input.code?.trim().toUpperCase() ?? existing.code,
            nameBg: input.nameBg?.trim() ?? existing.nameBg,
            nameEn: input.nameEn?.trim() ?? existing.nameEn,
            primarySupervisorEmployeeId:
              input.primarySupervisorEmployeeId !== undefined
                ? input.primarySupervisorEmployeeId
                : existing.primarySupervisorEmployeeId,
            isActive: input.isActive ?? existing.isActive,
          },
          summary: `Updated sector ${existing.code}`,
        },
        tx,
      );
    });
  } catch (err) {
    // Unique (propertyId, code) on metadata patch.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new AppError(409, "conflict", "Sector code already exists");
    }
    throw err;
  }

  // Reload mapped DTO after commit.
  return getSector(id);
}

/**
 * Authoritative membership replace for one sector (TOCTOU-safe via transaction).
 * Requires scope + allowCrossSectorTransfer for foreign/unassigned moves.
 *
 * @param id - Sector primary key.
 * @param locationIds - Full replacement membership list.
 * @param options.scope - Data scope for replaceMembership auth.
 * @param options.allowCrossSectorTransfer - Permits moving locations from other sectors.
 */
export async function setSectorLocations(
  id: string,
  locationIds: string[],
  options: {
    actorEmployeeId?: string;
    scope: DataScope;
    allowCrossSectorTransfer: boolean;
  },
) {
  const existing = await prisma.sector.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Sector not found");
  }
  // Snapshot prior membership for the audit before/after.
  // Read outside TX is OK — replaceMembership re-validates under row locks.
  const before = await prisma.sectorLocation.findMany({
    where: { sectorId: id },
    select: { locationId: true },
  });
  const auth: SectorMembershipAuth = {
    scope: options.scope,
    allowCrossSectorTransfer: options.allowCrossSectorTransfer,
  };
  // Membership replace + audit in one transaction (TOCTOU-safe under locks).
  try {
    // Allow waiting on Location/Sector row locks under contention (default 5s is too short).
    await prisma.$transaction(
      async (tx) => {
        // Sector FOR NO KEY UPDATE + Location FOR UPDATE + re-read/retry inside.
        await replaceMembership(tx, id, locationIds, auth);
        await recordAudit(
          {
            actorEmployeeId: options.actorEmployeeId,
            action: "sector.locations.set",
            entityType: "sector",
            entityId: id,
            before: { locationIds: before.map((b) => b.locationId) },
            after: { locationIds },
            summary: `Updated locations for sector ${existing.code}`,
          },
          tx,
        );
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new AppError(
        409,
        "conflict",
        "Location already assigned to another sector",
      );
    }
    throw err;
  }
  // Reload sector DTO with fresh location membership joins.
  return getSector(id);
}
