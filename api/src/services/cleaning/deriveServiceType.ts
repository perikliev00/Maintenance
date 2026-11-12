// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  CleaningServiceType,
  // Carry this field through the payload or query.
  DailyPlanCategory,
  // Carry this field through the payload or query.
  LocationKind,
// Execute: } from "@prisma/client";
} from "@prisma/client";

/**
 * Derive work type for comparable analytics (референция §6.1 / §9).
 * Explicit serviceType wins; otherwise infer from location kind + plan category.
 */
export function deriveCleaningServiceType(input: {
  // Carry this field through the payload or query.
  locationKind: LocationKind;
  // Parameter/field in the surrounding signature or type.
  serviceType?: CleaningServiceType;
  // Parameter/field in the surrounding signature or type.
  planCategory?: DailyPlanCategory;
// Begin block/object for the following statements.
}): CleaningServiceType {
  // Caller already stamped a type — do not override.
  if (input.serviceType) return input.serviceType;
  // Non-room locations always count as common-area cleaning.
  if (input.locationKind !== LocationKind.room) {
    // Return the computed result to the caller.
    return CleaningServiceType.common_area;
  }
  // Departure / arrival plan rows map directly; everything else is stayover.
  if (input.planCategory === DailyPlanCategory.departure) {
    // Return the computed result to the caller.
    return CleaningServiceType.departure;
  }
  // Branch when this condition holds for the domain rule.
  if (input.planCategory === DailyPlanCategory.arrival) {
    // Return the computed result to the caller.
    return CleaningServiceType.arrival;
  }
  // Return the computed result to the caller.
  return CleaningServiceType.stayover;
}
