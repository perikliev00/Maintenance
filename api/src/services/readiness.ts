/**
 * Pure room/common-area readiness: ready | not_ready | needs_check with reason codes.
 * Unknown occupancy/service (rooms) or unknown service (common areas) short-circuits
 * to needs_check before hard not_ready blockers are evaluated.
 */
import {
  CatalogStatus,
  CleaningStatus,
  LocationKind,
  Occupancy,
  ServiceStatus,
} from "@prisma/client";

export type ReadinessResult = "ready" | "not_ready" | "needs_check";

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
  // Accumulated reason codes for the UI chip / tooltip.
  const reasons: string[] = [];
  // Common areas skip occupancy checks entirely.
  const isCommonArea = room.kind === LocationKind.common_area;

  // Archived catalog rows are never sellable/usable.
  if (room.catalogStatus !== CatalogStatus.active) {
    reasons.push("archived");
    return { readiness: "not_ready", reasons };
  }

  // Incomplete state → needs_check (operators must verify before sell/use).
  if (isCommonArea) {
    // Common areas ignore occupancy; only service unknown short-circuits.
    if (room.serviceStatus === ServiceStatus.unknown) {
      reasons.push("service_unknown");
      return { readiness: "needs_check", reasons };
    }
  } else if (
    room.occupancy === Occupancy.unknown ||
    room.serviceStatus === ServiceStatus.unknown
  ) {
    // Rooms: either unknown occupancy or unknown service → needs_check.
    if (room.occupancy === Occupancy.unknown) reasons.push("occupancy_unknown");
    if (room.serviceStatus === ServiceStatus.unknown) reasons.push("service_unknown");
    return { readiness: "needs_check", reasons };
  }

  // Hard blockers accumulate; any reason → not_ready (unless none).
  if (room.hasBlockingTicket) reasons.push("blocking_issue");
  // Rooms must be vacant; common areas ignore occupancy.
  if (!isCommonArea && room.occupancy !== Occupancy.vacant) {
    reasons.push("not_vacant");
  }
  // Cleaning must be verified_clean (reason encodes the actual status).
  if (room.cleaningStatus !== CleaningStatus.verified_clean) {
    reasons.push(`cleaning_${room.cleaningStatus}`);
  }
  // Service must be in_service (out_of_service / other → blocker).
  if (room.serviceStatus !== ServiceStatus.in_service) {
    reasons.push("out_of_service");
  }

  // No hard blockers → sellable / usable.
  if (reasons.length === 0) {
    return { readiness: "ready", reasons: [] };
  }

  // One or more hard blockers → not_ready with the accumulated reason codes.
  return { readiness: "not_ready", reasons };
}
