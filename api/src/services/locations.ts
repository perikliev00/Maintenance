import { LocationKind, Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "../db";
import { computeReadiness } from "./readiness";
import { ACTIVE_TASK_STATUSES, OPEN_TICKET_STATUSES } from "../constants";

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
