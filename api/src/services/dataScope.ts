import { Prisma, Role } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import type { AuthUser } from "../middleware/auth";

export type DataScopeKind =
  | "all"
  | "sectors"
  | "assigned_tasks"
  | "assigned_tickets";

export type DataScope = {
  kind: DataScopeKind;
  employeeId: string;
  role: Role;
  /** Set when kind === "sectors". */
  sectorIds: string[];
};

const OUT_OF_SCOPE = "Outside your permitted data scope";

export async function resolveDataScope(user: AuthUser): Promise<DataScope> {
  const base = {
    employeeId: user.employeeId,
    role: user.role,
  };

  switch (user.role) {
    case Role.owner:
    case Role.manager:
    case Role.admin:
    case Role.reception:
      return { ...base, kind: "all", sectorIds: [] };

    case Role.supervisor: {
      const sectors = await prisma.sector.findMany({
        where: {
          primarySupervisorEmployeeId: user.employeeId,
          isActive: true,
        },
        select: { id: true },
      });
      return {
        ...base,
        kind: "sectors",
        sectorIds: sectors.map((s) => s.id),
      };
    }

    case Role.housekeeper:
      return { ...base, kind: "assigned_tasks", sectorIds: [] };

    case Role.technician:
      return { ...base, kind: "assigned_tickets", sectorIds: [] };

    default:
      return { ...base, kind: "assigned_tasks", sectorIds: [] };
  }
}

/** Current sector membership for a location (for snapshots). */
export async function sectorIdForLocation(
  locationId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string | null> {
  const membership = await client.sectorLocation.findUnique({
    where: { locationId },
    select: { sectorId: true },
  });
  return membership?.sectorId ?? null;
}

/** Sector id + primary supervisor at snapshot time for a location. */
export async function sectorSnapshotForLocation(
  locationId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ sectorId: string | null; sectorSupervisorEmployeeId: string | null }> {
  const membership = await client.sectorLocation.findUnique({
    where: { locationId },
    select: {
      sectorId: true,
      sector: { select: { primarySupervisorEmployeeId: true } },
    },
  });
  if (!membership) {
    return { sectorId: null, sectorSupervisorEmployeeId: null };
  }
  return {
    sectorId: membership.sectorId,
    sectorSupervisorEmployeeId:
      membership.sector.primarySupervisorEmployeeId ?? null,
  };
}

/** Supervisor snapshot for an already-known sector id. */
export async function sectorSupervisorForSector(
  sectorId: string | null,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string | null> {
  if (!sectorId) return null;
  const sector = await client.sector.findUnique({
    where: { id: sectorId },
    select: { primarySupervisorEmployeeId: true },
  });
  return sector?.primarySupervisorEmployeeId ?? null;
}

export function taskWhere(scope: DataScope): Prisma.CleaningTaskWhereInput {
  switch (scope.kind) {
    case "all":
      return {};
    case "sectors":
      if (scope.sectorIds.length === 0) {
        return { id: "__none__" };
      }
      return {
        OR: [
          { sectorId: { in: scope.sectorIds } },
          {
            sectorId: null,
            location: {
              sectorMembership: { sectorId: { in: scope.sectorIds } },
            },
          },
        ],
      };
    case "assigned_tasks":
      return { assignedEmployeeId: scope.employeeId };
    case "assigned_tickets":
      // Technicians do not get a cleaning-task queue by default.
      return { id: "__none__" };
  }
}

export function locationWhere(scope: DataScope): Prisma.LocationWhereInput {
  switch (scope.kind) {
    case "all":
      return {};
    case "sectors":
      if (scope.sectorIds.length === 0) {
        return { id: "__none__" };
      }
      return {
        sectorMembership: { sectorId: { in: scope.sectorIds } },
      };
    case "assigned_tasks":
      return {
        cleaningTasks: {
          some: { assignedEmployeeId: scope.employeeId },
        },
      };
    case "assigned_tickets":
      return {
        maintenanceTickets: {
          some: { assigneeId: scope.employeeId },
        },
      };
  }
}

export function ticketWhere(scope: DataScope): Prisma.MaintenanceTicketWhereInput {
  switch (scope.kind) {
    case "all":
      return {};
    case "sectors":
      if (scope.sectorIds.length === 0) {
        return { id: "__none__" };
      }
      return {
        location: {
          sectorMembership: { sectorId: { in: scope.sectorIds } },
        },
      };
    case "assigned_tasks":
      // Housekeeper: own reports + tickets on rooms they are assigned to clean.
      return {
        OR: [
          { reportedByEmployeeId: scope.employeeId },
          {
            location: {
              cleaningTasks: {
                some: { assignedEmployeeId: scope.employeeId },
              },
            },
          },
        ],
      };
    case "assigned_tickets":
      return { assigneeId: scope.employeeId };
  }
}

export function sessionTaskWhere(scope: DataScope): Prisma.CleaningSessionWhereInput {
  const tw = taskWhere(scope);
  if (Object.keys(tw).length === 0) return {};
  return { task: tw };
}

function taskInScope(
  scope: DataScope,
  task: {
    assignedEmployeeId: string | null;
    sectorId: string | null;
    locationId: string;
    locationSectorId?: string | null;
  },
): boolean {
  switch (scope.kind) {
    case "all":
      return true;
    case "sectors": {
      const effective =
        task.sectorId ?? task.locationSectorId ?? null;
      return effective != null && scope.sectorIds.includes(effective);
    }
    case "assigned_tasks":
      return task.assignedEmployeeId === scope.employeeId;
    case "assigned_tickets":
      return false;
  }
}

export async function assertCanAccessTask(
  scope: DataScope,
  taskId: string,
): Promise<void> {
  if (scope.kind === "all") return;

  const task = await prisma.cleaningTask.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      assignedEmployeeId: true,
      sectorId: true,
      locationId: true,
      location: {
        select: { sectorMembership: { select: { sectorId: true } } },
      },
    },
  });
  if (!task) {
    throw new AppError(404, "not_found", "Task not found");
  }
  if (
    !taskInScope(scope, {
      assignedEmployeeId: task.assignedEmployeeId,
      sectorId: task.sectorId,
      locationId: task.locationId,
      locationSectorId: task.location.sectorMembership?.sectorId ?? null,
    })
  ) {
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
}

