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

  await prisma.authSession.deleteMany({
    where: { user: { employeeId: { in: ids } } },
  });
  await prisma.device.deleteMany({
    where: {
      OR: [
        { employeeId: { in: ids } },
        { user: { employeeId: { in: ids } } },
      ],
    },
  });

  await prisma.user.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.employee.deleteMany({ where: { id: { in: ids } } });
}

export const SCOPE_SMOKE_PASSWORD = "demo1234";

export type ScopeSmokeFixture = {
  password: string;
  propertyId: string;
  buildingId: string;
  floorId: string;
  sectorAId: string;
  sectorBId: string;
  locAId: string;
  locBId: string;
  taskAId: string;
  taskBId: string;
  taskOtherHkId: string;
  ticketAId: string;
  ticketBId: string;
  auditOwnId: string;
  auditForeignId: string;
  hotelDate: Date;
  supervisorA: EmployeeUserFixture;
  supervisorB: EmployeeUserFixture;
  supervisorEmpty: EmployeeUserFixture;
  housekeeper: EmployeeUserFixture;
  otherHk: EmployeeUserFixture;
  manager: EmployeeUserFixture;
};

/** Two-sector scope world for smoke-data-scope. Cleanup with cleanupScopeSmokeFixture. */
export async function createScopeSmokeFixture(
  prisma: PrismaClient,
): Promise<ScopeSmokeFixture> {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const password = SCOPE_SMOKE_PASSWORD;
  const hotelDate = new Date("2099-06-15T00:00:00.000Z");

  const supervisorA = await createEmployeeWithUser(prisma, {
    employeeNumber: `T04-SA-${stamp}`,
    email: `t04-sup-a-${stamp}@test.local`,
    role: Role.supervisor,
    fullName: "T04 Supervisor A",
    password,
  });
  const supervisorB = await createEmployeeWithUser(prisma, {
    employeeNumber: `T04-SB-${stamp}`,
    email: `t04-sup-b-${stamp}@test.local`,
    role: Role.supervisor,
    fullName: "T04 Supervisor B",
    password,
  });
  const supervisorEmpty = await createEmployeeWithUser(prisma, {
    employeeNumber: `T04-SE-${stamp}`,
    email: `t04-sup-empty-${stamp}@test.local`,
    role: Role.supervisor,
    fullName: "T04 Supervisor Empty",
    password,
  });
  const housekeeper = await createEmployeeWithUser(prisma, {
    employeeNumber: `T04-HK-${stamp}`,
    email: `t04-hk-${stamp}@test.local`,
    role: Role.housekeeper,
    fullName: "T04 Housekeeper",
    password,
  });
  const otherHk = await createEmployeeWithUser(prisma, {
    employeeNumber: `T04-HK2-${stamp}`,
    email: `t04-hk2-${stamp}@test.local`,
    role: Role.housekeeper,
    fullName: "T04 Other Housekeeper",
    password,
  });
  const manager = await createEmployeeWithUser(prisma, {
    employeeNumber: `T04-MGR-${stamp}`,
    email: `t04-mgr-${stamp}@test.local`,
    role: Role.manager,
    fullName: "T04 Manager",
    password,
  });

  const property = await prisma.property.create({
    data: { name: `T04 Property ${stamp}` },
  });
  const building = await prisma.building.create({
    data: {
      propertyId: property.id,
      name: "T04 Building",
      code: `T04B-${stamp}`.slice(0, 32),
    },
  });
  const floor = await prisma.floor.create({
    data: {
      buildingId: building.id,
      number: 99,
      name: "T04 Floor",
    },
  });

  const sectorA = await prisma.sector.create({
    data: {
      propertyId: property.id,
      code: `T04A-${stamp}`.slice(0, 32),
      nameBg: "T04 Sector A",
      nameEn: "T04 Sector A",
      primarySupervisorEmployeeId: supervisorA.employeeId,
      isActive: true,
    },
  });
  const sectorB = await prisma.sector.create({
    data: {
      propertyId: property.id,
      code: `T04B-${stamp}`.slice(0, 32),
      nameBg: "T04 Sector B",
      nameEn: "T04 Sector B",
      primarySupervisorEmployeeId: supervisorB.employeeId,
      isActive: true,
    },
  });

  const locA = await prisma.location.create({
    data: {
      floorId: floor.id,
      number: `T04A-${stamp}`.slice(0, 24),
      kind: "room",
    },
  });
  const locB = await prisma.location.create({
    data: {
      floorId: floor.id,
      number: `T04B-${stamp}`.slice(0, 24),
      kind: "room",
    },
  });

  await prisma.sectorLocation.create({
    data: { sectorId: sectorA.id, locationId: locA.id },
  });
  await prisma.sectorLocation.create({
    data: { sectorId: sectorB.id, locationId: locB.id },
  });

  const taskA = await prisma.cleaningTask.create({
    data: {
      locationId: locA.id,
      sectorId: sectorA.id,
      sectorSupervisorEmployeeId: supervisorA.employeeId,
      hotelDate,
      status: "assigned",
      assignedEmployeeId: housekeeper.employeeId,
      cleaningCycle: locA.cleaningCycle,
    },
  });
  const taskB = await prisma.cleaningTask.create({
    data: {
      locationId: locB.id,
      sectorId: sectorB.id,
      sectorSupervisorEmployeeId: supervisorB.employeeId,
      hotelDate,
      status: "assigned",
      assignedEmployeeId: otherHk.employeeId,
      cleaningCycle: locB.cleaningCycle,
    },
  });
  const taskOtherHk = await prisma.cleaningTask.create({
    data: {
      locationId: locA.id,
      sectorId: sectorA.id,
      sectorSupervisorEmployeeId: supervisorA.employeeId,
      hotelDate: new Date("2099-06-16T00:00:00.000Z"),
      status: "assigned",
      assignedEmployeeId: otherHk.employeeId,
      cleaningCycle: locA.cleaningCycle,
    },
  });

  const ticketA = await prisma.maintenanceTicket.create({
    data: {
      locationId: locA.id,
      title: `T04 ticket A ${stamp}`,
      categoryKey: "other",
      categoryLabelBg: "Друго",
      categoryLabelEn: "Other",
      reportedByEmployeeId: supervisorA.employeeId,
      status: "new",
    },
  });
  const ticketB = await prisma.maintenanceTicket.create({
    data: {
      locationId: locB.id,
      title: `T04 ticket B ${stamp}`,
      categoryKey: "other",
      categoryLabelBg: "Друго",
      categoryLabelEn: "Other",
      reportedByEmployeeId: supervisorB.employeeId,
      status: "new",
    },
  });

  const auditOwn = await prisma.auditEvent.create({
    data: {
      actorEmployeeId: supervisorA.employeeId,
      action: "t04.scope.own",
      entityType: "Location",
      entityId: locA.id,
      locationId: locA.id,
      summary: "own scope audit",
    },
  });
  const auditForeign = await prisma.auditEvent.create({
    data: {
      actorEmployeeId: supervisorB.employeeId,
      action: "t04.scope.foreign",
      entityType: "Location",
      entityId: locB.id,
      locationId: locB.id,
      summary: "foreign scope audit",
    },
  });

  return {
    password,
    propertyId: property.id,
    buildingId: building.id,
    floorId: floor.id,
    sectorAId: sectorA.id,
    sectorBId: sectorB.id,
    locAId: locA.id,
    locBId: locB.id,
    taskAId: taskA.id,
    taskBId: taskB.id,
    taskOtherHkId: taskOtherHk.id,
    ticketAId: ticketA.id,
    ticketBId: ticketB.id,
    auditOwnId: auditOwn.id,
    auditForeignId: auditForeign.id,
    hotelDate,
    supervisorA,
    supervisorB,
    supervisorEmpty,
    housekeeper,
    otherHk,
    manager,
  };
}

