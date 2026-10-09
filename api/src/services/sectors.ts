import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { recordAudit } from "./audit";
import type { DataScope } from "./dataScope";

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const OUT_OF_SCOPE = "Outside your permitted data scope";

export type SectorMembershipAuth = {
  scope: DataScope;
  allowCrossSectorTransfer: boolean;
};

export function assertHhMm(value: string, field: string) {
  if (!HH_MM.test(value)) {
    throw new AppError(400, "validation", `${field} must be HH:mm`);
  }
}

const sectorInclude = {
  primarySupervisor: {
    select: { id: true, fullName: true, employeeNumber: true },
  },
  locations: {
    include: {
      location: {
        select: {
          id: true,
          number: true,
          kind: true,
          floor: {
            select: {
              number: true,
              building: { select: { code: true, name: true } },
            },
          },
        },
      },
    },
  },
  _count: { select: { locations: true } },
} satisfies Prisma.SectorInclude;

function mapSector(
  sector: Prisma.SectorGetPayload<{ include: typeof sectorInclude }>,
) {
  return {
    id: sector.id,
    propertyId: sector.propertyId,
    code: sector.code,
    nameBg: sector.nameBg,
    nameEn: sector.nameEn,
    isActive: sector.isActive,
    primarySupervisor: sector.primarySupervisor
      ? {
          id: sector.primarySupervisor.id,
          fullName: sector.primarySupervisor.fullName,
          employeeNumber: sector.primarySupervisor.employeeNumber,
        }
      : null,
    locationCount: sector._count.locations,
    locations: sector.locations.map((sl) => ({
      id: sl.location.id,
      number: sl.location.number,
      kind: sl.location.kind,
      floor: sl.location.floor.number,
      buildingCode: sl.location.floor.building.code,
      building: sl.location.floor.building.name,
    })),
    locationIds: sector.locations.map((sl) => sl.locationId),
    createdAt: sector.createdAt,
    updatedAt: sector.updatedAt,
  };
}

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

export async function listSectors(
  includeInactive = false,
  scopeFilter?: Prisma.SectorWhereInput,
) {
  const rows = await prisma.sector.findMany({
    where: {
      ...(includeInactive ? {} : { isActive: true }),
      ...(scopeFilter ?? {}),
    },
    include: sectorInclude,
    orderBy: [{ code: "asc" }],
  });
  return rows.map(mapSector);
}

/** Active sectors where the employee is primary supervisor (§5 „свои сектори“). */
export async function listMySectors(employeeId: string) {
  const rows = await prisma.sector.findMany({
    where: {
      primarySupervisorEmployeeId: employeeId,
      isActive: true,
    },
    include: sectorInclude,
    orderBy: [{ code: "asc" }],
  });
  return rows.map(mapSector);
}

export async function getSector(id: string) {
  const sector = await prisma.sector.findUnique({
    where: { id },
    include: sectorInclude,
  });
  if (!sector) {
    throw new AppError(404, "not_found", "Sector not found");
  }
  return mapSector(sector);
}

async function assertSupervisor(employeeId: string | null | undefined) {
  if (!employeeId) return;
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: true },
  });
  if (!employee) {
    throw new AppError(400, "validation", "Supervisor employee not found");
  }
}

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
async function replaceMembership(
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
  await assertSupervisor(input.primarySupervisorEmployeeId);
  const code = input.code.trim().toUpperCase();
  if (!code) {
    throw new AppError(400, "validation", "code is required");
  }

  const auth: SectorMembershipAuth = {
    scope: input.scope,
    allowCrossSectorTransfer: input.allowCrossSectorTransfer,
  };

  try {
    const sector = await prisma.$transaction(async (tx) => {
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
      if (input.locationIds?.length) {
        await replaceMembership(tx, created.id, input.locationIds, auth);
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
            locationIds: input.locationIds ?? [],
          },
          summary: `Created sector ${created.code}`,
        },
        tx,
      );
      return full;
    });
    return mapSector(sector);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new AppError(409, "conflict", "Sector code already exists");
    }
    throw err;
  }
}

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
  const existing = await prisma.sector.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Sector not found");
  }
  if (input.primarySupervisorEmployeeId !== undefined) {
    await assertSupervisor(input.primarySupervisorEmployeeId);
  }

  try {
    await prisma.$transaction(async (tx) => {
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
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new AppError(409, "conflict", "Sector code already exists");
    }
    throw err;
  }

  return getSector(id);
}

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
  const before = await prisma.sectorLocation.findMany({
    where: { sectorId: id },
    select: { locationId: true },
  });
  const auth: SectorMembershipAuth = {
    scope: options.scope,
    allowCrossSectorTransfer: options.allowCrossSectorTransfer,
  };
  await prisma.$transaction(async (tx) => {
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
  });
  return getSector(id);
}

export {
  assertActiveShiftId,
  createShift,
  getEmployeeRosterShiftId,
  listShiftRoster,
  listShifts,
  updateShift,
  upsertShiftRoster,
} from "./shifts";
