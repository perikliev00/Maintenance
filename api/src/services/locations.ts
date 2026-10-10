import {
  CatalogStatus,
  LocationKind,
  Occupancy,
  Prisma,
  ServiceStatus,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { publish } from "../events/bus";
import { ACTIVE_TASK_STATUSES, OPEN_TICKET_STATUSES } from "../constants";
import { recordAudit } from "./audit";
import { computeReadiness } from "./readiness";
import {
  createNotifications,
  recipientsForLocationOps,
} from "./notifications";

export const locationInclude = {
  floor: { include: { building: true } },
  sectorMembership: {
    include: {
      sector: {
        select: {
          id: true,
          code: true,
          nameBg: true,
          nameEn: true,
          isActive: true,
        },
      },
    },
  },
  cleaningTasks: {
    where: { status: { in: ACTIVE_TASK_STATUSES } },
    include: {
      assignedEmployee: true,
      sessions: {
        include: { employee: true },
        orderBy: { startedAt: "desc" as const },
      },
      inspections: {
        include: { inspector: true },
        orderBy: { inspectedAt: "desc" as const },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
  maintenanceTickets: {
    where: {
      status: { in: OPEN_TICKET_STATUSES },
      blocksRoom: true,
    },
    take: 5,
    orderBy: { openedAt: "desc" as const },
  },
};

type SessionRow = {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  notes: string | null;
  employeeId: string;
  employee: { id: string; fullName: string; employeeNumber: string };
};

type InspectionRow = {
  id: string;
  result: string;
  findings: string | null;
  inspectedAt: Date;
  inspector: { id: string; fullName: string; employeeNumber: string };
};

export type LocationForMap = {
  id: string;
  floorId: string;
  number: string;
  kind: LocationKind;
  catalogStatus: string;
  occupancy: string;
  cleaningStatus: string;
  serviceStatus: string;
  qrToken: string;
  floor: {
    number: number;
    name: string;
    building: { name: string; code: string };
  };
  sectorMembership?: {
    sector: {
      id: string;
      code: string;
      nameBg: string;
      nameEn: string;
      isActive: boolean;
    };
  } | null;
  cleaningTasks?: Array<{
    id: string;
    status: TaskStatus;
    priority: string;
    dueAt: Date | null;
    version: number;
    reassignReason: string | null;
    assignedEmployee: {
      id: string;
      fullName: string;
      employeeNumber: string;
    } | null;
    sessions: SessionRow[];
    inspections?: InspectionRow[];
  }>;
  maintenanceTickets?: Array<{
    id: string;
    title: string;
    categoryKey: string;
    categoryLabelBg: string;
    priority: string;
    status: string;
    blocksRoom: boolean;
  }>;
};

export function mapLocation(location: LocationForMap) {
  const blockingTickets = location.maintenanceTickets ?? [];
  const { readiness, reasons } = computeReadiness({
    kind: location.kind,
    catalogStatus: location.catalogStatus as any,
    occupancy: location.occupancy as any,
    cleaningStatus: location.cleaningStatus as any,
    serviceStatus: location.serviceStatus as any,
    hasBlockingTicket: blockingTickets.length > 0,
  });
  const activeTask = location.cleaningTasks?.[0] ?? null;
  const runningSession =
    activeTask?.sessions.find((s) => s.status === "running") ?? null;
  const lastCompletedSession =
    activeTask?.sessions.find((s) => s.status === "completed") ?? null;
  const lastInspection = activeTask?.inspections?.[0] ?? null;
  const sector =
    location.sectorMembership?.sector &&
    location.sectorMembership.sector.isActive
      ? {
          id: location.sectorMembership.sector.id,
          code: location.sectorMembership.sector.code,
          nameBg: location.sectorMembership.sector.nameBg,
          nameEn: location.sectorMembership.sector.nameEn,
        }
      : null;

  return {
    id: location.id,
    floorId: location.floorId,
    number: location.number,
    kind: location.kind,
    floor: location.floor.number,
    floorName: location.floor.name,
    building: location.floor.building.name,
    buildingCode: location.floor.building.code,
    catalogStatus: location.catalogStatus,
    occupancy: location.occupancy,
    cleaningStatus: location.cleaningStatus,
    serviceStatus: location.serviceStatus,
    qrToken: location.qrToken,
    sector,
    readiness,
    readinessReasons: reasons,
    blockingIssues: blockingTickets.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.categoryKey,
      categoryLabelBg: t.categoryLabelBg,
      priority: t.priority,
      status: t.status,
    })),
    activeTask: activeTask
      ? {
          id: activeTask.id,
          status: activeTask.status,
          priority: activeTask.priority,
          dueAt: activeTask.dueAt,
          version: activeTask.version,
          reassignReason: activeTask.reassignReason,
          assignee: activeTask.assignedEmployee
            ? {
                id: activeTask.assignedEmployee.id,
                fullName: activeTask.assignedEmployee.fullName,
                employeeNumber: activeTask.assignedEmployee.employeeNumber,
              }
            : null,
          runningSession: runningSession
            ? {
                id: runningSession.id,
                startedAt: runningSession.startedAt,
                employeeId: runningSession.employeeId,
              }
            : null,
          lastCompletedSession: lastCompletedSession
            ? {
                id: lastCompletedSession.id,
                finishedAt: lastCompletedSession.finishedAt,
                notes: lastCompletedSession.notes,
                employee: {
                  id: lastCompletedSession.employee.id,
                  fullName: lastCompletedSession.employee.fullName,
                  employeeNumber: lastCompletedSession.employee.employeeNumber,
                },
              }
            : null,
          lastInspection: lastInspection
            ? {
                id: lastInspection.id,
                result: lastInspection.result,
                findings: lastInspection.findings,
                inspectedAt: lastInspection.inspectedAt,
                inspector: {
                  id: lastInspection.inspector.id,
                  fullName: lastInspection.inspector.fullName,
                  employeeNumber: lastInspection.inspector.employeeNumber,
                },
              }
            : null,
        }
      : null,
  };
}

/** Alias kept for existing imports. */
export const mapRoom = mapLocation;

export async function findActiveLocations(
  kind: LocationKind,
  scopeFilter?: Prisma.LocationWhereInput,
) {
  return prisma.location.findMany({
    where: { catalogStatus: "active", kind, ...(scopeFilter ?? {}) },
    include: locationInclude,
    orderBy: [{ floor: { number: "asc" } }, { number: "asc" }],
  });
}

export async function findLocationById(id: string, kind?: LocationKind) {
  const location = await prisma.location.findUnique({
    where: { id },
    include: locationInclude,
  });
  if (!location) return null;
  if (kind && location.kind !== kind) return null;
  return location;
}

export async function findLocationByQrToken(token: string) {
  return prisma.location.findUnique({
    where: { qrToken: token },
    include: locationInclude,
  });
}

export function locationQrPayload(location: {
  id: string;
  qrToken: string;
  number: string;
  kind: LocationKind;
  floor: { number: number; building: { code: string } };
}) {
  const origin =
    process.env.WEB_ORIGIN?.replace(/\/$/, "") || "http://localhost:5173";
  const scanUrl = `${origin}/#/room-qr/${location.qrToken}`;
  return {
    locationId: location.id,
    qrToken: location.qrToken,
    scanUrl,
    label: `${location.floor.building.code} ${location.number}`,
    kind: location.kind,
    buildingCode: location.floor.building.code,
    floor: location.floor.number,
    number: location.number,
  };
}

export async function getLocationHierarchy() {
  const buildings = await prisma.building.findMany({
    include: {
      floors: {
        orderBy: { number: "asc" },
        select: { id: true, number: true, name: true },
      },
    },
    orderBy: { code: "asc" },
  });
  return buildings.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    floors: b.floors.map((f) => ({
      id: f.id,
      number: f.number,
      name: f.name,
    })),
  }));
}

