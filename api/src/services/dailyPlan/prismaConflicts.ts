/**
 * Identify DailyPlanEntry unique races (distinct from CleaningTask uniques).
 */
import { Prisma } from "@prisma/client";
// Import ../db/prismaErrors for dailyPlan/prismaConflicts.ts.
import { isP2002, p2002Targets } from "../db/prismaErrors";

// Expose selected symbols from this module.
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
  // Branch when this condition holds for the domain rule.
  if (
    // Execute: lower.some((t) =>
    lower.some((t) =>
      // Execute: t.includes("dailyplanentry_hoteldate_locationid_category"),
      t.includes("dailyplanentry_hoteldate_locationid_category"),
    )
  ) {
    // Early return of a terminal empty/boolean result.
    return true;
  }
  // Column-array form from Prisma.
  const hasHotelDate = targets.includes("hotelDate");
  const hasLocationId = targets.includes("locationId");
  const hasCategory = targets.includes("category");
  // Branch when this condition holds for the domain rule.
  if (hasHotelDate && hasLocationId && hasCategory) {
    // Early return of a terminal empty/boolean result.
    return true;
  }
  // Early return of a terminal empty/boolean result.
  return false;
}
