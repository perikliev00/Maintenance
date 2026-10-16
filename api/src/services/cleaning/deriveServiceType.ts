import {
  CleaningServiceType,
  DailyPlanCategory,
  LocationKind,
} from "@prisma/client";

/**
 * Derive work type for comparable analytics (референция §6.1 / §9).
 * Explicit serviceType wins; otherwise infer from location kind + plan category.
 */
export function deriveCleaningServiceType(input: {
  locationKind: LocationKind;
  serviceType?: CleaningServiceType;
  planCategory?: DailyPlanCategory;
}): CleaningServiceType {
  // Caller already stamped a type — do not override.
  if (input.serviceType) return input.serviceType;
  // Non-room locations always count as common-area cleaning.
  if (input.locationKind !== LocationKind.room) {
    return CleaningServiceType.common_area;
  }
  // Departure / arrival plan rows map directly; everything else is stayover.
  if (input.planCategory === DailyPlanCategory.departure) {
    return CleaningServiceType.departure;
  }
  if (input.planCategory === DailyPlanCategory.arrival) {
    return CleaningServiceType.arrival;
  }
  return CleaningServiceType.stayover;
}
