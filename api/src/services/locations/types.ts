/**
 * Location Prisma include for live board + catalog, and the DTO input type
 * consumed by {@link mapLocation}.
 */
import { LocationKind, TaskStatus } from "@prisma/client";
// Import module ../../constants for this service.
import { ACTIVE_TASK_STATUSES, OPEN_TICKET_STATUSES } from "../../constants";

/**
 * Relations for board payloads: floor/building, sector, latest active task,
 * and open blocking maintenance tickets.
 */
export const locationInclude = {
  // Set floor on the structure being built.
  floor: { include: { building: true } },
  // Set sectorMembership on the structure being built.
  sectorMembership: {
    // Set include on the structure being built.
    include: {
      // Set sector on the structure being built.
      sector: {
        // Set select on the structure being built.
        select: {
          // Set id on the structure being built.
          id: true,
          // Set code on the structure being built.
          code: true,
          // Set nameBg on the structure being built.
          nameBg: true,
          // Set nameEn on the structure being built.
          nameEn: true,
          // Set isActive on the structure being built.
          isActive: true,
        },
      },
    },
  },
  // Set cleaningTasks on the structure being built.
  cleaningTasks: {
    // Set where on the structure being built.
    where: { status: { in: ACTIVE_TASK_STATUSES } },
    // Set include on the structure being built.
    include: {
      // Set assignedEmployee on the structure being built.
      assignedEmployee: true,
      // Set sessions on the structure being built.
      sessions: {
        // Set include on the structure being built.
        include: { employee: true },
        // Set orderBy on the structure being built.
        orderBy: { startedAt: "desc" as const },
      },
      // Set inspections on the structure being built.
      inspections: {
        // Set include on the structure being built.
        include: { inspector: true },
        // Set orderBy on the structure being built.
        orderBy: { inspectedAt: "desc" as const },
        // Set take on the structure being built.
        take: 1,
      },
    },
    // Set orderBy on the structure being built.
    orderBy: { createdAt: "desc" as const },
    // Set take on the structure being built.
    take: 1,
  },
  // Set maintenanceTickets on the structure being built.
  maintenanceTickets: {
    // Set where on the structure being built.
    where: {
      // Set status on the structure being built.
      status: { in: OPEN_TICKET_STATUSES },
      // Set blocksRoom on the structure being built.
      blocksRoom: true,
    },
    // Set take on the structure being built.
    take: 5,
    // Set orderBy on the structure being built.
    orderBy: { openedAt: "desc" as const },
  },
};

/**
 * Attach open blocking / non-blocking ticket counts for board DTOs.
 * Preview samples stay capped at 5; counts are authoritative totals.
 */
export async function attachOpenIssueCounts<T extends { id: string }>(
  // Set rows on the structure being built.
  rows: T[],
  // Set grouped on the structure being built.
  grouped: Array<{
    // Set locationId on the structure being built.
    locationId: string;
    // Set blocksRoom on the structure being built.
    blocksRoom: boolean;
    // Set _count on the structure being built.
    _count: { _all: number };
  // Run next step: }>,
  }>,
// Run next step: ): Promise<
): Promise<
  // Run next step: Array<T & { blockingIssueCount: number; nonBlockingIssueCoun…
  Array<T & { blockingIssueCount: number; nonBlockingIssueCount: number }>
// Run next step: > {
> {
  // Branch when this condition holds so the right path runs.
  if (rows.length === 0) return [];
  // Capture blocking for use in this scope.
  const blocking = new Map<string, number>();
  // Capture non blocking for use in this scope.
  const nonBlocking = new Map<string, number>();
  // Iterate items to apply the same logic to each entry.
  for (const row of grouped) {
    // Branch when this condition holds so the right path runs.
    if (row.blocksRoom) {
      // Store a keyed value for later lookup.
      blocking.set(row.locationId, row._count._all);
    // Run next step: } else {
    } else {
      // Store a keyed value for later lookup.
      nonBlocking.set(row.locationId, row._count._all);
    }
  }
  // Return the computed result to the caller.
  return rows.map((row) => ({
    // Run next step: ...row,
    ...row,
    // Set blockingIssueCount on the structure being built.
    blockingIssueCount: blocking.get(row.id) ?? 0,
    // Set nonBlockingIssueCount on the structure being built.
    nonBlockingIssueCount: nonBlocking.get(row.id) ?? 0,
  }));
}

