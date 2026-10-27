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

/**
 * Attach open blocking / non-blocking ticket counts for board DTOs.
 * Preview samples stay capped at 5; counts are authoritative totals.
 */
export async function attachOpenIssueCounts<T extends { id: string }>(
  rows: T[],
  grouped: Array<{
    locationId: string;
    blocksRoom: boolean;
    _count: { _all: number };
  }>,
): Promise<
  Array<T & { blockingIssueCount: number; nonBlockingIssueCount: number }>
> {
  if (rows.length === 0) return [];
  const blocking = new Map<string, number>();
  const nonBlocking = new Map<string, number>();
  for (const row of grouped) {
    if (row.blocksRoom) {
      blocking.set(row.locationId, row._count._all);
    } else {
      nonBlocking.set(row.locationId, row._count._all);
    }
  }
  return rows.map((row) => ({
    ...row,
    blockingIssueCount: blocking.get(row.id) ?? 0,
    nonBlockingIssueCount: nonBlocking.get(row.id) ?? 0,
  }));
}

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
  /** Authoritative open blocking ticket total (may exceed preview length). */
  blockingIssueCount?: number;
  /** Authoritative open non-blocking ticket total. */
  nonBlockingIssueCount?: number;
};
