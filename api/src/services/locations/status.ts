/**
 * Mutate room occupancy and service status with audit + live events.
 * Occupancy is rooms-only; out-of-service triggers ops notifications.
 */
import { LocationKind, Occupancy, ServiceStatus } from "@prisma/client";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ./notify for this service.
import { notifyLocationOutOfService } from "./notify";
// Import module ./mutations for this service.
import { applyLocationChange } from "./mutations";

/**
 * Set room occupancy. No-op (returns current row) when unchanged.
 * Rejects common_area locations.
 */
export async function setLocationOccupancy(
  // Set id on the structure being built.
  id: string,
  // Set occupancy on the structure being built.
  occupancy: Occupancy,
  // Run next step: actorEmployeeId?: string,
  actorEmployeeId?: string,
// Run next step: ) {
) {
  // Return the computed result to the caller.
  return applyLocationChange({
    // Run next step: id,
    id,
    // Run next step: actorEmployeeId,
    actorEmployeeId,
    // Set field on the structure being built.
    field: "occupancy",
    // Set next on the structure being built.
    next: occupancy,
    // Set action on the structure being built.
    action: "location.set_occupancy",
    // Set data on the structure being built.
    data: { occupancy },
    // Set guard on the structure being built.
    guard: (existing) => {
      // Branch when this condition holds so the right path runs.
      if (existing.kind === LocationKind.common_area) {
        // Abort with an error so callers can react.
        throw new AppError(
          // Run next step: 400,
          400,
          // Run next step: "validation",
          "validation",
          // Run next step: "Occupancy applies only to rooms, not common areas",
          "Occupancy applies only to rooms, not common areas",
        );
      }
    },
    // Set isNoop on the structure being built.
    isNoop: (existing) => existing.occupancy === occupancy,
    // Set summary on the structure being built.
    summary: (row) => `Set occupancy of ${row.number} to ${occupancy}`,
  });
}

/** Set in_service / out_of_service; notifies ops when transitioning out. */
export async function setLocationServiceStatus(
  // Set id on the structure being built.
  id: string,
  // Set serviceStatus on the structure being built.
  serviceStatus: ServiceStatus,
  // Run next step: actorEmployeeId?: string,
  actorEmployeeId?: string,
// Run next step: ) {
) {
  // Return the computed result to the caller.
  return applyLocationChange({
    // Run next step: id,
    id,
    // Run next step: actorEmployeeId,
    actorEmployeeId,
    // Set field on the structure being built.
    field: "serviceStatus",
    // Set next on the structure being built.
    next: serviceStatus,
    // Set action on the structure being built.
    action: "location.set_service_status",
    // Set data on the structure being built.
    data: { serviceStatus },
    // Set isNoop on the structure being built.
    isNoop: (existing) => existing.serviceStatus === serviceStatus,
    // Set summary on the structure being built.
    summary: (row) => `Set service status of ${row.number} to ${serviceStatus}`,
    // Set afterCommit on the structure being built.
    afterCommit: async (updated) => {
      // Branch when this condition holds so the right path runs.
      if (serviceStatus === ServiceStatus.out_of_service) {
        // Wait for the async step before continuing.
        await notifyLocationOutOfService({
          // Set locationId on the structure being built.
          locationId: id,
          // Set locationNumber on the structure being built.
          locationNumber: updated.number,
          // Set updatedAt on the structure being built.
          updatedAt: updated.updatedAt,
          // Run next step: actorEmployeeId,
          actorEmployeeId,
        });
      }
    },
  });
}
