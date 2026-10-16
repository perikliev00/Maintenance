/**
 * Mutate room occupancy and service status with audit + live events.
 * Occupancy is rooms-only; out-of-service triggers ops notifications.
 */
import { LocationKind, Occupancy, ServiceStatus } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import { recordAudit } from "../audit";
import { findLocationById } from "./crud";
import { notifyLocationOutOfService } from "./notify";
import { locationInclude } from "./types";

/**
 * Set room occupancy. No-op (returns current row) when unchanged.
 * Rejects common_area locations.
 */
export async function setLocationOccupancy(
  id: string,
  occupancy: Occupancy,
  actorEmployeeId?: string,
) {
  // Load current occupancy / kind for validation and audit before.
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Location not found");
  }
  // Common areas have no guest occupancy concept.
  if (existing.kind === LocationKind.common_area) {
    throw new AppError(
      400,
      "validation",
      "Occupancy applies only to rooms, not common areas",
    );
  }
  // Idempotent no-op — return the full mapped row without auditing.
  if (existing.occupancy === occupancy) {
    const full = await findLocationById(id);
    return full!;
  }

  // Write + audit in one transaction so history stays consistent.
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.location.update({
      where: { id },
      data: { occupancy },
      include: locationInclude,
    });
    // Audit is also newer-stay evidence for departure room effects.
    await recordAudit({
      actorEmployeeId,
      action: "location.set_occupancy",
      entityType: "location",
      entityId: id,
      locationId: id,
      before: { occupancy: existing.occupancy },
      after: { occupancy },
      summary: `Set occupancy of ${row.number} to ${occupancy}`,
    }, tx);
    return row;
  });
  publish("location.changed", { locationId: updated.id });
  return updated;
}

/** Set in_service / out_of_service; notifies ops when transitioning out. */
export async function setLocationServiceStatus(
  id: string,
  serviceStatus: ServiceStatus,
  actorEmployeeId?: string,
) {
  // Load current serviceStatus for idempotency and audit before.
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Location not found");
  }
  // Idempotent no-op when already in the requested service status.
  if (existing.serviceStatus === serviceStatus) {
    const full = await findLocationById(id);
    return full!;
  }

  // Persist + audit; notification runs after commit.
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.location.update({
      where: { id },
      data: { serviceStatus },
      include: locationInclude,
    });
    await recordAudit({
      actorEmployeeId,
      action: "location.set_service_status",
      entityType: "location",
      entityId: id,
      locationId: id,
      before: { serviceStatus: existing.serviceStatus },
      after: { serviceStatus },
      summary: `Set service status of ${row.number} to ${serviceStatus}`,
    }, tx);
    return row;
  });
  publish("location.changed", { locationId: updated.id });
  // Only notify when transitioning *to* out_of_service (not when returning).
  if (serviceStatus === ServiceStatus.out_of_service) {
    await notifyLocationOutOfService({
      locationId: id,
      locationNumber: updated.number,
      updatedAt: updated.updatedAt,
      actorEmployeeId,
    });
  }
  return updated;
}
