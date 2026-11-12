/**
 * People lifecycle: block / unblock / archive / restore with access-stop
 * (sessions, invites, devices) under Employee+User locks, accessVersion CAS,
 * and audit. Events publish only after commit.
 */
import {
  InvitationStatus,
  Prisma,
  Role,
  SessionStatus,
} from "@prisma/client";
import { ACTIVE_TASK_STATUSES, OPEN_TICKET_STATUSES } from "../../constants";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import {
  canChangeUserRole,
  isOwner,
  isPrivilegedRole,
} from "../../permissions";
import { recordAudit, type RecordAuditInput } from "../audit";
import {
  lockEmployeeRowsForUpdate,
  lockUsersForLiveAccess,
} from "../liveAccessLocks";
import {
  derivePersonStatus,
  mapPersonDto,
  // Declare type PersonDto for callers and internals.
  type PersonDto,
  // Declare type PersonStatus for callers and internals.
  type PersonStatus,
} from "./status";
// Import type(s) Tx for typing without runtime cost.
import type { Tx } from "../db/types";

// Declare type LifecycleActor for callers and internals.
export type LifecycleActor = {
  userId: string;
  employeeId: string;
  role: Role;
};

// Build person include object holding related fields.
const personInclude = {
  user: true,
  _count: { select: { devices: { where: { revokedAt: null } } } },
} as const;

// Declare type LoadedEmployee for callers and internals.
type LoadedEmployee = Awaited<ReturnType<typeof loadEmployeeOrThrow>>;

/** Whether actor may manage access for a target with the given role (or no user). */
export function canManagePersonAccess(
  actorRole: Role,
  targetRole: Role | null,
): boolean {
  if (targetRole == null) return true;
  if (isPrivilegedRole(targetRole) && !isOwner(actorRole)) return false;
  return true;
}

async function loadEmployeeOrThrow(
  employeeId: string,
  db: Tx | typeof prisma = prisma,
) {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: personInclude,
  });
  if (!employee) {
    throw new AppError(404, "not_found", "Employee not found");
  }
  return employee;
}

