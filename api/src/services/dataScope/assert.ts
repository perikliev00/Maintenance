/**
 * Fail-closed access checks: 403 when an entity exists but is outside scope,
 * 404 when it does not exist (or is indistinguishable under restricted lists).
 */
import { prisma } from "../../db";
// Import type(s) Prisma for typing without runtime cost.
import type { Prisma } from "@prisma/client";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import type(s) DataScope for typing without runtime cost.
import type { DataScope } from "./types";
// Import module ./where for this service.
import { locationWhere, ticketWhere } from "./where";

// Capture out of scope for use in this scope.
const OUT_OF_SCOPE = "Outside your permitted data scope";

/** Pure predicate: is this cleaning task inside the caller's DataScope? */
function taskInScope(
  // Set scope on the structure being built.
  scope: DataScope,
  // Set task on the structure being built.
  task: {
    // Set assignedEmployeeId on the structure being built.
    assignedEmployeeId: string | null;
    // Set sectorId on the structure being built.
    sectorId: string | null;
    // Set locationId on the structure being built.
    locationId: string;
    // Run next step: locationSectorId?: string | null;
    locationSectorId?: string | null;
  },
// Run next step: ): boolean {
): boolean {
  // Dispatch on the discriminant to pick the matching case.
  switch (scope.kind) {
    // Hotel-wide actors see every task.
    case "all":
      // Return the computed result to the caller.
      return true;
    // Handle this specific case value.
    case "sectors": {
      // Prefer task.sectorId snapshot; fall back to current location membership.
      const effective =
        // Run next step: task.sectorId ?? task.locationSectorId ?? null;
        task.sectorId ?? task.locationSectorId ?? null;
      // Return the computed result to the caller.
      return effective != null && scope.sectorIds.includes(effective);
    }
    // Housekeepers: only tasks assigned to them.
    case "assigned_tasks":
      // Return the computed result to the caller.
      return task.assignedEmployeeId === scope.employeeId;
    // Ticket-only scope never grants cleaning-task access.
    case "assigned_tickets":
      // Return the computed result to the caller.
      return false;
  }
}

/** Ensure the caller may read/mutate the given cleaning task. */
export async function assertCanAccessTask(
  // Set scope on the structure being built.
  scope: DataScope,
  // Set taskId on the structure being built.
  taskId: string,
  // Set db on the structure being built.
  db: Prisma.TransactionClient | typeof prisma = prisma,
// Run next step: ): Promise<void> {
): Promise<void> {
  // Unrestricted scope skips the DB check.
  if (scope.kind === "all") return;

  // Load assignment + sector snapshot (+ location membership fallback).
  const task = await db.cleaningTask.findUnique({
    // Set where on the structure being built.
    where: { id: taskId },
    // Set select on the structure being built.
    select: {
      // Set id on the structure being built.
      id: true,
      // Set assignedEmployeeId on the structure being built.
      assignedEmployeeId: true,
      // Set sectorId on the structure being built.
      sectorId: true,
      // Set locationId on the structure being built.
      locationId: true,
      // Set location on the structure being built.
      location: {
        // Set select on the structure being built.
        select: { sectorMembership: { select: { sectorId: true } } },
      },
    },
  });
  // Missing task → 404 (not 403).
  if (!task) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Task not found");
  }
  // Out-of-scope but existing → 403.
  if (
    // Run next step: !taskInScope(scope, {
    !taskInScope(scope, {
      // Set assignedEmployeeId on the structure being built.
      assignedEmployeeId: task.assignedEmployeeId,
      // Set sectorId on the structure being built.
      sectorId: task.sectorId,
      // Set locationId on the structure being built.
      locationId: task.locationId,
      // Set locationSectorId on the structure being built.
      locationSectorId: task.location.sectorMembership?.sectorId ?? null,
    })
  // Run next step: ) {
  ) {
    // Abort with an error so callers can react.
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
}