// Declare type SessionRow for callers and internals.
type SessionRow = {
  // Set id on the structure being built.
  id: string;
  // Set status on the structure being built.
  status: string;
  // Set startedAt on the structure being built.
  startedAt: Date;
  // Set finishedAt on the structure being built.
  finishedAt: Date | null;
  // Set notes on the structure being built.
  notes: string | null;
  // Set employeeId on the structure being built.
  employeeId: string;
  // Set employee on the structure being built.
  employee: { id: string; fullName: string; employeeNumber: string };
};

// Declare type InspectionRow for callers and internals.
type InspectionRow = {
  // Set id on the structure being built.
  id: string;
  // Set result on the structure being built.
  result: string;
  // Set findings on the structure being built.
  findings: string | null;
  // Set inspectedAt on the structure being built.
  inspectedAt: Date;
  // Set inspector on the structure being built.
  inspector: { id: string; fullName: string; employeeNumber: string };
};

/** Shape expected by {@link mapLocation} (subset of a full Prisma payload). */
export type LocationForMap = {
  // Set id on the structure being built.
  id: string;
  // Set floorId on the structure being built.
  floorId: string;
  // Set number on the structure being built.
  number: string;
  // Set kind on the structure being built.
  kind: LocationKind;
  // Set catalogStatus on the structure being built.
  catalogStatus: string;
  // Set occupancy on the structure being built.
  occupancy: string;
  // Set cleaningStatus on the structure being built.
  cleaningStatus: string;
  // Set serviceStatus on the structure being built.
  serviceStatus: string;
  // Set floor on the structure being built.
  floor: {
    // Set number on the structure being built.
    number: number;
    // Set name on the structure being built.
    name: string;
    // Set building on the structure being built.
    building: { name: string; code: string };
  };
  // Run next step: sectorMembership?: {
  sectorMembership?: {
    // Set sector on the structure being built.
    sector: {
      // Set id on the structure being built.
      id: string;
      // Set code on the structure being built.
      code: string;
      // Set nameBg on the structure being built.
      nameBg: string;
      // Set nameEn on the structure being built.
      nameEn: string;
      // Set isActive on the structure being built.
      isActive: boolean;
    };
  // Run next step: } | null;
  } | null;
  // Run next step: cleaningTasks?: Array<{
  cleaningTasks?: Array<{
    // Set id on the structure being built.
    id: string;
    // Set status on the structure being built.
    status: TaskStatus;
    // Set priority on the structure being built.
    priority: string;
    // Set dueAt on the structure being built.
    dueAt: Date | null;
    // Set version on the structure being built.
    version: number;
    // Set reassignReason on the structure being built.
    reassignReason: string | null;
    // Set assignedEmployee on the structure being built.
    assignedEmployee: {
      // Set id on the structure being built.
      id: string;
      // Set fullName on the structure being built.
      fullName: string;
      // Set employeeNumber on the structure being built.
      employeeNumber: string;
    // Run next step: } | null;
    } | null;
    // Set sessions on the structure being built.
    sessions: SessionRow[];
    // Run next step: inspections?: InspectionRow[];
    inspections?: InspectionRow[];
  // Run next step: }>;
  }>;
  // Run next step: maintenanceTickets?: Array<{
  maintenanceTickets?: Array<{
    // Set id on the structure being built.
    id: string;
    // Set title on the structure being built.
    title: string;
    // Set categoryKey on the structure being built.
    categoryKey: string;
    // Set categoryLabelBg on the structure being built.
    categoryLabelBg: string;
    // Set priority on the structure being built.
    priority: string;
    // Set status on the structure being built.
    status: string;
    // Set blocksRoom on the structure being built.
    blocksRoom: boolean;
  // Run next step: }>;
  }>;
  /** Authoritative open blocking ticket total (may exceed preview length). */
  blockingIssueCount?: number;
  /** Authoritative open non-blocking ticket total. */
  nonBlockingIssueCount?: number;
};