async function stopAccessInTx(
  tx: Tx,
  employeeId: string,
  userId: string | null,
  now: Date,
): Promise<void> {
  if (userId) {
    await tx.user.updateMany({
      where: { id: userId, isActive: true },
      data: { isActive: false },
    });
    await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
  await tx.invitation.updateMany({
    where: { employeeId, status: InvitationStatus.issued },
    data: { status: InvitationStatus.revoked, revokedAt: now },
  });
  await tx.device.updateMany({
    where: { employeeId, revokedAt: null },
    data: { revokedAt: now },
  });
}

/** Shared lifecycle close: audit then return a fresh person DTO. */
async function auditAndReloadPerson(
  tx: Tx,
  employeeId: string,
  audit: RecordAuditInput,
): Promise<PersonDto> {
  await recordAudit(audit, tx);
  return mapPersonDto(await loadEmployeeOrThrow(employeeId, tx));
}

/**
 * Run a person lifecycle mutation in a transaction, then publish after commit.
 * Keeps event delivery outside the transaction boundary.
 */
async function runPersonLifecycleTx<T>(
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const result = await prisma.$transaction(fn);
  publish("people.changed");
  return result;
}

/** Peek helper: active owners need the all-active-owners lock set. */
function needsLockAllActiveOwners(peek: {
  user: { role: Role; isActive: boolean } | null;
}): boolean {
  return (
    Boolean(peek.user) &&
    peek.user!.role === Role.owner &&
    peek.user!.isActive
  );
}

async function assertNotLastActiveOwner(
  tx: Tx,
  target: { user: { id: string; role: Role; isActive: boolean } | null },
): Promise<void> {
  if (!target.user || target.user.role !== Role.owner || !target.user.isActive) {
    // Exit early; nothing more to do on this path.
    return;
  }
  await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User"
    WHERE role = CAST('owner' AS "Role") AND "isActive" = true
    ORDER BY id
    FOR UPDATE
  `;
  // Load owner count asynchronously for the next steps.
  const ownerCount = await tx.user.count({
    where: { role: Role.owner, isActive: true },
  });
  if (ownerCount <= 1) {
    throw new AppError(
      409,
      "conflict",
      "Cannot block or archive the last active owner",
    );
  }
}

async function collectUnfinishedWork(tx: Tx, employeeId: string) {
  const [activeCleaningTasks, runningSessions, openTickets] = await Promise.all([
    tx.cleaningTask.count({
      where: {
        assignedEmployeeId: employeeId,
        status: { in: [...ACTIVE_TASK_STATUSES] },
      },
    }),
    tx.cleaningSession.count({
      where: {
        employeeId,
        status: SessionStatus.running,
      },
    }),
    tx.maintenanceTicket.count({
      where: {
        assigneeId: employeeId,
        status: { in: [...OPEN_TICKET_STATUSES] },
      },
    }),
  ]);
  return { activeCleaningTasks, runningSessions, openTickets };
}

function throwStaleState(
  current: PersonStatus,
  expectedStatus: PersonStatus,
  accessVersion: number,
): never {
  throw new AppError(
    409,
    "stale_state",
    "Person status changed; refresh and try again",
    { currentStatus: current, expectedStatus, accessVersion },
  );
}

function assertExpectedStatus(
  current: PersonStatus,
  expected: PersonStatus,
  accessVersion: number,
): void {
  if (current !== expected) {
    throwStaleState(current, expected, accessVersion);
  }
}

function assertAccessVersion(
  employee: { accessVersion: number },
  expectedVersion: number,
  current: PersonStatus,
  expectedStatus: PersonStatus,
): void {
  if (employee.accessVersion !== expectedVersion) {
    throwStaleState(current, expectedStatus, employee.accessVersion);
  }
}

function guardActor(
  actor: LifecycleActor,
  employee: LoadedEmployee,
  selfMessage: string,
): void {
  if (actor.employeeId === employee.id) {
    throw new AppError(403, "forbidden", selfMessage);
  }
  // Capture target role for use in this scope.
  const targetRole = employee.user?.role ?? null;
  if (!canManagePersonAccess(actor.role, targetRole)) {
    throw new AppError(
      403,
      "forbidden",
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
  tx: Tx,
  employeeId: string,
  opts: { lockAllActiveOwners: boolean },
): Promise<LoadedEmployee> {
  if (opts.lockAllActiveOwners) {
    // Load owner employees asynchronously for the next steps.
    const ownerEmployees = await tx.user.findMany({
      where: { role: Role.owner, isActive: true },
      select: { id: true, employeeId: true },
      orderBy: { id: "asc" },
    });
    await lockUsersForLiveAccess(
      tx,
      ownerEmployees.map((o) => o.id),
    );
    await lockEmployeeRowsForUpdate(
      tx,
      ownerEmployees.map((o) => o.employeeId),
    );
    // Load owner count asynchronously for the next steps.
    const ownerCount = await tx.user.count({
      where: { role: Role.owner, isActive: true },
    });
    if (ownerCount <= 1) {
      throw new AppError(
        409,
        "conflict",
        "Cannot block or archive the last active owner",
      );
    }
  } else {
    const provisional = await loadEmployeeOrThrow(employeeId, tx);
    if (provisional.user) {
      await lockUsersForLiveAccess(tx, [provisional.user.id]);
    }
    await lockEmployeeRowsForUpdate(tx, [employeeId]);
  }

  return loadEmployeeOrThrow(employeeId, tx);
}

/** Increment accessVersion with CAS; throws stale_state when the version raced. */
async function bumpAccessVersionCas(
  tx: Tx,
  employeeId: string,
  expectedVersion: number,
  current: PersonStatus,
  expectedStatus: PersonStatus,
  extraWhere: Prisma.EmployeeWhereInput = {},
): Promise<void> {
  const bumped = await tx.employee.updateMany({
    where: {
      id: employeeId,
      accessVersion: expectedVersion,
      ...extraWhere,
    },
    data: { accessVersion: { increment: 1 } },
  });
  if (bumped.count === 0) {
    const fresh = await loadEmployeeOrThrow(employeeId, tx);
    throwStaleState(
      derivePersonStatus(fresh),
      expectedStatus,
      fresh.accessVersion,
    );
  }
}

/** GET person detail by employee id. */
export async function getPerson(employeeId: string): Promise<PersonDto> {
  const employee = await loadEmployeeOrThrow(employeeId);
  return mapPersonDto(employee);
}

/** Block an active account: stop access, revoke sessions/invites/devices. */
export async function blockPerson(
  actor: LifecycleActor,
  employeeId: string,
  expectedStatus: PersonStatus,
  expectedAccessVersion: number,
): Promise<PersonDto> {
  return runPersonLifecycleTx(async (tx) => {
    // Peek only to decide owner-set lock; definitive checks use post-lock reload.
    const peek = await loadEmployeeOrThrow(employeeId, tx);
    // Capture lock owners for use in this scope.
    const lockOwners = needsLockAllActiveOwners(peek);

    const employee = await lockAndReloadEmployee(tx, employeeId, {
      lockAllActiveOwners: lockOwners,
    });
    guardActor(
      actor,
      employee,
      "Cannot block your own account from Team",
    );

    const current = derivePersonStatus(employee);
    assertAccessVersion(
      employee,
      expectedAccessVersion,
      current,
      expectedStatus,
    );

    if (current === "blocked") {
      assertExpectedStatus(current, expectedStatus, employee.accessVersion);
      return mapPersonDto(employee);
    }
    assertExpectedStatus(current, expectedStatus, employee.accessVersion);
    if (current !== "active" || !employee.user) {
      throw new AppError(
        409,
        "invalid_state",
        "Only an active account can be blocked",
        { currentStatus: current },
      );
    }

    // Re-assert last-owner under the already-held owner locks.
    if (lockOwners) {
      await assertNotLastActiveOwner(tx, employee);
    }

    const now = new Date();
    const deactivated = await tx.user.updateMany({
      where: { id: employee.user.id, isActive: true },
      data: { isActive: false },
    });
    if (deactivated.count === 0) {
      throwStaleState(
        derivePersonStatus(await loadEmployeeOrThrow(employeeId, tx)),
        expectedStatus,
        employee.accessVersion,
      );
    }

    await bumpAccessVersionCas(
      tx,
      employee.id,
      expectedAccessVersion,
      current,
      expectedStatus,
    );

    // User already deactivated above; stopAccessInTx revokes sessions/invites/devices
    // (and is a no-op on the user row when already inactive).
    await stopAccessInTx(tx, employee.id, employee.user.id, now);

    return auditAndReloadPerson(tx, employeeId, {
      actorEmployeeId: actor.employeeId,
      action: "people.block",
      entityType: "employee",
      entityId: employee.id,
      before: { status: current, isActive: true },
      after: { status: "blocked", isActive: false },
      summary: `Blocked ${employee.fullName}`,
    });
  });
}

/** Unblock a blocked (non-archived) account. Does not restore sessions/devices/invites. */
export async function unblockPerson(
  actor: LifecycleActor,
  employeeId: string,
  expectedStatus: PersonStatus,
  expectedAccessVersion: number,
): Promise<PersonDto> {
  return runPersonLifecycleTx(async (tx) => {
    const employee = await lockAndReloadEmployee(tx, employeeId, {
      lockAllActiveOwners: false,
    });
    guardActor(
      actor,
      employee,
      "Cannot unblock your own account from Team",
    );

    const current = derivePersonStatus(employee);
    assertAccessVersion(
      employee,
      expectedAccessVersion,
      current,
      expectedStatus,
    );

    if (current === "active") {
      assertExpectedStatus(current, expectedStatus, employee.accessVersion);
      return mapPersonDto(employee);
    }
    assertExpectedStatus(current, expectedStatus, employee.accessVersion);
    if (current !== "blocked" || !employee.user) {
      // Abort with an error so callers can react.
      throw new AppError(
        409,
        "invalid_state",
        "Only a blocked account can be unblocked",
        { currentStatus: current },
      );
    }

    const updated = await tx.user.updateMany({
      where: {
        id: employee.user.id,
        isActive: false,
      },
      data: { isActive: true },
    });
    if (updated.count === 0) {
      throwStaleState(
        derivePersonStatus(await loadEmployeeOrThrow(employeeId, tx)),
        expectedStatus,
        employee.accessVersion,
      );
    }

    await bumpAccessVersionCas(
      tx,
      employee.id,
      expectedAccessVersion,
      current,
      expectedStatus,
      { archivedAt: null },
    );

    return auditAndReloadPerson(tx, employeeId, {
      actorEmployeeId: actor.employeeId,
      action: "people.unblock",
      entityType: "employee",
      entityId: employee.id,
      before: { status: "blocked", isActive: false },
      after: { status: "active", isActive: true },
      summary: `Unblocked ${employee.fullName}`,
    });
  });
}

/** Archive (remove from active roster). Refuses when unfinished work remains. */
export async function archivePerson(
  actor: LifecycleActor,
  employeeId: string,
  expectedStatus: PersonStatus,
  expectedAccessVersion: number,
): Promise<PersonDto> {
  return runPersonLifecycleTx(async (tx) => {
    const peek = await loadEmployeeOrThrow(employeeId, tx);
    // Capture lock owners for use in this scope.
    const lockOwners = needsLockAllActiveOwners(peek);

    const employee = await lockAndReloadEmployee(tx, employeeId, {
      lockAllActiveOwners: lockOwners,
    });
    guardActor(
      actor,
      employee,
      "Cannot archive your own account from Team",
    );

    const current = derivePersonStatus(employee);
    assertAccessVersion(
      employee,
      expectedAccessVersion,
      current,
      expectedStatus,
    );

    if (current === "archived") {
      assertExpectedStatus(current, expectedStatus, employee.accessVersion);
      return mapPersonDto(employee);
    }
    assertExpectedStatus(current, expectedStatus, employee.accessVersion);

    // Unfinished work must be counted under locks so concurrent assign is visible.
    const unfinished = await collectUnfinishedWork(tx, employee.id);
    if (
      unfinished.activeCleaningTasks > 0 ||
      unfinished.runningSessions > 0 ||
      unfinished.openTickets > 0
    ) {
      // Abort with an error so callers can react.
      throw new AppError(
        409,
        "unfinished_work",
        "Finish or reassign open work before archiving this employee",
        unfinished,
      );
    }

    if (lockOwners) {
      await assertNotLastActiveOwner(tx, employee);
    }

    const now = new Date();
    const archived = await tx.employee.updateMany({
      where: {
        id: employee.id,
        archivedAt: null,
        accessVersion: expectedAccessVersion,
      },
      data: {
        archivedAt: now,
        accessVersion: { increment: 1 },
      },
    });
    if (archived.count === 0) {
      const fresh = await loadEmployeeOrThrow(employeeId, tx);
      throwStaleState(
        derivePersonStatus(fresh),
        expectedStatus,
        fresh.accessVersion,
      );
    }

    await stopAccessInTx(tx, employee.id, employee.user?.id ?? null, now);

    return auditAndReloadPerson(tx, employeeId, {
      actorEmployeeId: actor.employeeId,
      action: "people.archive",
      entityType: "employee",
      entityId: employee.id,
      before: { status: current, archivedAt: null },
      after: { status: "archived", archivedAt: now.toISOString() },
      summary: `Archived ${employee.fullName}`,
    });
  });
}

/**
 * Restore an archived employee. Clears archivedAt; leaves User inactive so a
 * separate unblock / new invite is required for access.
 */
export async function restorePerson(
  actor: LifecycleActor,
  employeeId: string,
  expectedStatus: PersonStatus,
  expectedAccessVersion: number,
): Promise<PersonDto> {
  return runPersonLifecycleTx(async (tx) => {
    const employee = await lockAndReloadEmployee(tx, employeeId, {
      lockAllActiveOwners: false,
    });
    guardActor(
      actor,
      employee,
      "Cannot restore your own account from Team",
    );

    const current = derivePersonStatus(employee);
    assertAccessVersion(
      employee,
      expectedAccessVersion,
      current,
      expectedStatus,
    );

    if (current !== "archived") {
      // Idempotent when already restored to a non-archived status matching expected.
      if (expectedStatus === current) {
        return mapPersonDto(employee);
      }
      assertExpectedStatus(current, expectedStatus, employee.accessVersion);
    } else {
      assertExpectedStatus(current, expectedStatus, employee.accessVersion);
    }

    if (employee.user) {
      if (
        !canChangeUserRole(actor.role, employee.user.role, employee.user.role)
      ) {
        // Abort with an error so callers can react.
        throw new AppError(
          403,
          "forbidden",
          "Cannot manage access for owner/admin accounts",
        );
      }
    }

    const restored = await tx.employee.updateMany({
      where: {
        id: employee.id,
        archivedAt: { not: null },
        accessVersion: expectedAccessVersion,
      },
      data: {
        archivedAt: null,
        accessVersion: { increment: 1 },
      },
    });
    if (restored.count === 0 && current === "archived") {
      const fresh = await loadEmployeeOrThrow(employeeId, tx);
      throwStaleState(
        derivePersonStatus(fresh),
        expectedStatus,
        fresh.accessVersion,
      );
    }

    // Ensure user stays inactive after restore (access requires explicit unblock).
    if (employee.user?.isActive) {
      await tx.user.update({
        where: { id: employee.user.id },
        data: { isActive: false },
      });
    }

    return auditAndReloadPerson(tx, employeeId, {
      actorEmployeeId: actor.employeeId,
      action: "people.restore",
      entityType: "employee",
      entityId: employee.id,
      before: {
        status: "archived",
        archivedAt: employee.archivedAt?.toISOString() ?? null,
      },
      after: {
        status: employee.user ? "blocked" : "not_activated",
        archivedAt: null,
      },
      summary: `Restored ${employee.fullName} to the team roster`,
    });
  });
}
