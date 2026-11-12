/**
 * Pure room/common-area readiness: ready | not_ready | needs_check with reason codes.
 *
 * Precedence:
 * 1. Archived → not_ready (immediate).
 * 2. Accumulate hard blockers and unknown-field reasons.
 * 3. Any hard blocker → not_ready (unknown reasons still included).
 * 4. Else any unknown → needs_check.
 * 5. Else ready.
 *
 * Hard blockers are never concealed merely because another field is unknown.
 */
import {
  // Run next step: CatalogStatus,
  CatalogStatus,
  // Run next step: CleaningStatus,
  CleaningStatus,
  // Run next step: LocationKind,
  LocationKind,
  // Run next step: Occupancy,
  Occupancy,
  // Run next step: ServiceStatus,
  ServiceStatus,
// Run next step: } from "@prisma/client";
} from "@prisma/client";

// Declare type ReadinessResult for callers and internals.
export type ReadinessResult = "ready" | "not_ready" | "needs_check";

// Declare type RoomState for callers and internals.
export type RoomState = {
  // Run next step: kind?: LocationKind;
  kind?: LocationKind;
  // Set catalogStatus on the structure being built.
  catalogStatus: CatalogStatus;
  // Set occupancy on the structure being built.
  occupancy: Occupancy;
  // Set cleaningStatus on the structure being built.
  cleaningStatus: CleaningStatus;
  // Set serviceStatus on the structure being built.
  serviceStatus: ServiceStatus;
  // Run next step: hasBlockingTicket?: boolean;
  hasBlockingTicket?: boolean;
};

/**
 * Evaluate readiness from catalog/occupancy/cleaning/service/blocking flags.
 * Common areas ignore occupancy; rooms require vacant + verified_clean + in_service.
 */
export function computeReadiness(room: RoomState): {
  // Set readiness on the structure being built.
  readiness: ReadinessResult;
  // Set reasons on the structure being built.
  reasons: string[];
// Run next step: } {
} {
  // Capture is common area for use in this scope.
  const isCommonArea = room.kind === LocationKind.common_area;

  // Branch when this condition holds so the right path runs.
  if (room.catalogStatus !== CatalogStatus.active) {
    // Return the computed result to the caller.
    return { readiness: "not_ready", reasons: ["archived"] };
  }

  // Capture unknown reasons for use in this scope.
  const unknownReasons: string[] = [];
  // Capture hard reasons for use in this scope.
  const hardReasons: string[] = [];

  // Unknown fields (do not early-return — hard blockers must still surface).
  if (!isCommonArea && room.occupancy === Occupancy.unknown) {
    // Append an entry to the accumulating collection.
    unknownReasons.push("occupancy_unknown");
  }
  // Branch when this condition holds so the right path runs.
  if (room.serviceStatus === ServiceStatus.unknown) {
    // Append an entry to the accumulating collection.
    unknownReasons.push("service_unknown");
  }

  // Hard blockers.
  if (room.hasBlockingTicket) hardReasons.push("blocking_issue");

  // Branch when this condition holds so the right path runs.
  if (
    // Run next step: !isCommonArea &&
    !isCommonArea &&
    // Run next step: room.occupancy !== Occupancy.unknown &&
    room.occupancy !== Occupancy.unknown &&
    // Run next step: room.occupancy !== Occupancy.vacant
    room.occupancy !== Occupancy.vacant
  // Run next step: ) {
  ) {
    // Append an entry to the accumulating collection.
    hardReasons.push("not_vacant");
  }

  // Branch when this condition holds so the right path runs.
  if (room.cleaningStatus !== CleaningStatus.verified_clean) {
    // Append an entry to the accumulating collection.
    hardReasons.push(`cleaning_${room.cleaningStatus}`);
  }

  // Branch when this condition holds so the right path runs.
  if (
    // Run next step: room.serviceStatus !== ServiceStatus.unknown &&
    room.serviceStatus !== ServiceStatus.unknown &&
    // Run next step: room.serviceStatus !== ServiceStatus.in_service
    room.serviceStatus !== ServiceStatus.in_service
  // Run next step: ) {
  ) {
    // Append an entry to the accumulating collection.
    hardReasons.push("out_of_service");
  }

  // Hard blockers win; include unknowns for operator visibility.
  if (hardReasons.length > 0) {
    // Return the computed result to the caller.
    return {
      // Set readiness on the structure being built.
      readiness: "not_ready",
      // Set reasons on the structure being built.
      reasons: [...hardReasons, ...unknownReasons],
    };
  }

  // Branch when this condition holds so the right path runs.
  if (unknownReasons.length > 0) {
    // Return the computed result to the caller.
    return { readiness: "needs_check", reasons: unknownReasons };
  }

  // Return the computed result to the caller.
  return { readiness: "ready", reasons: [] };
}
