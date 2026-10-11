import { prisma } from "../../db";
import { AppError } from "../../errors";
import type { DataScope } from "./types";
import { locationWhere, ticketWhere } from "./where";

const OUT_OF_SCOPE = "Outside your permitted data scope";

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

/**
 * Sector-scoped actors may only assign locations already in the union of
 * their current sectors (rebalancing among own sectors). Expanding with
 * foreign or unassigned rooms is forbidden.
 */
export async function assertLocationsInSectorScope(
  scope: DataScope,
  locationIds: string[],
): Promise<void> {
  if (scope.kind === "all") return;
  if (scope.kind !== "sectors") {
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }

  const unique = [...new Set(locationIds)];
  if (unique.length === 0) return;

  if (scope.sectorIds.length === 0) {
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }

  const allowed = await prisma.sectorLocation.findMany({
    where: {
      sectorId: { in: scope.sectorIds },
      locationId: { in: unique },
    },
    select: { locationId: true },
  });
  const allowedSet = new Set(allowed.map((r) => r.locationId));
  const outside = unique.filter((id) => !allowedSet.has(id));
  if (outside.length) {
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
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
