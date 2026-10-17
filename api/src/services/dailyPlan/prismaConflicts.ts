/**
 * Identify DailyPlanEntry unique races (distinct from CleaningTask uniques).
 */
import { Prisma } from "@prisma/client";

/** True when err is a Prisma unique-constraint violation (P2002). */
export function isP2002(
  err: unknown,
): err is Prisma.PrismaClientKnownRequestError {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

function p2002Targets(err: Prisma.PrismaClientKnownRequestError): string[] {
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === "string") return [target];
  return [];
}

/**
 * True when P2002 is the (hotelDate, locationId, category) plan-entry unique
 * — not CleaningTask_one_active_per_room_date or (source, externalId).
 */
export function isDailyPlanEntryDateLocCategoryConflict(
  err: Prisma.PrismaClientKnownRequestError,
): boolean {
  const targets = p2002Targets(err);
  const lower = targets.map((t) => t.toLowerCase());
  if (
    lower.some((t) =>
      t.includes("dailyplanentry_hoteldate_locationid_category"),
    )
  ) {
    return true;
  }
  // Column-array form from Prisma.
  const hasHotelDate = targets.includes("hotelDate");
  const hasLocationId = targets.includes("locationId");
  const hasCategory = targets.includes("category");
  if (hasHotelDate && hasLocationId && hasCategory) {
    return true;
  }
  return false;
}
