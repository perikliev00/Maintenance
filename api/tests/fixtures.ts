import bcrypt from "bcryptjs";
import { PrismaClient, Role } from "@prisma/client";

export const UNRELATED_CONTROL_EMAIL = "t03-unrelated-control@test.local";
export const UNRELATED_CONTROL_EMPLOYEE_NUMBER = "T03-CTRL";

export type EmployeeUserFixture = {
  employeeId: string;
  userId: string;
  email: string;
  employeeNumber: string;
  role: Role;
};

export async function createEmployeeWithUser(
  prisma: PrismaClient,
  input: {
    employeeNumber: string;
    email: string;
    role: Role;
    fullName: string;
    password?: string;
  },
): Promise<EmployeeUserFixture> {
  const employee = await prisma.employee.create({
    data: {
      employeeNumber: input.employeeNumber,
      fullName: input.fullName,
    },
  });
  const passwordHash = await bcrypt.hash(input.password ?? "test-password-t03", 10);
  const user = await prisma.user.create({
    data: {
      employeeId: employee.id,
      email: input.email,
      passwordHash,
      role: input.role,
      isActive: true,
      activatedAt: new Date(),
    },
  });
  return {
    employeeId: employee.id,
    userId: user.id,
    email: input.email,
    employeeNumber: input.employeeNumber,
    role: input.role,
  };
}

/** Create-if-absent unrelated control employee+user. Never pass its id to cleanup. */
export async function ensureUnrelatedControlFixture(
  prisma: PrismaClient,
): Promise<EmployeeUserFixture> {
  const existing = await prisma.user.findUnique({
    where: { email: UNRELATED_CONTROL_EMAIL },
  });
  if (existing) {
    return {
      employeeId: existing.employeeId,
      userId: existing.id,
      email: existing.email,
      employeeNumber: UNRELATED_CONTROL_EMPLOYEE_NUMBER,
      role: existing.role,
    };
  }
  try {
    return await createEmployeeWithUser(prisma, {
      employeeNumber: UNRELATED_CONTROL_EMPLOYEE_NUMBER,
      email: UNRELATED_CONTROL_EMAIL,
      role: Role.reception,
      fullName: "T03 Unrelated Control",
    });
  } catch (err) {
    // Parallel test files may race on first create.
    const raced = await prisma.user.findUnique({
      where: { email: UNRELATED_CONTROL_EMAIL },
    });
    if (raced) {
      return {
        employeeId: raced.employeeId,
        userId: raced.id,
        email: raced.email,
        employeeNumber: UNRELATED_CONTROL_EMPLOYEE_NUMBER,
        role: raced.role,
      };
    }
    throw err;
  }
}

/**
 * Delete only the given employees' graph in FK-safe order.
 * NotificationDelivery cascades from Notification.
 */
export async function cleanupEmployeeGraph(
  prisma: PrismaClient,
  employeeIds: string[],
): Promise<void> {
  if (!employeeIds.length) return;
  const ids = [...new Set(employeeIds)];

  await prisma.notification.deleteMany({
    where: {
      OR: [
        { recipientEmployeeId: { in: ids } },
        { actorEmployeeId: { in: ids } },
      ],
    },
  });

  await prisma.attendanceAdjustment.deleteMany({
    where: {
      OR: [
        { interval: { employeeId: { in: ids } } },
        { requestedById: { in: ids } },
        { reviewedById: { in: ids } },
      ],
    },
  });
  await prisma.attendanceInterval.deleteMany({
    where: { employeeId: { in: ids } },
  });
  await prisma.attendanceEvent.deleteMany({
    where: { employeeId: { in: ids } },
  });

  await prisma.accessGrant.deleteMany({
    where: { issuedByEmployeeId: { in: ids } },
  });
  await prisma.accessCard.deleteMany({
    where: {
      OR: [
        { employeeId: { in: ids } },
        { issuedByEmployeeId: { in: ids } },
      ],
    },
  });

  await prisma.user.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.employee.deleteMany({ where: { id: { in: ids } } });
}
