import {
  CatalogStatus,
  CleaningStatus,
  Occupancy,
  ServiceStatus,
} from "@prisma/client";

export type ReadinessResult = "ready" | "not_ready" | "needs_check";

export type RoomState = {
  catalogStatus: CatalogStatus;
  occupancy: Occupancy;
  cleaningStatus: CleaningStatus;
  serviceStatus: ServiceStatus;
  hasBlockingTicket?: boolean;
};

export function computeReadiness(room: RoomState): {
  readiness: ReadinessResult;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (room.catalogStatus !== CatalogStatus.active) {
    reasons.push("archived");
    return { readiness: "not_ready", reasons };
  }

  if (
    room.occupancy === Occupancy.unknown ||
    room.serviceStatus === ServiceStatus.unknown
  ) {
    if (room.occupancy === Occupancy.unknown) reasons.push("occupancy_unknown");
    if (room.serviceStatus === ServiceStatus.unknown) reasons.push("service_unknown");
    return { readiness: "needs_check", reasons };
  }

  if (room.hasBlockingTicket) reasons.push("blocking_issue");
  if (room.occupancy !== Occupancy.vacant) reasons.push("not_vacant");
  if (room.cleaningStatus !== CleaningStatus.verified_clean) {
    reasons.push(`cleaning_${room.cleaningStatus}`);
  }
  if (room.serviceStatus !== ServiceStatus.in_service) {
    reasons.push("out_of_service");
  }

  if (reasons.length === 0) {
    return { readiness: "ready", reasons: [] };
  }

  return { readiness: "not_ready", reasons };
}
