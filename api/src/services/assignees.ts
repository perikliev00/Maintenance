/**
 * Role-gated assignee validation for cleaning and maintenance work assignment.
 * Only active users whose role is in the domain allow-list may be assigned.
 */
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";

/** Prisma client or interactive transaction client for assignee lookups. */
type AssigneeDb = Prisma.TransactionClient | typeof prisma;

/** Roles eligible to be assigned cleaning tasks. */
export const CLEANING_ASSIGNEE_ROLES: readonly Role[] = [Role.housekeeper];

/** Roles eligible to be assigned maintenance tickets. */
export const MAINTENANCE_ASSIGNEE_ROLES: readonly Role[] = [
  Role.technician,
  Role.supervisor,
  Role.manager,
];

export const CLEANING_ASSIGNEE_MESSAGE =
  "Assignee must be an active housekeeper";

export const MAINTENANCE_ASSIGNEE_MESSAGE =
  "Assignee must be an active technician, supervisor, or manager";

/** Employee row shape used for eligibility checks (user may be missing). */
export type AssigneeEmployee = {
  archivedAt?: Date | null;
  user: { role: Role; isActive: boolean } | null;
} | null;

/**
 * True when the employee has an active, non-archived user account in `allowedRoles`.
 * Missing employee/user or inactive/archived accounts always return false.
 */
export function employeeIsEligibleAssignee(
  employee: AssigneeEmployee,
  allowedRoles: readonly Role[],
): boolean {
  // Must have a linked active user whose role is in the domain allow-list.
  return (
    employee != null &&
    !employee.archivedAt &&
    employee.user != null &&
    employee.user.isActive &&
    allowedRoles.includes(employee.user.role)
  );
}

/** Throw validation if the employee is not an eligible assignee. */
export function assertEmployeeIsEligibleAssignee(
  employee: AssigneeEmployee,
  allowedRoles: readonly Role[],
  message: string,
): void {
  // Shared 400 validation path for cleaning and maintenance assigners.
  if (!employeeIsEligibleAssignee(employee, allowedRoles)) {
    throw new AppError(400, "validation", message);
  }
}

/**
 * Load employee + user and assert eligibility for the given roles.
 * Missing employees surface as validation (not 404) to avoid id enumeration.
 * Pass `db` as a transaction client to re-check after row locks (TOCTOU).
 */
export async function assertActiveAssignee(
  employeeId: string,
  allowedRoles: readonly Role[],
  message: string,
  db: AssigneeDb = prisma,
): Promise<void> {
  // Transactional checks retain a shared User lock until commit. PostgreSQL
  // UPDATEs of role/isActive take a conflicting NO KEY UPDATE lock, so the
  // eligibility read cannot become stale before the assignment is committed.
  // Shared locks let independent assignments to the same employee proceed
  // without lock upgrades. Account mutation paths take User update locks
  // without subsequently acquiring assignment task/location/ticket locks.
  if (db !== prisma) {
    await db.$queryRaw`
      SELECT id FROM "User" WHERE "employeeId" = ${employeeId} FOR SHARE
    `;
  }
  // Missing employee → same validation error as wrong role (no 404 leak).
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: { user: true },
  });
  // Shared 400 path for cleaning and maintenance assigners.
  assertEmployeeIsEligibleAssignee(employee, allowedRoles, message);
}

/** Assert the employee can be assigned cleaning work. */
export async function assertActiveCleaningAssignee(
  employeeId: string,
  db: AssigneeDb = prisma,
): Promise<void> {
  // Thin wrapper: housekeeper-only allow-list + shared message.
  await assertActiveAssignee(
    employeeId,
    CLEANING_ASSIGNEE_ROLES,
    CLEANING_ASSIGNEE_MESSAGE,
    db,
  );
}

/** Assert the employee can be assigned maintenance work. */
export async function assertActiveMaintenanceAssignee(
  employeeId: string,
  db: AssigneeDb = prisma,
): Promise<void> {
  // Thin wrapper: technician/supervisor/manager allow-list + shared message.
  await assertActiveAssignee(
    employeeId,
    MAINTENANCE_ASSIGNEE_ROLES,
    MAINTENANCE_ASSIGNEE_MESSAGE,
    db,
  );
}

/** Keep a starter active through its transaction without changing role policy. */
export async function assertActiveWorkStarter(
  employeeId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await assertActiveAssignee(
    employeeId,
    Object.values(Role),
    "Employee must have an active user account",
    tx,
  );
}

/** Active housekeepers for assignee pickers (id / name / number only). */
export async function listActiveHousekeepers() {
  // Picker list — only active, non-archived users in CLEANING_ASSIGNEE_ROLES.
  return prisma.employee.findMany({
    where: {
      archivedAt: null,
      user: { role: { in: [...CLEANING_ASSIGNEE_ROLES] }, isActive: true },
    },
    select: { id: true, fullName: true, employeeNumber: true },
    orderBy: { fullName: "asc" },
  });
}
