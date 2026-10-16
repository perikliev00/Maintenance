/**
 * Location Prisma include for live board + catalog, and the DTO input type
 * consumed by {@link mapLocation}.
 */
import { LocationKind, TaskStatus } from "@prisma/client";
import { ACTIVE_TASK_STATUSES, OPEN_TICKET_STATUSES } from "../../constants";

/**
 * Relations for board payloads: floor/building, sector, latest active task,
 * and open blocking maintenance tickets.
 */
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

/** Shape expected by {@link mapLocation} (subset of a full Prisma payload). */
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
