import {
  CatalogStatus,
  LocationKind,
  Occupancy,
  Prisma,
  ServiceStatus,
} from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import { recordAudit } from "../audit";
import { locationInclude } from "./types";

export async function findActiveLocations(
  kind: LocationKind,
  scopeFilter?: Prisma.LocationWhereInput,
) {
  return prisma.location.findMany({
    where: { catalogStatus: "active", kind, ...(scopeFilter ?? {}) },
    include: locationInclude,
    orderBy: [{ floor: { number: "asc" } }, { number: "asc" }],
  });
}

export async function findLocationById(id: string, kind?: LocationKind) {
  const location = await prisma.location.findUnique({
    where: { id },
    include: locationInclude,
  });
  if (!location) return null;
  if (kind && location.kind !== kind) return null;
  return location;
}

export async function findLocationByQrToken(token: string) {
  return prisma.location.findUnique({
    where: { qrToken: token },
    include: locationInclude,
  });
}

export function locationQrPayload(location: {
  id: string;
  qrToken: string;
  number: string;
  kind: LocationKind;
  floor: { number: number; building: { code: string } };
}) {
  const origin =
    process.env.WEB_ORIGIN?.replace(/\/$/, "") || "http://localhost:5173";
  const scanUrl = `${origin}/#/room-qr/${location.qrToken}`;
  return {
    locationId: location.id,
    qrToken: location.qrToken,
    scanUrl,
    label: `${location.floor.building.code} ${location.number}`,
    kind: location.kind,
    buildingCode: location.floor.building.code,
    floor: location.floor.number,
    number: location.number,
  };
}

export async function getLocationHierarchy() {
  const buildings = await prisma.building.findMany({
    include: {
      floors: {
        orderBy: { number: "asc" },
        select: { id: true, number: true, name: true },
      },
    },
    orderBy: { code: "asc" },
  });
  return buildings.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    floors: b.floors.map((f) => ({
      id: f.id,
      number: f.number,
      name: f.name,
    })),
  }));
}

export async function listLocationsCatalog(input: {
  kind?: LocationKind;
  includeArchived?: boolean;
  scopeFilter?: Prisma.LocationWhereInput;
}) {
  const where: Prisma.LocationWhereInput = {
    ...(input.scopeFilter ?? {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.includeArchived
      ? {}
      : { catalogStatus: CatalogStatus.active }),
  };
  return prisma.location.findMany({
    where,
    include: locationInclude,
    orderBy: [
      { catalogStatus: "asc" },
      { floor: { building: { code: "asc" } } },
      { floor: { number: "asc" } },
      { number: "asc" },
    ],
  });
}

async function assertFloorExists(floorId: string) {
  const floor = await prisma.floor.findUnique({
    where: { id: floorId },
    select: { id: true },
  });
  if (!floor) {
    throw new AppError(404, "not_found", "Floor not found");
  }
}

function conflictFromPrisma(err: unknown): never {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new AppError(
      409,
      "conflict",
      "A location with this number already exists on that floor",
    );
  }
  throw err;
}

export async function createLocation(input: {
  floorId: string;
  number: string;
  kind?: LocationKind;
  occupancy?: Occupancy;
  serviceStatus?: ServiceStatus;
  actorEmployeeId?: string;
}) {
  const number = input.number.trim();
  if (!number) {
    throw new AppError(400, "validation", "number is required");
  }
  await assertFloorExists(input.floorId);
  const kind = input.kind ?? LocationKind.room;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.location.create({
        data: {
          floorId: input.floorId,
          number,
          kind,
          occupancy:
            input.occupancy ??
            (kind === LocationKind.common_area
              ? Occupancy.vacant
              : Occupancy.unknown),
          serviceStatus: input.serviceStatus ?? ServiceStatus.in_service,
        },
        include: locationInclude,
      });
      await recordAudit({
        actorEmployeeId: input.actorEmployeeId,
        action: "location.create",
        entityType: "location",
        entityId: row.id,
        locationId: row.id,
        after: {
          floorId: row.floorId,
          number: row.number,
          kind: row.kind,
          occupancy: row.occupancy,
          serviceStatus: row.serviceStatus,
        },
        summary: `Created ${row.kind} ${row.number}`,
      }, tx);
      return row;
    });
    publish("location.changed", { locationId: created.id });
    return created;
  } catch (err) {
    conflictFromPrisma(err);
  }
}

export async function updateLocation(
  id: string,
  input: {
    floorId?: string;
    number?: string;
    kind?: LocationKind;
    actorEmployeeId?: string;
  },
) {
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Location not found");
  }
  if (input.floorId !== undefined) {
    await assertFloorExists(input.floorId);
  }
  const number =
    input.number !== undefined ? input.number.trim() : undefined;
  if (number !== undefined && !number) {
    throw new AppError(400, "validation", "number is required");
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.location.update({
        where: { id },
        data: {
          ...(input.floorId !== undefined ? { floorId: input.floorId } : {}),
          ...(number !== undefined ? { number } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
        },
        include: locationInclude,
      });
      await recordAudit({
        actorEmployeeId: input.actorEmployeeId,
        action: "location.update",
        entityType: "location",
        entityId: id,
        locationId: id,
        before: {
          floorId: existing.floorId,
          number: existing.number,
          kind: existing.kind,
        },
        after: {
          floorId: row.floorId,
          number: row.number,
          kind: row.kind,
        },
        summary: `Updated location ${row.number}`,
      }, tx);
      return row;
    });
    publish("location.changed", { locationId: updated.id });
    return updated;
  } catch (err) {
    conflictFromPrisma(err);
  }
}

export async function archiveLocation(id: string, actorEmployeeId?: string) {
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Location not found");
  }
  if (existing.catalogStatus === CatalogStatus.archived) {
    const full = await findLocationById(id);
    return full!;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.location.update({
      where: { id },
      data: { catalogStatus: CatalogStatus.archived },
      include: locationInclude,
    });
    await recordAudit({
      actorEmployeeId,
      action: "location.archive",
      entityType: "location",
      entityId: id,
      locationId: id,
      before: { catalogStatus: existing.catalogStatus },
      after: { catalogStatus: CatalogStatus.archived },
      summary: `Archived location ${row.number}`,
    }, tx);
    return row;
  });
  publish("location.changed", { locationId: updated.id });
  return updated;
}

export async function restoreLocation(id: string, actorEmployeeId?: string) {
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Location not found");
  }
  if (existing.catalogStatus === CatalogStatus.active) {
    const full = await findLocationById(id);
    return full!;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.location.update({
      where: { id },
      data: { catalogStatus: CatalogStatus.active },
      include: locationInclude,
    });
    await recordAudit({
      actorEmployeeId,
      action: "location.restore",
      entityType: "location",
      entityId: id,
      locationId: id,
      before: { catalogStatus: existing.catalogStatus },
      after: { catalogStatus: CatalogStatus.active },
      summary: `Restored location ${row.number}`,
    }, tx);
    return row;
  });
  publish("location.changed", { locationId: updated.id });
  return updated;
}
