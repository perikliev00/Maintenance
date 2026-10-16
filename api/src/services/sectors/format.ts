/**
 * Shared Prisma include and API mapping for sector responses.
 */
import { Prisma } from "@prisma/client";

/**
 * Nested joins used by list/get/my sector queries.
 * Includes primary supervisor, location memberships with floor/building,
 * and a membership count for the sector list.
 */
export const sectorInclude = {
  // Supervisor card for the sector header / assignment UI.
  primarySupervisor: {
    select: { id: true, fullName: true, employeeNumber: true },
  },
  // Membership rows with enough location context for the editor.
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
  // Aggregate used as locationCount without shipping every row on list views.
  _count: { select: { locations: true } },
} satisfies Prisma.SectorInclude;

/**
 * Flatten sector + memberships into the public API shape (locations + ids).
 * `locationIds` is a convenience list for replaceMembership / checkbox state.
 */
export function mapSector(
  sector: Prisma.SectorGetPayload<{ include: typeof sectorInclude }>,
) {
  // Flatten membership join + floor/building into the public sector DTO.
  return {
    id: sector.id,
    propertyId: sector.propertyId,
    code: sector.code,
    nameBg: sector.nameBg,
    nameEn: sector.nameEn,
    isActive: sector.isActive,
    // Null when no primary supervisor is configured.
    primarySupervisor: sector.primarySupervisor
      ? {
          id: sector.primarySupervisor.id,
          fullName: sector.primarySupervisor.fullName,
          employeeNumber: sector.primarySupervisor.employeeNumber,
        }
      : null,
    // Prefer Prisma _count over locations.length for list consistency.
    locationCount: sector._count.locations,
    // Location cards for the sector editor / membership UI.
    locations: sector.locations.map((sl) => ({
      id: sl.location.id,
      number: sl.location.number,
      kind: sl.location.kind,
      floor: sl.location.floor.number,
      buildingCode: sl.location.floor.building.code,
      building: sl.location.floor.building.name,
    })),
    // Convenience id list for replaceMembership / checkbox state.
    locationIds: sector.locations.map((sl) => sl.locationId),
    createdAt: sector.createdAt,
    updatedAt: sector.updatedAt,
  };
}