/** Ensure the caller may access the given location. */
export async function assertCanAccessLocation(
  // Set scope on the structure being built.
  scope: DataScope,
  // Set locationId on the structure being built.
  locationId: string,
  // Set db on the structure being built.
  db: Prisma.TransactionClient | typeof prisma = prisma,
// Run next step: ): Promise<void> {
): Promise<void> {
  // Unrestricted scope skips the DB check.
  if (scope.kind === "all") return;

  // Scoped findFirst: in-scope hit → allow.
  const location = await db.location.findFirst({
    // Set where on the structure being built.
    where: { id: locationId, ...locationWhere(scope) },
    // Set select on the structure being built.
    select: { id: true },
  });
  // Branch when this condition holds so the right path runs.
  if (!location) {
    // Distinguish missing vs out-of-scope when the row exists.
    const exists = await db.location.findUnique({
      // Set where on the structure being built.
      where: { id: locationId },
      // Set select on the structure being built.
      select: { id: true },
    });
    // Branch when this condition holds so the right path runs.
    if (!exists) {
      // Abort with an error so callers can react.
      throw new AppError(404, "not_found", "Location not found");
    }
    // Abort with an error so callers can react.
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
}

/** Ensure the caller may access the given maintenance ticket. */
export async function assertCanAccessTicket(
  // Set scope on the structure being built.
  scope: DataScope,
  // Set ticketId on the structure being built.
  ticketId: string,
  // Set db on the structure being built.
  db: Prisma.TransactionClient | typeof prisma = prisma,
// Run next step: ): Promise<void> {
): Promise<void> {
  // Unrestricted scope skips the DB check.
  if (scope.kind === "all") return;

  // Scoped findFirst using ticketWhere (assignee / sector / location).
  const ticket = await db.maintenanceTicket.findFirst({
    // Set where on the structure being built.
    where: { id: ticketId, ...ticketWhere(scope) },
    // Set select on the structure being built.
    select: { id: true },
  });
  // Branch when this condition holds so the right path runs.
  if (!ticket) {
    // Same 404 vs 403 split as locations.
    const exists = await db.maintenanceTicket.findUnique({
      // Set where on the structure being built.
      where: { id: ticketId },
      // Set select on the structure being built.
      select: { id: true },
    });
    // Branch when this condition holds so the right path runs.
    if (!exists) {
      // Abort with an error so callers can react.
      throw new AppError(404, "not_found", "Ticket not found");
    }
    // Abort with an error so callers can react.
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
}

/** Ensure the caller may access the session via its parent task's scope. */
export async function assertCanAccessSession(
  // Set scope on the structure being built.
  scope: DataScope,
  // Set sessionId on the structure being built.
  sessionId: string,
// Run next step: ): Promise<void> {
): Promise<void> {
  // Unrestricted scope skips the DB check.
  if (scope.kind === "all") return;

  // Sessions inherit access from their parent cleaning task.
  const session = await prisma.cleaningSession.findUnique({
    // Set where on the structure being built.
    where: { id: sessionId },
    // Set select on the structure being built.
    select: { taskId: true },
  });
  // Branch when this condition holds so the right path runs.
  if (!session) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Session not found");
  }
  // Wait for the async step before continuing.
  await assertCanAccessTask(scope, session.taskId);
}

/** Ensure the caller may access the given sector. */
export async function assertCanAccessSector(
  // Set scope on the structure being built.
  scope: DataScope,
  // Set sectorId on the structure being built.
  sectorId: string,
// Run next step: ): Promise<void> {
): Promise<void> {
  // Unrestricted scope skips the DB check.
  if (scope.kind === "all") return;

  // Sector supervisors: allow when sectorId is in their sectorIds list.
  if (scope.kind === "sectors" && scope.sectorIds.includes(sectorId)) {
    // Exit early; nothing more to do on this path.
    return;
  }

  // Otherwise: 404 if missing, else 403 (assigned_* never see sectors).
  const exists = await prisma.sector.findUnique({
    // Set where on the structure being built.
    where: { id: sectorId },
    // Set select on the structure being built.
    select: { id: true },
  });
  // Branch when this condition holds so the right path runs.
  if (!exists) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Sector not found");
  }
  // Abort with an error so callers can react.
  throw new AppError(403, "forbidden", OUT_OF_SCOPE);
}

/**
 * Sector-scoped actors may only assign locations already in the union of
 * their current sectors (rebalancing among own sectors). Expanding with
 * foreign or unassigned rooms is forbidden.
 */
export async function assertLocationsInSectorScope(
  // Set scope on the structure being built.
  scope: DataScope,
  // Set locationIds on the structure being built.
  locationIds: string[],
// Run next step: ): Promise<void> {
): Promise<void> {
  // Unrestricted actors may attach any locations.
  if (scope.kind === "all") return;
  // Non-sector scopes cannot mutate sector membership lists.
  if (scope.kind !== "sectors") {
    // Abort with an error so callers can react.
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }

  // Deduplicate so the allowed-set check is O(n).
  const unique = [...new Set(locationIds)];
  // Branch when this condition holds so the right path runs.
  if (unique.length === 0) return;

  // Empty sectorIds means no locations are assignable.
  if (scope.sectorIds.length === 0) {
    // Abort with an error so callers can react.
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }

  // Locations already members of any of the caller's sectors.
  const allowed = await prisma.sectorLocation.findMany({
    // Set where on the structure being built.
    where: {
      // Set sectorId on the structure being built.
      sectorId: { in: scope.sectorIds },
      // Set locationId on the structure being built.
      locationId: { in: unique },
    },
    // Set select on the structure being built.
    select: { locationId: true },
  });
  // Capture allowed set for use in this scope.
  const allowedSet = new Set(allowed.map((r) => r.locationId));
  // Any id not in the union is foreign / unassigned → forbid.
  const outside = unique.filter((id) => !allowedSet.has(id));
  // Branch when this condition holds so the right path runs.
  if (outside.length) {
    // Abort with an error so callers can react.
    throw new AppError(403, "forbidden", OUT_OF_SCOPE);
  }
}

/** Supervisors may only create sectors where they are the primary supervisor. */
export function assertCanCreateSector(
  // Set scope on the structure being built.
  scope: DataScope,
  // Set primarySupervisorEmployeeId on the structure being built.
  primarySupervisorEmployeeId: string | null | undefined,
// Run next step: ): void {
): void {
  // Hotel-wide actors may create sectors for anyone.
  if (scope.kind === "all") return;
  // Sector supervisors: must name themselves as primary supervisor.
  if (scope.kind === "sectors") {
    // Branch when this condition holds so the right path runs.
    if (primarySupervisorEmployeeId !== scope.employeeId) {
      // Abort with an error so callers can react.
      throw new AppError(403, "forbidden", OUT_OF_SCOPE);
    }
    // Exit early; nothing more to do on this path.
    return;
  }
  // assigned_tasks / assigned_tickets cannot create sectors.
  throw new AppError(403, "forbidden", OUT_OF_SCOPE);
}
