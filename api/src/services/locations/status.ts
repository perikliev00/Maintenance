/**
 * Mutate room occupancy and service status with audit + live events.
 * Occupancy is rooms-only; out-of-service triggers ops notifications.
 */
import { LocationKind, Occupancy, ServiceStatus } from "@prisma/client";
import { AppError } from "../../errors";
import { notifyLocationOutOfService } from "./notify";
import { applyLocationChange } from "./mutations";

/**
 * Set room occupancy. No-op (returns current row) when unchanged.
 * Rejects common_area locations.
 */
export async function setLocationOccupancy(
  id: string,
  occupancy: Occupancy,
  actorEmployeeId?: string,
) {
  return applyLocationChange({
    id,
    actorEmployeeId,
    field: "occupancy",
    next: occupancy,
    action: "location.set_occupancy",
    data: { occupancy },
    guard: (existing) => {
      if (existing.kind === LocationKind.common_area) {
        throw new AppError(
          400,
          "validation",
          "Occupancy applies only to rooms, not common areas",
        );
      }
    },
    isNoop: (existing) => existing.occupancy === occupancy,
    summary: (row) => `Set occupancy of ${row.number} to ${occupancy}`,
  });
}

/** Set in_service / out_of_service; notifies ops when transitioning out. */
export async function setLocationServiceStatus(
  id: string,
  serviceStatus: ServiceStatus,
  actorEmployeeId?: string,
) {
  return applyLocationChange({
    id,
    actorEmployeeId,
    field: "serviceStatus",
    next: serviceStatus,
    action: "location.set_service_status",
    data: { serviceStatus },
    isNoop: (existing) => existing.serviceStatus === serviceStatus,
    summary: (row) => `Set service status of ${row.number} to ${serviceStatus}`,
    afterCommit: async (updated) => {
      if (serviceStatus === ServiceStatus.out_of_service) {
        await notifyLocationOutOfService({
          locationId: id,
          locationNumber: updated.number,
          updatedAt: updated.updatedAt,
          actorEmployeeId,
        });
      }
    },
  });
}