export async function assertCanAccessLocation(
  scope: DataScope,
  locationId: string,
): Promise<void> {
  if (scope.kind === "all") return;

  const location = await prisma.location.findFirst({
    where: { id: locationId, ...locationWhere(scope) },
    select: { id: true },
  });
  if (!location) {
    // Distinguish missing vs out-of-scope when the row exists.
    const exists = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true },
    });
    if (!exists) {
      throw new AppError(404, "not_found", "Location not found");
    }
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
}

export async function assertCanAccessTicket(
  scope: DataScope,
  ticketId: string,
): Promise<void> {
  if (scope.kind === "all") return;

  const ticket = await prisma.maintenanceTicket.findFirst({
    where: { id: ticketId, ...ticketWhere(scope) },
    select: { id: true },
  });
  if (!ticket) {
    const exists = await prisma.maintenanceTicket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!exists) {
      throw new AppError(404, "not_found", "Ticket not found");
    }
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
}

export async function assertCanAccessSession(
  scope: DataScope,
  sessionId: string,
): Promise<void> {
  if (scope.kind === "all") return;

  const session = await prisma.cleaningSession.findUnique({
    where: { id: sessionId },
    select: { taskId: true },
  });
  if (!session) {
    throw new AppError(404, "not_found", "Session not found");
  }
  await assertCanAccessTask(scope, session.taskId);
}

export function sectorWhere(scope: DataScope): Prisma.SectorWhereInput {
  switch (scope.kind) {
    case "all":
      return {};
    case "sectors":
      if (scope.sectorIds.length === 0) {
        return { id: "__none__" };
      }
      return { id: { in: scope.sectorIds } };
    case "assigned_tasks":
    case "assigned_tickets":
      return { id: "__none__" };
  }
}

export async function assertCanAccessSector(
  scope: DataScope,
  sectorId: string,
): Promise<void> {
  if (scope.kind === "all") return;

  if (scope.kind === "sectors" && scope.sectorIds.includes(sectorId)) {
    return;
  }

  const exists = await prisma.sector.findUnique({
    where: { id: sectorId },
    select: { id: true },
  });
  if (!exists) {
    throw new AppError(404, "not_found", "Sector not found");
  }
  throw new AppError(403, "forbidden", OUT_OF_SCOPE);
}

/** Supervisors may only create sectors where they are the primary supervisor. */
export function assertCanCreateSector(
  scope: DataScope,
  primarySupervisorEmployeeId: string | null | undefined,
): void {
  if (scope.kind === "all") return;
  if (scope.kind === "sectors") {
    if (primarySupervisorEmployeeId !== scope.employeeId) {
      throw new AppError(403, "forbidden", OUT_OF_SCOPE);
    }
    return;
  }
  throw new AppError(403, "forbidden", OUT_OF_SCOPE);
}
