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
  CatalogStatus,
  CleaningStatus,
  LocationKind,
  Occupancy,
  ServiceStatus,
} from "@prisma/client";

// Declare type ReadinessResult for callers and internals.
export type ReadinessResult = "ready" | "not_ready" | "needs_check";

// Declare type RoomState for callers and internals.
export type RoomState = {
  kind?: LocationKind;
  catalogStatus: CatalogStatus;
  occupancy: Occupancy;
  cleaningStatus: CleaningStatus;
  serviceStatus: ServiceStatus;
  hasBlockingTicket?: boolean;
};

/**
 * Evaluate readiness from catalog/occupancy/cleaning/service/blocking flags.
 * Common areas ignore occupancy; rooms require vacant + verified_clean + in_service.
 */
export function computeReadiness(room: RoomState): {
  readiness: ReadinessResult;
  reasons: string[];
} {
  // Capture is common area for use in this scope.
  const isCommonArea = room.kind === LocationKind.common_area;

  if (room.catalogStatus !== CatalogStatus.active) {
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
  if (room.serviceStatus === ServiceStatus.unknown) {
    // Append an entry to the accumulating collection.
    unknownReasons.push("service_unknown");
  }

  // Hard blockers.
  if (room.hasBlockingTicket) hardReasons.push("blocking_issue");

  if (
    !isCommonArea &&
    room.occupancy !== Occupancy.unknown &&
    room.occupancy !== Occupancy.vacant
  ) {
    // Append an entry to the accumulating collection.
    hardReasons.push("not_vacant");
  }

  if (room.cleaningStatus !== CleaningStatus.verified_clean) {
    // Append an entry to the accumulating collection.
    hardReasons.push(`cleaning_${room.cleaningStatus}`);
  }

  if (
    room.serviceStatus !== ServiceStatus.unknown &&
    room.serviceStatus !== ServiceStatus.in_service
  ) {
    // Append an entry to the accumulating collection.
    hardReasons.push("out_of_service");
  }

  // Hard blockers win; include unknowns for operator visibility.
  if (hardReasons.length > 0) {
    return {
      readiness: "not_ready",
      reasons: [...hardReasons, ...unknownReasons],
    };
  }

  if (unknownReasons.length > 0) {
    return { readiness: "needs_check", reasons: unknownReasons };
  }

  return { readiness: "ready", reasons: [] };
}
