import {
  CleaningServiceType,
  DailyPlanCategory,
  LocationKind,
} from "@prisma/client";

/** Derive work type for comparable analytics (референция §6.1 / §9). */
export function deriveCleaningServiceType(input: {
  locationKind: LocationKind;
  serviceType?: CleaningServiceType;
  planCategory?: DailyPlanCategory;
}): CleaningServiceType {
  if (input.serviceType) return input.serviceType;
  if (input.locationKind !== LocationKind.room) {
    return CleaningServiceType.common_area;
  }
  if (input.planCategory === DailyPlanCategory.departure) {
    return CleaningServiceType.departure;
  }
  if (input.planCategory === DailyPlanCategory.arrival) {
    return CleaningServiceType.arrival;
  }
  return CleaningServiceType.stayover;
}
