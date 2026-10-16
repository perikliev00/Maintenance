/**
 * Fail-closed access checks: 403 when an entity exists but is outside scope,
 * 404 when it does not exist (or is indistinguishable under restricted lists).
 */
import { prisma } from "../../db";
import { AppError } from "../../errors";
import type { DataScope } from "./types";
import { locationWhere, ticketWhere } from "./where";

const OUT_OF_SCOPE = "Outside your permitted data scope";

/** Pure predicate: is this cleaning task inside the caller's DataScope? */
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
    // Hotel-wide actors see every task.
    case "all":
      return true;
    case "sectors": {
      // Prefer task.sectorId snapshot; fall back to current location membership.
      const effective =
        task.sectorId ?? task.locationSectorId ?? null;
      return effective != null && scope.sectorIds.includes(effective);
    }
    // Housekeepers: only tasks assigned to them.
    case "assigned_tasks":
      return task.assignedEmployeeId === scope.employeeId;
    // Ticket-only scope never grants cleaning-task access.
    case "assigned_tickets":
      return false;
  }
}

/** Ensure the caller may read/mutate the given cleaning task. */
export async function assertCanAccessTask(
  scope: DataScope,
  taskId: string,
): Promise<void> {
  // Unrestricted scope skips the DB check.
  if (scope.kind === "all") return;

  // Load assignment + sector snapshot (+ location membership fallback).
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
  // Missing task → 404 (not 403).
  if (!task) {
    throw new AppError(404, "not_found", "Task not found");
  }
  // Out-of-scope but existing → 403.
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

/** Ensure the caller may access the given location. */
export async function assertCanAccessLocation(
  scope: DataScope,
  locationId: string,
): Promise<void> {
  // Unrestricted scope skips the DB check.
  if (scope.kind === "all") return;

  // Scoped findFirst: in-scope hit → allow.
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

/** Ensure the caller may access the given maintenance ticket. */
export async function assertCanAccessTicket(
  scope: DataScope,
  ticketId: string,
): Promise<void> {
  // Unrestricted scope skips the DB check.
  if (scope.kind === "all") return;

  // Scoped findFirst using ticketWhere (assignee / sector / location).
  const ticket = await prisma.maintenanceTicket.findFirst({
    where: { id: ticketId, ...ticketWhere(scope) },
    select: { id: true },
  });
  if (!ticket) {
    // Same 404 vs 403 split as locations.
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

/** Ensure the caller may access the session via its parent task's scope. */
export async function assertCanAccessSession(
  scope: DataScope,
  sessionId: string,
): Promise<void> {
  // Unrestricted scope skips the DB check.
  if (scope.kind === "all") return;

  // Sessions inherit access from their parent cleaning task.
  const session = await prisma.cleaningSession.findUnique({
    where: { id: sessionId },
    select: { taskId: true },
  });
  if (!session) {
    throw new AppError(404, "not_found", "Session not found");
  }
  await assertCanAccessTask(scope, session.taskId);
}

/** Ensure the caller may access the given sector. */
export async function assertCanAccessSector(
  scope: DataScope,
  sectorId: string,
): Promise<void> {
  // Unrestricted scope skips the DB check.
  if (scope.kind === "all") return;

  // Sector supervisors: allow when sectorId is in their sectorIds list.
  if (scope.kind === "sectors" && scope.sectorIds.includes(sectorId)) {
    return;
  }

  // Otherwise: 404 if missing, else 403 (assigned_* never see sectors).
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
  // Unrestricted actors may attach any locations.
  if (scope.kind === "all") return;
  // Non-sector scopes cannot mutate sector membership lists.
  if (scope.kind !== "sectors") {
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }

  // Deduplicate so the allowed-set check is O(n).
  const unique = [...new Set(locationIds)];
  if (unique.length === 0) return;

  // Empty sectorIds means no locations are assignable.
  if (scope.sectorIds.length === 0) {
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }

  // Locations already members of any of the caller's sectors.
  const allowed = await prisma.sectorLocation.findMany({
    where: {
      sectorId: { in: scope.sectorIds },
      locationId: { in: unique },
    },
    select: { locationId: true },
  });
  const allowedSet = new Set(allowed.map((r) => r.locationId));
  // Any id not in the union is foreign / unassigned → forbid.
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
  // Hotel-wide actors may create sectors for anyone.
  if (scope.kind === "all") return;
  // Sector supervisors: must name themselves as primary supervisor.
  if (scope.kind === "sectors") {
    if (primarySupervisorEmployeeId !== scope.employeeId) {
      throw new AppError(403, "forbidden", OUT_OF_SCOPE);
    }
    return;
  }
  // assigned_tasks / assigned_tickets cannot create sectors.
  throw new AppError(403, "forbidden", OUT_OF_SCOPE);
}
