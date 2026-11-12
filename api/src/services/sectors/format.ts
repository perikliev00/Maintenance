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
    // Set select on the structure being built.
    select: { id: true, fullName: true, employeeNumber: true },
  },
  // Membership rows with enough location context for the editor.
  locations: {
    // Set include on the structure being built.
    include: {
      // Set location on the structure being built.
      location: {
        // Set select on the structure being built.
        select: {
          // Set id on the structure being built.
          id: true,
          // Set number on the structure being built.
          number: true,
          // Set kind on the structure being built.
          kind: true,
          // Set catalogStatus on the structure being built.
          catalogStatus: true,
          // Set floor on the structure being built.
          floor: {
            // Set select on the structure being built.
            select: {
              // Set number on the structure being built.
              number: true,
              // Set building on the structure being built.
              building: { select: { code: true, name: true } },
            },
          },
        },
      },
    },
  },
  // Aggregate used as locationCount without shipping every row on list views.
  _count: { select: { locations: true } },
// Run next step: } satisfies Prisma.SectorInclude;
} satisfies Prisma.SectorInclude;

/**
 * Flatten sector + memberships into the public API shape (locations + ids).
 * `locationIds` is a convenience list for replaceMembership / checkbox state.
 */
export function mapSector(
  // Set sector on the structure being built.
  sector: Prisma.SectorGetPayload<{ include: typeof sectorInclude }>,
// Run next step: ) {
) {
  // Flatten membership join + floor/building into the public sector DTO.
  return {
    // Set id on the structure being built.
    id: sector.id,
    // Set propertyId on the structure being built.
    propertyId: sector.propertyId,
    // Set code on the structure being built.
    code: sector.code,
    // Set nameBg on the structure being built.
    nameBg: sector.nameBg,
    // Set nameEn on the structure being built.
    nameEn: sector.nameEn,
    // Set isActive on the structure being built.
    isActive: sector.isActive,
    // Set version on the structure being built.
    version: sector.version,
    // Null when no primary supervisor is configured.
    primarySupervisor: sector.primarySupervisor
      // Complete the ternary or optional chain started above.
      ? {
          // Set id on the structure being built.
          id: sector.primarySupervisor.id,
          // Set fullName on the structure being built.
          fullName: sector.primarySupervisor.fullName,
          // Set employeeNumber on the structure being built.
          employeeNumber: sector.primarySupervisor.employeeNumber,
        }
      // Complete the ternary or optional chain started above.
      : null,
    // Prefer Prisma _count over locations.length for list consistency.
    locationCount: sector._count.locations,
    // Location cards for the sector editor / membership UI.
    locations: sector.locations.map((sl) => ({
      // Set id on the structure being built.
      id: sl.location.id,
      // Set number on the structure being built.
      number: sl.location.number,
      // Set kind on the structure being built.
      kind: sl.location.kind,
      // Set catalogStatus on the structure being built.
      catalogStatus: sl.location.catalogStatus,
      // Set floor on the structure being built.
      floor: sl.location.floor.number,
      // Set buildingCode on the structure being built.
      buildingCode: sl.location.floor.building.code,
      // Set building on the structure being built.
      building: sl.location.floor.building.name,
    })),
    // Convenience id list for replaceMembership / checkbox state.
    locationIds: sector.locations.map((sl) => sl.locationId),
    // Set createdAt on the structure being built.
    createdAt: sector.createdAt,
    // Set updatedAt on the structure being built.
    updatedAt: sector.updatedAt,
  };
}
