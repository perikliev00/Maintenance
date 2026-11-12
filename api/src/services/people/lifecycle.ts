/**
 * People lifecycle: block / unblock / archive / restore with access-stop
 * (sessions, invites, devices) under Employee+User locks, accessVersion CAS,
 * and audit. Events publish only after commit.
 */
import {
  // Run next step: InvitationStatus,
  InvitationStatus,
  // Run next step: Prisma,
  Prisma,
  // Run next step: Role,
  Role,
  // Run next step: SessionStatus,
  SessionStatus,
// Run next step: } from "@prisma/client";
} from "@prisma/client";
// Import module ../../constants for this service.
import { ACTIVE_TASK_STATUSES, OPEN_TICKET_STATUSES } from "../../constants";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../../events/bus for this service.
import { publish } from "../../events/bus";
// Import module dependency for this service.
import {
  // Run next step: canChangeUserRole,
  canChangeUserRole,
  // Run next step: isOwner,
  isOwner,
  // Run next step: isPrivilegedRole,
  isPrivilegedRole,
// Run next step: } from "../../permissions";
} from "../../permissions";
// Import module ../audit for this service.
import { recordAudit, type RecordAuditInput } from "../audit";
// Import module dependency for this service.
import {
  // Run next step: lockEmployeeRowsForUpdate,
  lockEmployeeRowsForUpdate,
  // Run next step: lockUsersForLiveAccess,
  lockUsersForLiveAccess,
// Run next step: } from "../liveAccessLocks";
} from "../liveAccessLocks";
// Import module dependency for this service.
import {
  // Run next step: derivePersonStatus,
  derivePersonStatus,
  // Run next step: mapPersonDto,
  mapPersonDto,
  // Declare type PersonDto for callers and internals.
  type PersonDto,
  // Declare type PersonStatus for callers and internals.
  type PersonStatus,
// Run next step: } from "./status";
} from "./status";
// Import type(s) Tx for typing without runtime cost.
import type { Tx } from "../db/types";

// Declare type LifecycleActor for callers and internals.
export type LifecycleActor = {
  // Set userId on the structure being built.
  userId: string;
  // Set employeeId on the structure being built.
  employeeId: string;
  // Set role on the structure being built.
  role: Role;
};

// Build person include object holding related fields.
const personInclude = {
  // Set user on the structure being built.
  user: true,
  // Set _count on the structure being built.
  _count: { select: { devices: { where: { revokedAt: null } } } },
// Run next step: } as const;
} as const;

// Declare type LoadedEmployee for callers and internals.
type LoadedEmployee = Awaited<ReturnType<typeof loadEmployeeOrThrow>>;

/** Whether actor may manage access for a target with the given role (or no user). */
export function canManagePersonAccess(
  // Set actorRole on the structure being built.
  actorRole: Role,
  // Set targetRole on the structure being built.
  targetRole: Role | null,
// Run next step: ): boolean {
): boolean {
  // Branch when this condition holds so the right path runs.
  if (targetRole == null) return true;
  // Branch when this condition holds so the right path runs.
  if (isPrivilegedRole(targetRole) && !isOwner(actorRole)) return false;
  // Return the computed result to the caller.
  return true;
}

// Define loadEmployeeOrThrow — core behavior for this module.
async function loadEmployeeOrThrow(
  // Set employeeId on the structure being built.
  employeeId: string,
  // Set db on the structure being built.
  db: Tx | typeof prisma = prisma,
// Run next step: ) {
) {
  // Load employee asynchronously for the next steps.
  const employee = await db.employee.findUnique({
    // Set where on the structure being built.
    where: { id: employeeId },
    // Set include on the structure being built.
    include: personInclude,
  });
  // Branch when this condition holds so the right path runs.
  if (!employee) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Employee not found");
  }
  // Return the computed result to the caller.
  return employee;
}