export async function listLocationsCatalog(input: {
  kind?: LocationKind;
  includeArchived?: boolean;
  scopeFilter?: Prisma.LocationWhereInput;
}) {
  const where: Prisma.LocationWhereInput = {
    ...(input.scopeFilter ?? {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.includeArchived
      ? {}
      : { catalogStatus: CatalogStatus.active }),
  };
  return prisma.location.findMany({
    where,
    include: locationInclude,
    orderBy: [
      { catalogStatus: "asc" },
      { floor: { building: { code: "asc" } } },
      { floor: { number: "asc" } },
      { number: "asc" },
    ],
  });
}

async function assertFloorExists(floorId: string) {
  const floor = await prisma.floor.findUnique({
    where: { id: floorId },
    select: { id: true },
  });
  if (!floor) {
    throw new AppError(404, "not_found", "Floor not found");
  }
}

function conflictFromPrisma(err: unknown): never {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new AppError(
      409,
      "conflict",
      "A location with this number already exists on that floor",
    );
  }
  throw err;
}

export async function createLocation(input: {
  floorId: string;
  number: string;
  kind?: LocationKind;
  occupancy?: Occupancy;
  serviceStatus?: ServiceStatus;
  actorEmployeeId?: string;
}) {
  const number = input.number.trim();
  if (!number) {
    throw new AppError(400, "validation", "number is required");
  }
  await assertFloorExists(input.floorId);
  const kind = input.kind ?? LocationKind.room;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.location.create({
        data: {
          floorId: input.floorId,
          number,
          kind,
          occupancy:
            input.occupancy ??
            (kind === LocationKind.common_area
              ? Occupancy.vacant
              : Occupancy.unknown),
          serviceStatus: input.serviceStatus ?? ServiceStatus.in_service,
        },
        include: locationInclude,
      });
      await recordAudit({
        actorEmployeeId: input.actorEmployeeId,
        action: "location.create",
        entityType: "location",
        entityId: row.id,
        locationId: row.id,
        after: {
          floorId: row.floorId,
          number: row.number,
          kind: row.kind,
          occupancy: row.occupancy,
          serviceStatus: row.serviceStatus,
        },
        summary: `Created ${row.kind} ${row.number}`,
      }, tx);
      return row;
    });
    publish("location.changed", { locationId: created.id });
    return created;
  } catch (err) {
    conflictFromPrisma(err);
  }
}

