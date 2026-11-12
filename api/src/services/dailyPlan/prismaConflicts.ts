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
  // Carry this field through the payload or query.
  err: Prisma.PrismaClientKnownRequestError,
// Begin block/object for the following statements.
): boolean {
  // Capture targets for subsequent checks or writes.
  const targets = p2002Targets(err);
  // Capture lower for subsequent checks or writes.
  const lower = targets.map((t) => t.toLowerCase());
  // Branch when this condition holds for the domain rule.
  if (
    // Execute: lower.some((t) =>
    lower.some((t) =>
      // Execute: t.includes("dailyplanentry_hoteldate_locationid_category"),
      t.includes("dailyplanentry_hoteldate_locationid_category"),
    )
  // Begin block/object for the following statements.
  ) {
    // Early return of a terminal empty/boolean result.
    return true;
  }
  // Column-array form from Prisma.
  const hasHotelDate = targets.includes("hotelDate");
  // Capture hasLocationId for subsequent checks or writes.
  const hasLocationId = targets.includes("locationId");
  // Capture hasCategory for subsequent checks or writes.
  const hasCategory = targets.includes("category");
  // Branch when this condition holds for the domain rule.
  if (hasHotelDate && hasLocationId && hasCategory) {
    // Early return of a terminal empty/boolean result.
    return true;
  }
  // Early return of a terminal empty/boolean result.
  return false;
}