// Define stopAccessInTx — core behavior for this module.
async function stopAccessInTx(
  // Set tx on the structure being built.
  tx: Tx,
  // Set employeeId on the structure being built.
  employeeId: string,
  // Set userId on the structure being built.
  userId: string | null,
  // Set now on the structure being built.
  now: Date,
// Run next step: ): Promise<void> {
): Promise<void> {
  // Branch when this condition holds so the right path runs.
  if (userId) {
    // Wait for the async step before continuing.
    await tx.user.updateMany({
      // Set where on the structure being built.
      where: { id: userId, isActive: true },
      // Set data on the structure being built.
      data: { isActive: false },
    });
    // Wait for the async step before continuing.
    await tx.authSession.updateMany({
      // Set where on the structure being built.
      where: { userId, revokedAt: null },
      // Set data on the structure being built.
      data: { revokedAt: now },
    });
  }
  // Wait for the async step before continuing.
  await tx.invitation.updateMany({
    // Set where on the structure being built.
    where: { employeeId, status: InvitationStatus.issued },
    // Set data on the structure being built.
    data: { status: InvitationStatus.revoked, revokedAt: now },
  });
  // Wait for the async step before continuing.
  await tx.device.updateMany({
    // Set where on the structure being built.
    where: { employeeId, revokedAt: null },
    // Set data on the structure being built.
    data: { revokedAt: now },
  });
}

/** Shared lifecycle close: audit then return a fresh person DTO. */
async function auditAndReloadPerson(
  // Set tx on the structure being built.
  tx: Tx,
  // Set employeeId on the structure being built.
  employeeId: string,
  // Set audit on the structure being built.
  audit: RecordAuditInput,
// Run next step: ): Promise<PersonDto> {
): Promise<PersonDto> {
  // Wait for the async step before continuing.
  await recordAudit(audit, tx);
  // Return the computed result to the caller.
  return mapPersonDto(await loadEmployeeOrThrow(employeeId, tx));
}

/**
 * Run a person lifecycle mutation in a transaction, then publish after commit.
 * Keeps event delivery outside the transaction boundary.
 */
async function runPersonLifecycleTx<T>(
  // Set fn on the structure being built.
  fn: (tx: Tx) => Promise<T>,
// Run next step: ): Promise<T> {
): Promise<T> {
  // Load result asynchronously for the next steps.
  const result = await prisma.$transaction(fn);
  // Run next step: publish("people.changed");
  publish("people.changed");
  // Return the computed result to the caller.
  return result;
}

/** Peek helper: active owners need the all-active-owners lock set. */
function needsLockAllActiveOwners(peek: {
  // Set user on the structure being built.
  user: { role: Role; isActive: boolean } | null;
// Run next step: }): boolean {
}): boolean {
  // Return the computed result to the caller.
  return (
    // Run next step: Boolean(peek.user) &&
    Boolean(peek.user) &&
    // Run next step: peek.user!.role === Role.owner &&
    peek.user!.role === Role.owner &&
    // Run next step: peek.user!.isActive
    peek.user!.isActive
  );
}

