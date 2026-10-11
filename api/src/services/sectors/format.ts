import { Prisma } from "@prisma/client";
import { AppError } from "../../errors";

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function assertHhMm(value: string, field: string) {
  if (!HH_MM.test(value)) {
    throw new AppError(400, "validation", `${field} must be HH:mm`);
  }
}

export const sectorInclude = {
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

export function mapSector(
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
