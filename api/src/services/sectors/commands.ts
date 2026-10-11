import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { recordAudit } from "../audit";
import type { DataScope } from "../dataScope";
import { mapSector, sectorInclude } from "./format";
import {
  replaceMembership,
  type SectorMembershipAuth,
} from "./membership";
import { getSector } from "./queries";

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
