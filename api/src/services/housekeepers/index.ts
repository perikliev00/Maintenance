// Re-export selected symbols for barrel consumers.
export {
  assertReassignAvailability,
  AVAILABILITY_OVERRIDE_ROLES,
  classifyAvailability,
  evaluateEmployeeAvailability,
  listAvailableHousekeepers,
  OVERRIDABLE_AVAILABILITY,
  // Declare type AvailabilityStatus for callers and internals.
  type AvailabilityStatus,
  // Declare type AvailableHousekeepersResult for callers and internals.
  type AvailableHousekeepersResult,
  // Declare type HousekeeperAvailability for callers and internals.
  type HousekeeperAvailability,
} from "./availability";
