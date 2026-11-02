/**
 * Identify DailyPlanEntry unique races (distinct from CleaningTask uniques).
 */
import { Prisma } from "@prisma/client";
import { isP2002, p2002Targets } from "../db/prismaErrors";

export { isP2002, p2002Targets };

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