export async function updateLocation(
  id: string,
  input: {
    floorId?: string;
    number?: string;
    kind?: LocationKind;
    actorEmployeeId?: string;
  },
) {
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Location not found");
  }
  if (input.floorId !== undefined) {
    await assertFloorExists(input.floorId);
  }
  const number =
    input.number !== undefined ? input.number.trim() : undefined;
  if (number !== undefined && !number) {
    throw new AppError(400, "validation", "number is required");
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.location.update({
        where: { id },
        data: {
          ...(input.floorId !== undefined ? { floorId: input.floorId } : {}),
          ...(number !== undefined ? { number } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
        },
        include: locationInclude,
      });
      await recordAudit({
        actorEmployeeId: input.actorEmployeeId,
        action: "location.update",
        entityType: "location",
        entityId: id,
        locationId: id,
        before: {
          floorId: existing.floorId,
          number: existing.number,
          kind: existing.kind,
        },
        after: {
          floorId: row.floorId,
          number: row.number,
          kind: row.kind,
        },
        summary: `Updated location ${row.number}`,
      }, tx);
      return row;
    });
    publish("location.changed", { locationId: updated.id });
    return updated;
  } catch (err) {
    conflictFromPrisma(err);
  }
}

export async function archiveLocation(id: string, actorEmployeeId?: string) {
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Location not found");
  }
  if (existing.catalogStatus === CatalogStatus.archived) {
    const full = await findLocationById(id);
    return full!;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.location.update({
      where: { id },
      data: { catalogStatus: CatalogStatus.archived },
      include: locationInclude,
    });
    await recordAudit({
      actorEmployeeId,
      action: "location.archive",
      entityType: "location",
      entityId: id,
      locationId: id,
      before: { catalogStatus: existing.catalogStatus },
      after: { catalogStatus: CatalogStatus.archived },
      summary: `Archived location ${row.number}`,
    }, tx);
    return row;
  });
  publish("location.changed", { locationId: updated.id });
  return updated;
}

export async function restoreLocation(id: string, actorEmployeeId?: string) {
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Location not found");
  }
  if (existing.catalogStatus === CatalogStatus.active) {
    const full = await findLocationById(id);
    return full!;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.location.update({
      where: { id },
      data: { catalogStatus: CatalogStatus.active },
      include: locationInclude,
    });
    await recordAudit({
      actorEmployeeId,
      action: "location.restore",
      entityType: "location",
      entityId: id,
      locationId: id,
      before: { catalogStatus: existing.catalogStatus },
      after: { catalogStatus: CatalogStatus.active },
      summary: `Restored location ${row.number}`,
    }, tx);
    return row;
  });
  publish("location.changed", { locationId: updated.id });
  return updated;
}

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
    const recipients = await recipientsForLocationOps(
      id,
      "operations.view_live",
    );
    await createNotifications({
      type: "location.out_of_service",
      title: "Location out of service",
      body: `${updated.number} set out of service`,
      entityType: "location",
      entityId: id,
      locationId: id,
      actorEmployeeId: actorEmployeeId ?? null,
      recipientEmployeeIds: recipients,
      dedupeKey: `location.out_of_service:${id}:${updated.updatedAt.toISOString()}`,
      payload: {
        panel: "live",
        locationId: id,
        locationNumber: updated.number,
      },
    });
  }
  return updated;
}

