/**
 * Role-gated assignee validation for cleaning and maintenance work assignment.
 * Only active users whose role is in the domain allow-list may be assigned.
 */
import { Prisma, Role } from "@prisma/client";
// Shared Prisma client singleton.
import { prisma } from "../db";
// Runtime import from ../errors.
import { AppError } from "../errors";

/** Prisma client or interactive transaction client for assignee lookups. */
type AssigneeDb = Prisma.TransactionClient | typeof prisma;

/** Roles eligible to be assigned cleaning tasks. */
export const CLEANING_ASSIGNEE_ROLES: readonly Role[] = [Role.housekeeper];

/** Roles eligible to be assigned maintenance tickets. */
export const MAINTENANCE_ASSIGNEE_ROLES: readonly Role[] = [
  // Support the surrounding control flow.
  Role.technician,
  // Support the surrounding control flow.
  Role.supervisor,
  // Support the surrounding control flow.
  Role.manager,
];

// Exported constant CLEANING_ASSIGNEE_MESSAGE.
export const CLEANING_ASSIGNEE_MESSAGE =
  // Support the surrounding control flow.
  "Assignee must be an active housekeeper";

// Exported constant MAINTENANCE_ASSIGNEE_MESSAGE.
export const MAINTENANCE_ASSIGNEE_MESSAGE =
  // Support the surrounding control flow.
  "Assignee must be an active technician, supervisor, or manager";

/** Employee row shape used for eligibility checks (user may be missing). */
export type AssigneeEmployee = {
  // Time field archivedAt.
  archivedAt?: Date | null;
  // Field user on this type/payload.
  user: { role: Role; isActive: boolean } | null;
// Support the surrounding control flow.
} | null;

/**
 * True when the employee has an active, non-archived user account in `allowedRoles`.
 * Missing employee/user or inactive/archived accounts always return false.
 */
export function employeeIsEligibleAssignee(
  // Param employee required by this function.
  employee: AssigneeEmployee,
  // Param allowedRoles required by this function.
  allowedRoles: readonly Role[],
): boolean {
  // Must have a linked active user whose role is in the domain allow-list.
  return (
    // Additional clause in this boolean decision.
    employee != null &&
    // Additional clause in this boolean decision.
    !employee.archivedAt &&
    // Additional clause in this boolean decision.
    employee.user != null &&
    // Additional clause in this boolean decision.
    employee.user.isActive &&
    // Support the surrounding control flow.
    allowedRoles.includes(employee.user.role)
  );
}

/** Throw validation if the employee is not an eligible assignee. */
export function assertEmployeeIsEligibleAssignee(
  // Param employee required by this function.
  employee: AssigneeEmployee,
  // Param allowedRoles required by this function.
  allowedRoles: readonly Role[],
  // Param message required by this function.
  message: string,
): void {
  // Shared 400 validation path for cleaning and maintenance assigners.
  if (!employeeIsEligibleAssignee(employee, allowedRoles)) {
    // Throw typed AppError for HTTP mapping.
    throw new AppError(400, "validation", message);
  }
}

/**
 * Load employee + user and assert eligibility for the given roles.
 * Missing employees surface as validation (not 404) to avoid id enumeration.
 * Pass `db` as a transaction client to re-check after row locks (TOCTOU).
 */
export async function assertActiveAssignee(
  // Param employeeId required by this function.
  employeeId: string,
  // Param allowedRoles required by this function.
  allowedRoles: readonly Role[],
  // Param message required by this function.
  message: string,
  // Param db required by this function.
  db: AssigneeDb = prisma,
): Promise<void> {
  // Transactional checks retain a shared User lock until commit. PostgreSQL
  // UPDATEs of role/isActive take a conflicting NO KEY UPDATE lock, so the
  // eligibility read cannot become stale before the assignment is committed.
  // Shared locks let independent assignments to the same employee proceed
  // without lock upgrades. Account mutation paths take User update locks
  // without subsequently acquiring assignment task/location/ticket locks.
  if (db !== prisma) {
    // Await side effect before continuing.
    await db.$queryRaw`
      // Support the surrounding control flow.
      SELECT id FROM "User" WHERE "employeeId" = ${employeeId} FOR SHARE
    // Support the surrounding control flow.
    `;
  }
  // Missing employee → same validation error as wrong role (no 404 leak).
  const employee = await db.employee.findUnique({
    // Filter matching rows.
    where: { id: employeeId },
    // Include relations for labels/checks.
    include: { user: true },
  });
  // Shared 400 path for cleaning and maintenance assigners.
  assertEmployeeIsEligibleAssignee(employee, allowedRoles, message);
}

/** Assert the employee can be assigned cleaning work. */
export async function assertActiveCleaningAssignee(
  // Param employeeId required by this function.
  employeeId: string,
  // Param db required by this function.
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
  // Param employeeId required by this function.
  employeeId: string,
  // Param db required by this function.
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
  // Param employeeId required by this function.
  employeeId: string,
  // Param tx required by this function.
  tx: Prisma.TransactionClient,
): Promise<void> {
  // Await side effect before continuing.
  await assertActiveAssignee(
    employeeId,
    // Support the surrounding control flow.
    Object.values(Role),
    "Employee must have an active user account",
    tx,
  );
}

/** Active housekeepers for assignee pickers (id / name / number only). */
export async function listActiveHousekeepers() {
  // Picker list — only active, non-archived users in CLEANING_ASSIGNEE_ROLES.
  return prisma.employee.findMany({
    // Filter matching rows.
    where: {
      // Param archivedAt required by this function.
      archivedAt: null,
      // Param user required by this function.
      user: { role: { in: [...CLEANING_ASSIGNEE_ROLES] }, isActive: true },
    },
    // Select only needed columns.
    select: { id: true, fullName: true, employeeNumber: true },
    // Stable sort for paging.
    orderBy: { fullName: "asc" },
  });
}
