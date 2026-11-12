/**
 * Shared location display helpers and Prisma include for building + floor.
 */
import type { Prisma } from "@prisma/client";

/** Nested floor/building include shared by analytics and live ops queries. */
export const locationWithBuildingInclude = {
  // Field floor on this type/payload.
  floor: { include: { building: true } },
// Support the surrounding control flow.
} as const satisfies Prisma.LocationInclude;

// Public type LocationWithBuilding for callers of this service.
export type LocationWithBuilding = Prisma.LocationGetPayload<{
  // Include relations for labels/checks.
  include: typeof locationWithBuildingInclude;
// Support the surrounding control flow.
}>;

/** Compact label: building code + room number (e.g. "A 101"). */
export function formatLocationLabel(location: {
  // Param number required by this function.
  number: string;
  // Param floor required by this function.
  floor: { building: { code: string } };
// Support the surrounding control flow.
}): string {
  // Return computed result.
  return `${location.floor.building.code} ${location.number}`;
}

/** Same label without the full nested type (floor number only when needed). */
export function formatLocationBrief(location: {
  // Param number required by this function.
  number: string;
  // Param buildingCode required by this function.
  buildingCode: string;
  // Param floor required by this function.
  floor?: number;
// Support the surrounding control flow.
}): string {
  // Guard missing required data.
  if (location.floor != null) {
    // Return computed result.
    return `${location.buildingCode} ${location.floor}-${location.number}`;
  }
  // Return computed result.
  return `${location.buildingCode} ${location.number}`;
}
