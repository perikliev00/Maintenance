/**
 * Shared location display helpers and Prisma include for building + floor.
 */
import type { Prisma } from "@prisma/client";

/** Nested floor/building include shared by analytics and live ops queries. */
export const locationWithBuildingInclude = {
  floor: { include: { building: true } },
} as const satisfies Prisma.LocationInclude;

export type LocationWithBuilding = Prisma.LocationGetPayload<{
  include: typeof locationWithBuildingInclude;
}>;

/** Compact label: building code + room number (e.g. "A 101"). */
export function formatLocationLabel(location: {
  number: string;
  floor: { building: { code: string } };
}): string {
  return `${location.floor.building.code} ${location.number}`;
}

/** Same label without the full nested type (floor number only when needed). */
export function formatLocationBrief(location: {
  number: string;
  buildingCode: string;
  floor?: number;
}): string {
  if (location.floor != null) {
    return `${location.buildingCode} ${location.floor}-${location.number}`;
  }
  return `${location.buildingCode} ${location.number}`;
}
