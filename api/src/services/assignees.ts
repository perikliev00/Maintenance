import { Role } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";

export const CLEANING_ASSIGNEE_ROLES: readonly Role[] = [Role.housekeeper];

export const MAINTENANCE_ASSIGNEE_ROLES: readonly Role[] = [
  Role.technician,
  Role.supervisor,
  Role.manager,
];

export const CLEANING_ASSIGNEE_MESSAGE =
  "Assignee must be an active housekeeper";

export const MAINTENANCE_ASSIGNEE_MESSAGE =
  "Assignee must be an active technician, supervisor, or manager";

export type AssigneeEmployee = {
  user: { role: Role; isActive: boolean } | null;
} | null;

export function employeeIsEligibleAssignee(
  employee: AssigneeEmployee,
  allowedRoles: readonly Role[],
): boolean {
  return (
    employee != null &&
    employee.user != null &&
    employee.user.isActive &&
    allowedRoles.includes(employee.user.role)
  );
}

export function assertEmployeeIsEligibleAssignee(
  employee: AssigneeEmployee,
  allowedRoles: readonly Role[],
  message: string,
): void {
  if (!employeeIsEligibleAssignee(employee, allowedRoles)) {
    throw new AppError(400, "validation", message);
  }
}

export async function assertActiveAssignee(
  employeeId: string,
  allowedRoles: readonly Role[],
  message: string,
): Promise<void> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: true },
  });
  assertEmployeeIsEligibleAssignee(employee, allowedRoles, message);
}

export async function assertActiveCleaningAssignee(
  employeeId: string,
): Promise<void> {
  await assertActiveAssignee(
    employeeId,
    CLEANING_ASSIGNEE_ROLES,
    CLEANING_ASSIGNEE_MESSAGE,
  );
}

export async function assertActiveMaintenanceAssignee(
  employeeId: string,
): Promise<void> {
  await assertActiveAssignee(
    employeeId,
    MAINTENANCE_ASSIGNEE_ROLES,
    MAINTENANCE_ASSIGNEE_MESSAGE,
  );
}

export async function listActiveHousekeepers() {
  return prisma.employee.findMany({
    where: {
      user: { role: { in: [...CLEANING_ASSIGNEE_ROLES] }, isActive: true },
    },
    select: { id: true, fullName: true, employeeNumber: true },
    orderBy: { fullName: "asc" },
  });
}