export async function cleanupScopeSmokeFixture(
  prisma: PrismaClient,
  fx: ScopeSmokeFixture,
): Promise<void> {
  const employeeIds = [
    fx.supervisorA.employeeId,
    fx.supervisorB.employeeId,
    fx.supervisorEmpty.employeeId,
    fx.housekeeper.employeeId,
    fx.otherHk.employeeId,
    fx.manager.employeeId,
  ];

  await prisma.auditEvent.deleteMany({
    where: { id: { in: [fx.auditOwnId, fx.auditForeignId] } },
  });
  await prisma.maintenanceTicket.deleteMany({
    where: { id: { in: [fx.ticketAId, fx.ticketBId] } },
  });
  await prisma.cleaningSession.deleteMany({
    where: {
      taskId: { in: [fx.taskAId, fx.taskBId, fx.taskOtherHkId] },
    },
  });
  await prisma.cleaningTask.deleteMany({
    where: { id: { in: [fx.taskAId, fx.taskBId, fx.taskOtherHkId] } },
  });
  await prisma.sectorLocation.deleteMany({
    where: { locationId: { in: [fx.locAId, fx.locBId] } },
  });
  await prisma.sector.updateMany({
    where: { id: { in: [fx.sectorAId, fx.sectorBId] } },
    data: { primarySupervisorEmployeeId: null },
  });
  await prisma.sector.deleteMany({
    where: { id: { in: [fx.sectorAId, fx.sectorBId] } },
  });
  await prisma.location.deleteMany({
    where: { id: { in: [fx.locAId, fx.locBId] } },
  });
  await prisma.floor.deleteMany({ where: { id: fx.floorId } });
  await prisma.building.deleteMany({ where: { id: fx.buildingId } });
  await prisma.property.deleteMany({ where: { id: fx.propertyId } });

  await cleanupEmployeeGraph(prisma, employeeIds);
}
