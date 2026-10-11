import { LocationKind, Occupancy, ServiceStatus } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import { recordAudit } from "../audit";
import { findLocationById } from "./crud";
import { notifyLocationOutOfService } from "./notify";
import { locationInclude } from "./types";

export async function setLocationOccupancy(
  id: string,
  occupancy: Occupancy,
  actorEmployeeId?: string,
) {
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Location not found");
  }
  if (existing.kind === LocationKind.common_area) {
    throw new AppError(
      400,
      "validation",
      "Occupancy applies only to rooms, not common areas",
    );
  }
  if (existing.occupancy === occupancy) {
    const full = await findLocationById(id);
    return full!;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.location.update({
      where: { id },
      data: { occupancy },
      include: locationInclude,
    });
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

export async function setLocationServiceStatus(
  id: string,
  serviceStatus: ServiceStatus,
  actorEmployeeId?: string,
) {
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Location not found");
  }
  if (existing.serviceStatus === serviceStatus) {
    const full = await findLocationById(id);
    return full!;
  }

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