// Define assertNotLastActiveOwner — core behavior for this module.
async function assertNotLastActiveOwner(
  // Set tx on the structure being built.
  tx: Tx,
  // Set target on the structure being built.
  target: { user: { id: string; role: Role; isActive: boolean } | null },
// Run next step: ): Promise<void> {
): Promise<void> {
  // Branch when this condition holds so the right path runs.
  if (!target.user || target.user.role !== Role.owner || !target.user.isActive) {
    // Exit early; nothing more to do on this path.
    return;
  }
  // Wait for the async step before continuing.
  await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User"
    WHERE role = CAST('owner' AS "Role") AND "isActive" = true
    ORDER BY id
    FOR UPDATE
  `;
  // Load owner count asynchronously for the next steps.
  const ownerCount = await tx.user.count({
    // Set where on the structure being built.
    where: { role: Role.owner, isActive: true },
  });
  // Branch when this condition holds so the right path runs.
  if (ownerCount <= 1) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 409,
      409,
      // Run next step: "conflict",
      "conflict",
      // Run next step: "Cannot block or archive the last active owner",
      "Cannot block or archive the last active owner",
    );
  }
}

// Define collectUnfinishedWork — core behavior for this module.
async function collectUnfinishedWork(tx: Tx, employeeId: string) {
  // Load value asynchronously for the next steps.
  const [activeCleaningTasks, runningSessions, openTickets] = await Promise.all([
    // Run next step: tx.cleaningTask.count({
    tx.cleaningTask.count({
      // Set where on the structure being built.
      where: {
        // Set assignedEmployeeId on the structure being built.
        assignedEmployeeId: employeeId,
        // Set status on the structure being built.
        status: { in: [...ACTIVE_TASK_STATUSES] },
      },
    }),
    // Run next step: tx.cleaningSession.count({
    tx.cleaningSession.count({
      // Set where on the structure being built.
      where: {
        // Run next step: employeeId,
        employeeId,
        // Set status on the structure being built.
        status: SessionStatus.running,
      },
    }),
    // Run next step: tx.maintenanceTicket.count({
    tx.maintenanceTicket.count({
      // Set where on the structure being built.
      where: {
        // Set assigneeId on the structure being built.
        assigneeId: employeeId,
        // Set status on the structure being built.
        status: { in: [...OPEN_TICKET_STATUSES] },
      },
    }),
  ]);
  // Return the computed result to the caller.
  return { activeCleaningTasks, runningSessions, openTickets };
}

// Define throwStaleState — core behavior for this module.
function throwStaleState(
  // Set current on the structure being built.
  current: PersonStatus,
  // Set expectedStatus on the structure being built.
  expectedStatus: PersonStatus,
  // Set accessVersion on the structure being built.
  accessVersion: number,
// Run next step: ): never {
): never {
  // Abort with an error so callers can react.
  throw new AppError(
    // Run next step: 409,
    409,
    // Run next step: "stale_state",
    "stale_state",
    // Run next step: "Person status changed; refresh and try again",
    "Person status changed; refresh and try again",
    // Run next step: { currentStatus: current, expectedStatus, accessVersion },
    { currentStatus: current, expectedStatus, accessVersion },
  );
}

// Define assertExpectedStatus — core behavior for this module.
function assertExpectedStatus(
  // Set current on the structure being built.
  current: PersonStatus,
  // Set expected on the structure being built.
  expected: PersonStatus,
  // Set accessVersion on the structure being built.
  accessVersion: number,
// Run next step: ): void {
): void {
  // Branch when this condition holds so the right path runs.
  if (current !== expected) {
    // Run next step: throwStaleState(current, expected, accessVersion);
    throwStaleState(current, expected, accessVersion);
  }
}

// Define assertAccessVersion — core behavior for this module.
function assertAccessVersion(
  // Set employee on the structure being built.
  employee: { accessVersion: number },
  // Set expectedVersion on the structure being built.
  expectedVersion: number,
  // Set current on the structure being built.
  current: PersonStatus,
  // Set expectedStatus on the structure being built.
  expectedStatus: PersonStatus,
// Run next step: ): void {
): void {
  // Branch when this condition holds so the right path runs.
  if (employee.accessVersion !== expectedVersion) {
    // Run next step: throwStaleState(current, expectedStatus, employee.accessVers…
    throwStaleState(current, expectedStatus, employee.accessVersion);
  }
}

// Define guardActor — core behavior for this module.
function guardActor(
  // Set actor on the structure being built.
  actor: LifecycleActor,
  // Set employee on the structure being built.
  employee: LoadedEmployee,
  // Set selfMessage on the structure being built.
  selfMessage: string,
// Run next step: ): void {
): void {
  // Branch when this condition holds so the right path runs.
  if (actor.employeeId === employee.id) {
    // Abort with an error so callers can react.
    throw new AppError(403, "forbidden", selfMessage);
  }
  // Capture target role for use in this scope.
  const targetRole = employee.user?.role ?? null;
  // Branch when this condition holds so the right path runs.
  if (!canManagePersonAccess(actor.role, targetRole)) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 403,
      403,
      // Run next step: "forbidden",
      "forbidden",
      // Run next step: "Cannot manage access for owner/admin accounts",
      "Cannot manage access for owner/admin accounts",
    );
  }
}

/**
 * Lock order matches assignment writers (User before domain) to avoid deadlocks:
 * User row(s) first when present, then Employee row(s) for archivedAt/version CAS.
 * Employees without a User lock only the Employee row.
 * Last-active-owner targets lock every active owner's User then Employee set.
 */
async function lockAndReloadEmployee(
  // Set tx on the structure being built.
  tx: Tx,
  // Set employeeId on the structure being built.
  employeeId: string,
  // Set opts on the structure being built.
  opts: { lockAllActiveOwners: boolean },
// Run next step: ): Promise<LoadedEmployee> {
): Promise<LoadedEmployee> {
  // Branch when this condition holds so the right path runs.
  if (opts.lockAllActiveOwners) {
    // Load owner employees asynchronously for the next steps.
    const ownerEmployees = await tx.user.findMany({
      // Set where on the structure being built.
      where: { role: Role.owner, isActive: true },
      // Set select on the structure being built.
      select: { id: true, employeeId: true },
      // Set orderBy on the structure being built.
      orderBy: { id: "asc" },
    });
    // Wait for the async step before continuing.
    await lockUsersForLiveAccess(
      // Run next step: tx,
      tx,
      // Run next step: ownerEmployees.map((o) => o.id),
      ownerEmployees.map((o) => o.id),
    );
    // Wait for the async step before continuing.
    await lockEmployeeRowsForUpdate(
      // Run next step: tx,
      tx,
      // Run next step: ownerEmployees.map((o) => o.employeeId),
      ownerEmployees.map((o) => o.employeeId),
    );
    // Load owner count asynchronously for the next steps.
    const ownerCount = await tx.user.count({
      // Set where on the structure being built.
      where: { role: Role.owner, isActive: true },
    });
    // Branch when this condition holds so the right path runs.
    if (ownerCount <= 1) {
      // Abort with an error so callers can react.
      throw new AppError(
        // Run next step: 409,
        409,
        // Run next step: "conflict",
        "conflict",
        // Run next step: "Cannot block or archive the last active owner",
        "Cannot block or archive the last active owner",
      );
    }
  // Run next step: } else {
  } else {
    // Load provisional asynchronously for the next steps.
    const provisional = await loadEmployeeOrThrow(employeeId, tx);
    // Branch when this condition holds so the right path runs.
    if (provisional.user) {
      // Wait for the async step before continuing.
      await lockUsersForLiveAccess(tx, [provisional.user.id]);
    }
    // Wait for the async step before continuing.
    await lockEmployeeRowsForUpdate(tx, [employeeId]);
  }

  // Return the computed result to the caller.
  return loadEmployeeOrThrow(employeeId, tx);
}

/** Increment accessVersion with CAS; throws stale_state when the version raced. */
async function bumpAccessVersionCas(
  // Set tx on the structure being built.
  tx: Tx,
  // Set employeeId on the structure being built.
  employeeId: string,
  // Set expectedVersion on the structure being built.
  expectedVersion: number,
  // Set current on the structure being built.
  current: PersonStatus,
  // Set expectedStatus on the structure being built.
  expectedStatus: PersonStatus,
  // Set extraWhere on the structure being built.
  extraWhere: Prisma.EmployeeWhereInput = {},
// Run next step: ): Promise<void> {
): Promise<void> {
  // Load bumped asynchronously for the next steps.
  const bumped = await tx.employee.updateMany({
    // Set where on the structure being built.
    where: {
      // Set id on the structure being built.
      id: employeeId,
      // Set accessVersion on the structure being built.
      accessVersion: expectedVersion,
      // Run next step: ...extraWhere,
      ...extraWhere,
    },
    // Set data on the structure being built.
    data: { accessVersion: { increment: 1 } },
  });
  // Branch when this condition holds so the right path runs.
  if (bumped.count === 0) {
    // Load fresh asynchronously for the next steps.
    const fresh = await loadEmployeeOrThrow(employeeId, tx);
    // Run next step: throwStaleState(
    throwStaleState(
      // Run next step: derivePersonStatus(fresh),
      derivePersonStatus(fresh),
      // Run next step: expectedStatus,
      expectedStatus,
      // Run next step: fresh.accessVersion,
      fresh.accessVersion,
    );
  }
}

/** GET person detail by employee id. */
export async function getPerson(employeeId: string): Promise<PersonDto> {
  // Load employee asynchronously for the next steps.
  const employee = await loadEmployeeOrThrow(employeeId);
  // Return the computed result to the caller.
  return mapPersonDto(employee);
}

/** Block an active account: stop access, revoke sessions/invites/devices. */
export async function blockPerson(
  // Set actor on the structure being built.
  actor: LifecycleActor,
  // Set employeeId on the structure being built.
  employeeId: string,
  // Set expectedStatus on the structure being built.
  expectedStatus: PersonStatus,
  // Set expectedAccessVersion on the structure being built.
  expectedAccessVersion: number,
// Run next step: ): Promise<PersonDto> {
): Promise<PersonDto> {
  // Return the computed result to the caller.
  return runPersonLifecycleTx(async (tx) => {
    // Peek only to decide owner-set lock; definitive checks use post-lock reload.
    const peek = await loadEmployeeOrThrow(employeeId, tx);
    // Capture lock owners for use in this scope.
    const lockOwners = needsLockAllActiveOwners(peek);

    // Load employee asynchronously for the next steps.
    const employee = await lockAndReloadEmployee(tx, employeeId, {
      // Set lockAllActiveOwners on the structure being built.
      lockAllActiveOwners: lockOwners,
    });
    // Run next step: guardActor(
    guardActor(
      // Run next step: actor,
      actor,
      // Run next step: employee,
      employee,
      // Run next step: "Cannot block your own account from Team",
      "Cannot block your own account from Team",
    );

    // Capture current for use in this scope.
    const current = derivePersonStatus(employee);
    // Run next step: assertAccessVersion(
    assertAccessVersion(
      // Run next step: employee,
      employee,
      // Run next step: expectedAccessVersion,
      expectedAccessVersion,
      // Run next step: current,
      current,
      // Run next step: expectedStatus,
      expectedStatus,
    );

    // Branch when this condition holds so the right path runs.
    if (current === "blocked") {
      // Run next step: assertExpectedStatus(current, expectedStatus, employee.acces…
      assertExpectedStatus(current, expectedStatus, employee.accessVersion);
      // Return the computed result to the caller.
      return mapPersonDto(employee);
    }
    // Run next step: assertExpectedStatus(current, expectedStatus, employee.acces…
    assertExpectedStatus(current, expectedStatus, employee.accessVersion);
    // Branch when this condition holds so the right path runs.
    if (current !== "active" || !employee.user) {
      // Abort with an error so callers can react.
      throw new AppError(
        // Run next step: 409,
        409,
        // Run next step: "invalid_state",
        "invalid_state",
        // Run next step: "Only an active account can be blocked",
        "Only an active account can be blocked",
        // Run next step: { currentStatus: current },
        { currentStatus: current },
      );
    }

    // Re-assert last-owner under the already-held owner locks.
    if (lockOwners) {
      // Wait for the async step before continuing.
      await assertNotLastActiveOwner(tx, employee);
    }

    // Capture now for use in this scope.
    const now = new Date();
    // Load deactivated asynchronously for the next steps.
    const deactivated = await tx.user.updateMany({
      // Set where on the structure being built.
      where: { id: employee.user.id, isActive: true },
      // Set data on the structure being built.
      data: { isActive: false },
    });
    // Branch when this condition holds so the right path runs.
    if (deactivated.count === 0) {
      // Run next step: throwStaleState(
      throwStaleState(
        // Run next step: derivePersonStatus(await loadEmployeeOrThrow(employeeId, tx)…
        derivePersonStatus(await loadEmployeeOrThrow(employeeId, tx)),
        // Run next step: expectedStatus,
        expectedStatus,
        // Run next step: employee.accessVersion,
        employee.accessVersion,
      );
    }

    // Wait for the async step before continuing.
    await bumpAccessVersionCas(
      // Run next step: tx,
      tx,
      // Run next step: employee.id,
      employee.id,
      // Run next step: expectedAccessVersion,
      expectedAccessVersion,
      // Run next step: current,
      current,
      // Run next step: expectedStatus,
      expectedStatus,
    );

    // User already deactivated above; stopAccessInTx revokes sessions/invites/devices
    // (and is a no-op on the user row when already inactive).
    await stopAccessInTx(tx, employee.id, employee.user.id, now);

    // Return the computed result to the caller.
    return auditAndReloadPerson(tx, employeeId, {
      // Set actorEmployeeId on the structure being built.
      actorEmployeeId: actor.employeeId,
      // Set action on the structure being built.
      action: "people.block",
      // Set entityType on the structure being built.
      entityType: "employee",
      // Set entityId on the structure being built.
      entityId: employee.id,
      // Set before on the structure being built.
      before: { status: current, isActive: true },
      // Set after on the structure being built.
      after: { status: "blocked", isActive: false },
      // Set summary on the structure being built.
      summary: `Blocked ${employee.fullName}`,
    });
  });
}

/** Unblock a blocked (non-archived) account. Does not restore sessions/devices/invites. */
export async function unblockPerson(
  // Set actor on the structure being built.
  actor: LifecycleActor,
  // Set employeeId on the structure being built.
  employeeId: string,
  // Set expectedStatus on the structure being built.
  expectedStatus: PersonStatus,
  // Set expectedAccessVersion on the structure being built.
  expectedAccessVersion: number,
// Run next step: ): Promise<PersonDto> {
): Promise<PersonDto> {
  // Return the computed result to the caller.
  return runPersonLifecycleTx(async (tx) => {
    // Load employee asynchronously for the next steps.
    const employee = await lockAndReloadEmployee(tx, employeeId, {
      // Set lockAllActiveOwners on the structure being built.
      lockAllActiveOwners: false,
    });
    // Run next step: guardActor(
    guardActor(
      // Run next step: actor,
      actor,
      // Run next step: employee,
      employee,
      // Run next step: "Cannot unblock your own account from Team",
      "Cannot unblock your own account from Team",
    );

    // Capture current for use in this scope.
    const current = derivePersonStatus(employee);
    // Run next step: assertAccessVersion(
    assertAccessVersion(
      // Run next step: employee,
      employee,
      // Run next step: expectedAccessVersion,
      expectedAccessVersion,
      // Run next step: current,
      current,
      // Run next step: expectedStatus,
      expectedStatus,
    );

    // Branch when this condition holds so the right path runs.
    if (current === "active") {
      // Run next step: assertExpectedStatus(current, expectedStatus, employee.acces…
      assertExpectedStatus(current, expectedStatus, employee.accessVersion);
      // Return the computed result to the caller.
      return mapPersonDto(employee);
    }
    // Run next step: assertExpectedStatus(current, expectedStatus, employee.acces…
    assertExpectedStatus(current, expectedStatus, employee.accessVersion);
    // Branch when this condition holds so the right path runs.
    if (current !== "blocked" || !employee.user) {
      // Abort with an error so callers can react.
      throw new AppError(
        // Run next step: 409,
        409,
        // Run next step: "invalid_state",
        "invalid_state",
        // Run next step: "Only a blocked account can be unblocked",
        "Only a blocked account can be unblocked",
        // Run next step: { currentStatus: current },
        { currentStatus: current },
      );
    }

    // Load updated asynchronously for the next steps.
    const updated = await tx.user.updateMany({
      // Set where on the structure being built.
      where: {
        // Set id on the structure being built.
        id: employee.user.id,
        // Set isActive on the structure being built.
        isActive: false,
      },
      // Set data on the structure being built.
      data: { isActive: true },
    });
    // Branch when this condition holds so the right path runs.
    if (updated.count === 0) {
      // Run next step: throwStaleState(
      throwStaleState(
        // Run next step: derivePersonStatus(await loadEmployeeOrThrow(employeeId, tx)…
        derivePersonStatus(await loadEmployeeOrThrow(employeeId, tx)),
        // Run next step: expectedStatus,
        expectedStatus,
        // Run next step: employee.accessVersion,
        employee.accessVersion,
      );
    }

    // Wait for the async step before continuing.
    await bumpAccessVersionCas(
      // Run next step: tx,
      tx,
      // Run next step: employee.id,
      employee.id,
      // Run next step: expectedAccessVersion,
      expectedAccessVersion,
      // Run next step: current,
      current,
      // Run next step: expectedStatus,
      expectedStatus,
      // Run next step: { archivedAt: null },
      { archivedAt: null },
    );

    // Return the computed result to the caller.
    return auditAndReloadPerson(tx, employeeId, {
      // Set actorEmployeeId on the structure being built.
      actorEmployeeId: actor.employeeId,
      // Set action on the structure being built.
      action: "people.unblock",
      // Set entityType on the structure being built.
      entityType: "employee",
      // Set entityId on the structure being built.
      entityId: employee.id,
      // Set before on the structure being built.
      before: { status: "blocked", isActive: false },
      // Set after on the structure being built.
      after: { status: "active", isActive: true },
      // Set summary on the structure being built.
      summary: `Unblocked ${employee.fullName}`,
    });
  });
}

/** Archive (remove from active roster). Refuses when unfinished work remains. */
export async function archivePerson(
  // Set actor on the structure being built.
  actor: LifecycleActor,
  // Set employeeId on the structure being built.
  employeeId: string,
  // Set expectedStatus on the structure being built.
  expectedStatus: PersonStatus,
  // Set expectedAccessVersion on the structure being built.
  expectedAccessVersion: number,
// Run next step: ): Promise<PersonDto> {
): Promise<PersonDto> {
  // Return the computed result to the caller.
  return runPersonLifecycleTx(async (tx) => {
    // Load peek asynchronously for the next steps.
    const peek = await loadEmployeeOrThrow(employeeId, tx);
    // Capture lock owners for use in this scope.
    const lockOwners = needsLockAllActiveOwners(peek);

    // Load employee asynchronously for the next steps.
    const employee = await lockAndReloadEmployee(tx, employeeId, {
      // Set lockAllActiveOwners on the structure being built.
      lockAllActiveOwners: lockOwners,
    });
    // Run next step: guardActor(
    guardActor(
      // Run next step: actor,
      actor,
      // Run next step: employee,
      employee,
      // Run next step: "Cannot archive your own account from Team",
      "Cannot archive your own account from Team",
    );

    // Capture current for use in this scope.
    const current = derivePersonStatus(employee);
    // Run next step: assertAccessVersion(
    assertAccessVersion(
      // Run next step: employee,
      employee,
      // Run next step: expectedAccessVersion,
      expectedAccessVersion,
      // Run next step: current,
      current,
      // Run next step: expectedStatus,
      expectedStatus,
    );

    // Branch when this condition holds so the right path runs.
    if (current === "archived") {
      // Run next step: assertExpectedStatus(current, expectedStatus, employee.acces…
      assertExpectedStatus(current, expectedStatus, employee.accessVersion);
      // Return the computed result to the caller.
      return mapPersonDto(employee);
    }
    // Run next step: assertExpectedStatus(current, expectedStatus, employee.acces…
    assertExpectedStatus(current, expectedStatus, employee.accessVersion);

    // Unfinished work must be counted under locks so concurrent assign is visible.
    const unfinished = await collectUnfinishedWork(tx, employee.id);
    // Branch when this condition holds so the right path runs.
    if (
      // Run next step: unfinished.activeCleaningTasks > 0 ||
      unfinished.activeCleaningTasks > 0 ||
      // Run next step: unfinished.runningSessions > 0 ||
      unfinished.runningSessions > 0 ||
      // Run next step: unfinished.openTickets > 0
      unfinished.openTickets > 0
    // Run next step: ) {
    ) {
      // Abort with an error so callers can react.
      throw new AppError(
        // Run next step: 409,
        409,
        // Run next step: "unfinished_work",
        "unfinished_work",
        // Run next step: "Finish or reassign open work before archiving this employee…
        "Finish or reassign open work before archiving this employee",
        // Run next step: unfinished,
        unfinished,
      );
    }

    // Branch when this condition holds so the right path runs.
    if (lockOwners) {
      // Wait for the async step before continuing.
      await assertNotLastActiveOwner(tx, employee);
    }

    // Capture now for use in this scope.
    const now = new Date();
    // Load archived asynchronously for the next steps.
    const archived = await tx.employee.updateMany({
      // Set where on the structure being built.
      where: {
        // Set id on the structure being built.
        id: employee.id,
        // Set archivedAt on the structure being built.
        archivedAt: null,
        // Set accessVersion on the structure being built.
        accessVersion: expectedAccessVersion,
      },
      // Set data on the structure being built.
      data: {
        // Set archivedAt on the structure being built.
        archivedAt: now,
        // Set accessVersion on the structure being built.
        accessVersion: { increment: 1 },
      },
    });
    // Branch when this condition holds so the right path runs.
    if (archived.count === 0) {
      // Load fresh asynchronously for the next steps.
      const fresh = await loadEmployeeOrThrow(employeeId, tx);
      // Run next step: throwStaleState(
      throwStaleState(
        // Run next step: derivePersonStatus(fresh),
        derivePersonStatus(fresh),
        // Run next step: expectedStatus,
        expectedStatus,
        // Run next step: fresh.accessVersion,
        fresh.accessVersion,
      );
    }

    // Wait for the async step before continuing.
    await stopAccessInTx(tx, employee.id, employee.user?.id ?? null, now);

    // Return the computed result to the caller.
    return auditAndReloadPerson(tx, employeeId, {
      // Set actorEmployeeId on the structure being built.
      actorEmployeeId: actor.employeeId,
      // Set action on the structure being built.
      action: "people.archive",
      // Set entityType on the structure being built.
      entityType: "employee",
      // Set entityId on the structure being built.
      entityId: employee.id,
      // Set before on the structure being built.
      before: { status: current, archivedAt: null },
      // Set after on the structure being built.
      after: { status: "archived", archivedAt: now.toISOString() },
      // Set summary on the structure being built.
      summary: `Archived ${employee.fullName}`,
    });
  });
}

/**
 * Restore an archived employee. Clears archivedAt; leaves User inactive so a
 * separate unblock / new invite is required for access.
 */
export async function restorePerson(
  // Set actor on the structure being built.
  actor: LifecycleActor,
  // Set employeeId on the structure being built.
  employeeId: string,
  // Set expectedStatus on the structure being built.
  expectedStatus: PersonStatus,
  // Set expectedAccessVersion on the structure being built.
  expectedAccessVersion: number,
// Run next step: ): Promise<PersonDto> {
): Promise<PersonDto> {
  // Return the computed result to the caller.
  return runPersonLifecycleTx(async (tx) => {
    // Load employee asynchronously for the next steps.
    const employee = await lockAndReloadEmployee(tx, employeeId, {
      // Set lockAllActiveOwners on the structure being built.
      lockAllActiveOwners: false,
    });
    // Run next step: guardActor(
    guardActor(
      // Run next step: actor,
      actor,
      // Run next step: employee,
      employee,
      // Run next step: "Cannot restore your own account from Team",
      "Cannot restore your own account from Team",
    );

    // Capture current for use in this scope.
    const current = derivePersonStatus(employee);
    // Run next step: assertAccessVersion(
    assertAccessVersion(
      // Run next step: employee,
      employee,
      // Run next step: expectedAccessVersion,
      expectedAccessVersion,
      // Run next step: current,
      current,
      // Run next step: expectedStatus,
      expectedStatus,
    );

    // Branch when this condition holds so the right path runs.
    if (current !== "archived") {
      // Idempotent when already restored to a non-archived status matching expected.
      if (expectedStatus === current) {
        // Return the computed result to the caller.
        return mapPersonDto(employee);
      }
      // Run next step: assertExpectedStatus(current, expectedStatus, employee.acces…
      assertExpectedStatus(current, expectedStatus, employee.accessVersion);
    // Run next step: } else {
    } else {
      // Run next step: assertExpectedStatus(current, expectedStatus, employee.acces…
      assertExpectedStatus(current, expectedStatus, employee.accessVersion);
    }

    // Branch when this condition holds so the right path runs.
    if (employee.user) {
      // Branch when this condition holds so the right path runs.
      if (
        // Run next step: !canChangeUserRole(actor.role, employee.user.role, employee.…
        !canChangeUserRole(actor.role, employee.user.role, employee.user.role)
      // Run next step: ) {
      ) {
        // Abort with an error so callers can react.
        throw new AppError(
          // Run next step: 403,
          403,
          // Run next step: "forbidden",
          "forbidden",
          // Run next step: "Cannot manage access for owner/admin accounts",
          "Cannot manage access for owner/admin accounts",
        );
      }
    }

    // Load restored asynchronously for the next steps.
    const restored = await tx.employee.updateMany({
      // Set where on the structure being built.
      where: {
        // Set id on the structure being built.
        id: employee.id,
        // Set archivedAt on the structure being built.
        archivedAt: { not: null },
        // Set accessVersion on the structure being built.
        accessVersion: expectedAccessVersion,
      },
      // Set data on the structure being built.
      data: {
        // Set archivedAt on the structure being built.
        archivedAt: null,
        // Set accessVersion on the structure being built.
        accessVersion: { increment: 1 },
      },
    });
    // Branch when this condition holds so the right path runs.
    if (restored.count === 0 && current === "archived") {
      // Load fresh asynchronously for the next steps.
      const fresh = await loadEmployeeOrThrow(employeeId, tx);
      // Run next step: throwStaleState(
      throwStaleState(
        // Run next step: derivePersonStatus(fresh),
        derivePersonStatus(fresh),
        // Run next step: expectedStatus,
        expectedStatus,
        // Run next step: fresh.accessVersion,
        fresh.accessVersion,
      );
    }

    // Ensure user stays inactive after restore (access requires explicit unblock).
    if (employee.user?.isActive) {
      // Wait for the async step before continuing.
      await tx.user.update({
        // Set where on the structure being built.
        where: { id: employee.user.id },
        // Set data on the structure being built.
        data: { isActive: false },
      });
    }

    // Return the computed result to the caller.
    return auditAndReloadPerson(tx, employeeId, {
      // Set actorEmployeeId on the structure being built.
      actorEmployeeId: actor.employeeId,
      // Set action on the structure being built.
      action: "people.restore",
      // Set entityType on the structure being built.
      entityType: "employee",
      // Set entityId on the structure being built.
      entityId: employee.id,
      // Set before on the structure being built.
      before: {
        // Set status on the structure being built.
        status: "archived",
        // Set archivedAt on the structure being built.
        archivedAt: employee.archivedAt?.toISOString() ?? null,
      },
      // Set after on the structure being built.
      after: {
        // Set status on the structure being built.
        status: employee.user ? "blocked" : "not_activated",
        // Set archivedAt on the structure being built.
        archivedAt: null,
      },
      // Set summary on the structure being built.
      summary: `Restored ${employee.fullName} to the team roster`,
    });
  });
}
