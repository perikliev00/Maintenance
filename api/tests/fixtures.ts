// Import bindings from bcryptjs.
import bcrypt from "bcryptjs";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  DailyPlanCategory,
  // Execute the next setup or assertion step for this scenario.
  DailyPlanImportStatus,
  // Execute the next setup or assertion step for this scenario.
  DailyPlanSource,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  Role,
  // Session/CSRF step exercising auth lifecycle.
  SessionStatus,
  // Execute the next setup or assertion step for this scenario.
  TaskStatus,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";

// Export UNRELATED_CONTROL_EMAIL for shared test/setup consumers.
export const UNRELATED_CONTROL_EMAIL = "t03-unrelated-control@test.local";
// Export UNRELATED_CONTROL_EMPLOYEE_NUMBER for shared test/setup consumers.
export const UNRELATED_CONTROL_EMPLOYEE_NUMBER = "T03-CTRL";

// Export EmployeeUserFixture for shared test/setup consumers.
export type EmployeeUserFixture = {
  // Execute the next setup or assertion step for this scenario.
  employeeId: string;
  // Execute the next setup or assertion step for this scenario.
  userId: string;
  // Fixture field email for the seeded actor/entity.
  email: string;
  // Fixture field employeeNumber for the seeded actor/entity.
  employeeNumber: string;
  // Fixture field role for the seeded actor/entity.
  role: Role;
};

// Export helper createEmployeeWithUser for reuse across related tests.
export async function createEmployeeWithUser(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  input: {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: string;
    // Fixture field email for the seeded actor/entity.
    email: string;
    // Fixture field role for the seeded actor/entity.
    role: Role;
    // Fixture field fullName for the seeded actor/entity.
    fullName: string;
    // Execute the next setup or assertion step for this scenario.
    password?: string;
  },
// Execute the next setup or assertion step for this scenario.
): Promise<EmployeeUserFixture> {
  // employee: seeded entity required before the mutation under test.
  const employee = await prisma.employee.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: input.employeeNumber,
      // Fixture field fullName for the seeded actor/entity.
      fullName: input.fullName,
    },
  });
  // passwordHash: credential/token material for auth flows.
  const passwordHash = await bcrypt.hash(input.password ?? "test-password-t03", 10);
  // user: seeded entity required before the mutation under test.
  const user = await prisma.user.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      employeeId: employee.id,
      // Fixture field email for the seeded actor/entity.
      email: input.email,
      // Execute the next setup or assertion step for this scenario.
      passwordHash,
      // Fixture field role for the seeded actor/entity.
      role: input.role,
      // Execute the next setup or assertion step for this scenario.
      isActive: true,
      // Execute the next setup or assertion step for this scenario.
      activatedAt: new Date(),
    },
  });
  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    employeeId: employee.id,
    // Execute the next setup or assertion step for this scenario.
    userId: user.id,
    // Fixture field email for the seeded actor/entity.
    email: input.email,
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: input.employeeNumber,
    // Fixture field role for the seeded actor/entity.
    role: input.role,
  };
}

/** Create-if-absent unrelated control employee+user. Never pass its id to cleanup. */
export async function ensureUnrelatedControlFixture(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
// Execute the next setup or assertion step for this scenario.
): Promise<EmployeeUserFixture> {
  // existing: synchronize actors so the race window is observable.
  const existing = await prisma.user.findUnique({
    // SQL fragment used to observe locks or assert DB state.
    where: { email: UNRELATED_CONTROL_EMAIL },
  });
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (existing) {
    // Return the arranged value/result to the caller.
    return {
      // Execute the next setup or assertion step for this scenario.
      employeeId: existing.employeeId,
      // Execute the next setup or assertion step for this scenario.
      userId: existing.id,
      // Fixture field email for the seeded actor/entity.
      email: existing.email,
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: UNRELATED_CONTROL_EMPLOYEE_NUMBER,
      // Fixture field role for the seeded actor/entity.
      role: existing.role,
    };
  }
  // Try path where partial failure must not leak suite state.
  try {
    // Return the arranged value/result to the caller.
    return await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: UNRELATED_CONTROL_EMPLOYEE_NUMBER,
      // Fixture field email for the seeded actor/entity.
      email: UNRELATED_CONTROL_EMAIL,
      // Fixture field role for the seeded actor/entity.
      role: Role.reception,
      // Fixture field fullName for the seeded actor/entity.
      fullName: "T03 Unrelated Control",
    });
  // Execute the next setup or assertion step for this scenario.
  } catch (err) {
    // Parallel test files may race on first create.
    const raced = await prisma.user.findUnique({
      // SQL fragment used to observe locks or assert DB state.
      where: { email: UNRELATED_CONTROL_EMAIL },
    });
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (raced) {
      // Return the arranged value/result to the caller.
      return {
        // Concurrency/isolation step for the race under test.
        employeeId: raced.employeeId,
        // Concurrency/isolation step for the race under test.
        userId: raced.id,
        // Fixture field email for the seeded actor/entity.
        email: raced.email,
        // Fixture field employeeNumber for the seeded actor/entity.
        employeeNumber: UNRELATED_CONTROL_EMPLOYEE_NUMBER,
        // Fixture field role for the seeded actor/entity.
        role: raced.role,
      };
    }
    // Surface a hard failure when isolation or contract is violated.
    throw err;
  }
}

/**
 * Delete only the given employees' graph in FK-safe order.
 * NotificationDelivery cascades from Notification.
 */
export async function cleanupEmployeeGraph(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  employeeIds: string[],
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!employeeIds.length) return;
  // Bind ids for later setup or assertions in this scope.
  const ids = [...new Set(employeeIds)];

  // Await async work before asserting or releasing locks.
  await prisma.notification.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // SQL fragment used to observe locks or assert DB state.
      OR: [
        // Execute the next setup or assertion step for this scenario.
        { recipientEmployeeId: { in: ids } },
        // Execute the next setup or assertion step for this scenario.
        { actorEmployeeId: { in: ids } },
      ],
    },
  });

  // Await async work before asserting or releasing locks.
  await prisma.attendanceAdjustment.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // SQL fragment used to observe locks or assert DB state.
      OR: [
        // Execute the next setup or assertion step for this scenario.
        { interval: { employeeId: { in: ids } } },
        // Execute the next setup or assertion step for this scenario.
        { requestedById: { in: ids } },
        // Execute the next setup or assertion step for this scenario.
        { reviewedById: { in: ids } },
      ],
    },
  });
  // Await async work before asserting or releasing locks.
  await prisma.attendanceInterval.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { employeeId: { in: ids } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.attendanceEvent.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { employeeId: { in: ids } },
  });

  // Await async work before asserting or releasing locks.
  await prisma.accessGrant.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { issuedByEmployeeId: { in: ids } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.accessCard.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // SQL fragment used to observe locks or assert DB state.
      OR: [
        // Execute the next setup or assertion step for this scenario.
        { employeeId: { in: ids } },
        // Execute the next setup or assertion step for this scenario.
        { issuedByEmployeeId: { in: ids } },
      ],
    },
  });

  // Await async work before asserting or releasing locks.
  await prisma.authSession.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { user: { employeeId: { in: ids } } },
  });
  // Clear invite → device links before deleting devices / users.
  await prisma.invitation.updateMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // SQL fragment used to observe locks or assert DB state.
      OR: [
        // Execute the next setup or assertion step for this scenario.
        { employeeId: { in: ids } },
        // Execute the next setup or assertion step for this scenario.
        { createdBy: { employeeId: { in: ids } } },
      ],
    },
    // Execute the next setup or assertion step for this scenario.
    data: { consumedDeviceId: null },
  });
  // Await async work before asserting or releasing locks.
  await prisma.device.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // SQL fragment used to observe locks or assert DB state.
      OR: [
        // Execute the next setup or assertion step for this scenario.
        { employeeId: { in: ids } },
        // Execute the next setup or assertion step for this scenario.
        { user: { employeeId: { in: ids } } },
      ],
    },
  });
  // Await async work before asserting or releasing locks.
  await prisma.invitation.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // SQL fragment used to observe locks or assert DB state.
      OR: [
        // Execute the next setup or assertion step for this scenario.
        { employeeId: { in: ids } },
        // Execute the next setup or assertion step for this scenario.
        { createdBy: { employeeId: { in: ids } } },
      ],
    },
  });

  // Ticket creates may notify ops recipients; clear before employee delete.
  await prisma.notification.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // SQL fragment used to observe locks or assert DB state.
      OR: [
        // Execute the next setup or assertion step for this scenario.
        { recipientEmployeeId: { in: ids } },
        // Execute the next setup or assertion step for this scenario.
        { actorEmployeeId: { in: ids } },
      ],
    },
  });

  // Await async work before asserting or releasing locks.
  await prisma.auditEvent.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // SQL fragment used to observe locks or assert DB state.
      OR: [
        // Execute the next setup or assertion step for this scenario.
        { actorEmployeeId: { in: ids } },
        // Execute the next setup or assertion step for this scenario.
        { entityType: "employee", entityId: { in: ids } },
      ],
    },
  });

  // Await async work before asserting or releasing locks.
  await prisma.cleaningTask.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { assignedEmployeeId: { in: ids } },
  });

  // Await async work before asserting or releasing locks.
  await prisma.user.deleteMany({ where: { employeeId: { in: ids } } });
  // Await async work before asserting or releasing locks.
  await prisma.employee.deleteMany({ where: { id: { in: ids } } });
}

// Export SCOPE_SMOKE_PASSWORD for shared test/setup consumers.
export const SCOPE_SMOKE_PASSWORD = "demo1234";

// Export ScopeSmokeFixture for shared test/setup consumers.
export type ScopeSmokeFixture = {
  // Fixture field password for the seeded actor/entity.
  password: string;
  // Execute the next setup or assertion step for this scenario.
  propertyId: string;
  // Execute the next setup or assertion step for this scenario.
  buildingId: string;
  // Execute the next setup or assertion step for this scenario.
  floorId: string;
  // Execute the next setup or assertion step for this scenario.
  sectorAId: string;
  // Execute the next setup or assertion step for this scenario.
  sectorBId: string;
  // Execute the next setup or assertion step for this scenario.
  locAId: string;
  // Execute the next setup or assertion step for this scenario.
  locBId: string;
  // Execute the next setup or assertion step for this scenario.
  taskAId: string;
  // Execute the next setup or assertion step for this scenario.
  taskBId: string;
  // Execute the next setup or assertion step for this scenario.
  taskOtherHkId: string;
  // Execute the next setup or assertion step for this scenario.
  ticketAId: string;
  // Execute the next setup or assertion step for this scenario.
  ticketBId: string;
  // Execute the next setup or assertion step for this scenario.
  auditOwnId: string;
  // Execute the next setup or assertion step for this scenario.
  auditForeignId: string;
  // Execute the next setup or assertion step for this scenario.
  hotelDate: Date;
  // Execute the next setup or assertion step for this scenario.
  supervisorA: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  supervisorB: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  supervisorEmpty: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  housekeeper: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  otherHk: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  manager: EmployeeUserFixture;
};

/** Two-sector scope world for smoke-data-scope. Cleanup with cleanupScopeSmokeFixture. */
export async function createScopeSmokeFixture(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
// Execute the next setup or assertion step for this scenario.
): Promise<ScopeSmokeFixture> {
  // stamp: unique stamp so parallel runs do not collide.
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // password: credential/token material for auth flows.
  const password = SCOPE_SMOKE_PASSWORD;
  // Bind hotelDate for later setup or assertions in this scope.
  const hotelDate = new Date("2099-06-15T00:00:00.000Z");

  // supervisorA: seeded entity required before the mutation under test.
  const supervisorA = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `T04-SA-${stamp}`,
    // Fixture field email for the seeded actor/entity.
    email: `t04-sup-a-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.supervisor,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "T04 Supervisor A",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // supervisorB: seeded entity required before the mutation under test.
  const supervisorB = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `T04-SB-${stamp}`,
    // Fixture field email for the seeded actor/entity.
    email: `t04-sup-b-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.supervisor,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "T04 Supervisor B",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // supervisorEmpty: seeded entity required before the mutation under test.
  const supervisorEmpty = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `T04-SE-${stamp}`,
    // Fixture field email for the seeded actor/entity.
    email: `t04-sup-empty-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.supervisor,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "T04 Supervisor Empty",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // housekeeper: seeded entity required before the mutation under test.
  const housekeeper = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `T04-HK-${stamp}`,
    // Fixture field email for the seeded actor/entity.
    email: `t04-hk-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.housekeeper,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "T04 Housekeeper",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // otherHk: seeded entity required before the mutation under test.
  const otherHk = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `T04-HK2-${stamp}`,
    // Fixture field email for the seeded actor/entity.
    email: `t04-hk2-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.housekeeper,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "T04 Other Housekeeper",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // manager: seeded entity required before the mutation under test.
  const manager = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `T04-MGR-${stamp}`,
    // Fixture field email for the seeded actor/entity.
    email: `t04-mgr-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.manager,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "T04 Manager",
    // Execute the next setup or assertion step for this scenario.
    password,
  });

  // property: seeded entity required before the mutation under test.
  const property = await prisma.property.create({
    // Execute the next setup or assertion step for this scenario.
    data: { name: `T04 Property ${stamp}` },
  });
  // building: seeded entity required before the mutation under test.
  const building = await prisma.building.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      propertyId: property.id,
      // Fixture field name for the seeded actor/entity.
      name: "T04 Building",
      // Execute the next setup or assertion step for this scenario.
      code: `T04B-${stamp}`.slice(0, 32),
    },
  });
  // floor: seeded entity required before the mutation under test.
  const floor = await prisma.floor.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      buildingId: building.id,
      // Execute the next setup or assertion step for this scenario.
      number: 99,
      // Fixture field name for the seeded actor/entity.
      name: "T04 Floor",
    },
  });

  // sectorA: seeded entity required before the mutation under test.
  const sectorA = await prisma.sector.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      propertyId: property.id,
      // Execute the next setup or assertion step for this scenario.
      code: `T04A-${stamp}`.slice(0, 32),
      // Execute the next setup or assertion step for this scenario.
      nameBg: "T04 Sector A",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "T04 Sector A",
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: supervisorA.employeeId,
      // Execute the next setup or assertion step for this scenario.
      isActive: true,
    },
  });
  // sectorB: seeded entity required before the mutation under test.
  const sectorB = await prisma.sector.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      propertyId: property.id,
      // Execute the next setup or assertion step for this scenario.
      code: `T04B-${stamp}`.slice(0, 32),
      // Execute the next setup or assertion step for this scenario.
      nameBg: "T04 Sector B",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "T04 Sector B",
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      isActive: true,
    },
  });

  // locA: seeded entity required before the mutation under test.
  const locA = await prisma.location.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      floorId: floor.id,
      // Execute the next setup or assertion step for this scenario.
      number: `T04A-${stamp}`.slice(0, 24),
      // Execute the next setup or assertion step for this scenario.
      kind: "room",
    },
  });
  // locB: seeded entity required before the mutation under test.
  const locB = await prisma.location.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      floorId: floor.id,
      // Execute the next setup or assertion step for this scenario.
      number: `T04B-${stamp}`.slice(0, 24),
      // Execute the next setup or assertion step for this scenario.
      kind: "room",
    },
  });

  // Await async work before asserting or releasing locks.
  await prisma.sectorLocation.create({
    // Execute the next setup or assertion step for this scenario.
    data: { sectorId: sectorA.id, locationId: locA.id },
  });
  // Await async work before asserting or releasing locks.
  await prisma.sectorLocation.create({
    // Execute the next setup or assertion step for this scenario.
    data: { sectorId: sectorB.id, locationId: locB.id },
  });

  // taskA: seeded entity required before the mutation under test.
  const taskA = await prisma.cleaningTask.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locA.id,
      // Execute the next setup or assertion step for this scenario.
      sectorId: sectorA.id,
      // Execute the next setup or assertion step for this scenario.
      sectorSupervisorEmployeeId: supervisorA.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate,
      // Fixture field status for the seeded actor/entity.
      status: "assigned",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: locA.cleaningCycle,
    },
  });
  // taskB: seeded entity required before the mutation under test.
  const taskB = await prisma.cleaningTask.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locB.id,
      // Execute the next setup or assertion step for this scenario.
      sectorId: sectorB.id,
      // Execute the next setup or assertion step for this scenario.
      sectorSupervisorEmployeeId: supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate,
      // Fixture field status for the seeded actor/entity.
      status: "assigned",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: otherHk.employeeId,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: locB.cleaningCycle,
    },
  });
  // taskOtherHk: seeded entity required before the mutation under test.
  const taskOtherHk = await prisma.cleaningTask.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locA.id,
      // Execute the next setup or assertion step for this scenario.
      sectorId: sectorA.id,
      // Execute the next setup or assertion step for this scenario.
      sectorSupervisorEmployeeId: supervisorA.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: new Date("2099-06-16T00:00:00.000Z"),
      // Fixture field status for the seeded actor/entity.
      status: "assigned",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: otherHk.employeeId,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: locA.cleaningCycle,
    },
  });

  // ticketA: seeded entity required before the mutation under test.
  const ticketA = await prisma.maintenanceTicket.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locA.id,
      // Execute the next setup or assertion step for this scenario.
      title: `T04 ticket A ${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      categoryKey: "other",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelBg: "Друго",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelEn: "Other",
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: supervisorA.employeeId,
      // Fixture field status for the seeded actor/entity.
      status: "new",
    },
  });
  // ticketB: seeded entity required before the mutation under test.
  const ticketB = await prisma.maintenanceTicket.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locB.id,
      // Execute the next setup or assertion step for this scenario.
      title: `T04 ticket B ${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      categoryKey: "other",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelBg: "Друго",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelEn: "Other",
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: supervisorB.employeeId,
      // Fixture field status for the seeded actor/entity.
      status: "new",
    },
  });

  // auditOwn: seeded entity required before the mutation under test.
  const auditOwn = await prisma.auditEvent.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: supervisorA.employeeId,
      // Execute the next setup or assertion step for this scenario.
      action: "t04.scope.own",
      // Execute the next setup or assertion step for this scenario.
      entityType: "Location",
      // Execute the next setup or assertion step for this scenario.
      entityId: locA.id,
      // Execute the next setup or assertion step for this scenario.
      locationId: locA.id,
      // Execute the next setup or assertion step for this scenario.
      summary: "own scope audit",
    },
  });
  // auditForeign: seeded entity required before the mutation under test.
  const auditForeign = await prisma.auditEvent.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      action: "t04.scope.foreign",
      // Execute the next setup or assertion step for this scenario.
      entityType: "Location",
      // Execute the next setup or assertion step for this scenario.
      entityId: locB.id,
      // Execute the next setup or assertion step for this scenario.
      locationId: locB.id,
      // Execute the next setup or assertion step for this scenario.
      summary: "foreign scope audit",
    },
  });

  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    password,
    // Execute the next setup or assertion step for this scenario.
    propertyId: property.id,
    // Execute the next setup or assertion step for this scenario.
    buildingId: building.id,
    // Execute the next setup or assertion step for this scenario.
    floorId: floor.id,
    // Execute the next setup or assertion step for this scenario.
    sectorAId: sectorA.id,
    // Execute the next setup or assertion step for this scenario.
    sectorBId: sectorB.id,
    // Execute the next setup or assertion step for this scenario.
    locAId: locA.id,
    // Execute the next setup or assertion step for this scenario.
    locBId: locB.id,
    // Execute the next setup or assertion step for this scenario.
    taskAId: taskA.id,
    // Execute the next setup or assertion step for this scenario.
    taskBId: taskB.id,
    // Execute the next setup or assertion step for this scenario.
    taskOtherHkId: taskOtherHk.id,
    // Execute the next setup or assertion step for this scenario.
    ticketAId: ticketA.id,
    // Execute the next setup or assertion step for this scenario.
    ticketBId: ticketB.id,
    // Execute the next setup or assertion step for this scenario.
    auditOwnId: auditOwn.id,
    // Execute the next setup or assertion step for this scenario.
    auditForeignId: auditForeign.id,
    // Execute the next setup or assertion step for this scenario.
    hotelDate,
    // Execute the next setup or assertion step for this scenario.
    supervisorA,
    // Execute the next setup or assertion step for this scenario.
    supervisorB,
    // Execute the next setup or assertion step for this scenario.
    supervisorEmpty,
    // Execute the next setup or assertion step for this scenario.
    housekeeper,
    // Execute the next setup or assertion step for this scenario.
    otherHk,
    // Execute the next setup or assertion step for this scenario.
    manager,
  };
}

// Export AggregateSeedIds for shared test/setup consumers.
export type AggregateSeedIds = {
  // Execute the next setup or assertion step for this scenario.
  entryAId: string;
  // Execute the next setup or assertion step for this scenario.
  entryBId: string;
  // Execute the next setup or assertion step for this scenario.
  importBatchId: string;
  // Session/CSRF step exercising auth lifecycle.
  sessionAId: string;
  // Session/CSRF step exercising auth lifecycle.
  sessionBId: string;
  // Execute the next setup or assertion step for this scenario.
  fromIso: string;
  // Execute the next setup or assertion step for this scenario.
  toIso: string;
  // Execute the next setup or assertion step for this scenario.
  hotelDateYmd: string;
};

/** Plan entries + completed sessions for P1-08 aggregate scope tests. */
export async function seedScopeAggregateExtras(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  fx: ScopeSmokeFixture,
// Execute the next setup or assertion step for this scenario.
): Promise<AggregateSeedIds> {
  // Bind completedAt for later setup or assertions in this scope.
  const completedAt = new Date(fx.hotelDate);
  // Execute the next setup or assertion step for this scenario.
  completedAt.setUTCHours(12, 0, 0, 0);
  // Bind startedAt for later setup or assertions in this scope.
  const startedAt = new Date(completedAt.getTime() - 45 * 60 * 1000);
  // Bind hotelDateYmd for later setup or assertions in this scope.
  const hotelDateYmd = fx.hotelDate.toISOString().slice(0, 10);

  // importBatch: seeded entity required before the mutation under test.
  const importBatch = await prisma.dailyPlanImportBatch.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: fx.hotelDate,
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      sourceLabel: "t04-agg-seed",
      // Fixture field status for the seeded actor/entity.
      status: DailyPlanImportStatus.completed,
      // Execute the next setup or assertion step for this scenario.
      totalCount: 2,
      // Execute the next setup or assertion step for this scenario.
      createdCount: 2,
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: fx.manager.employeeId,
    },
  });

  // entryA: seeded entity required before the mutation under test.
  const entryA = await prisma.dailyPlanEntry.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: fx.hotelDate,
      // Execute the next setup or assertion step for this scenario.
      locationId: fx.locAId,
      // Execute the next setup or assertion step for this scenario.
      category: DailyPlanCategory.departure,
      // Execute the next setup or assertion step for this scenario.
      source: DailyPlanSource.manual,
      // Execute the next setup or assertion step for this scenario.
      importBatchId: importBatch.id,
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: fx.manager.employeeId,
    },
  });
  // entryB: seeded entity required before the mutation under test.
  const entryB = await prisma.dailyPlanEntry.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: fx.hotelDate,
      // Execute the next setup or assertion step for this scenario.
      locationId: fx.locBId,
      // Execute the next setup or assertion step for this scenario.
      category: DailyPlanCategory.departure,
      // Execute the next setup or assertion step for this scenario.
      source: DailyPlanSource.manual,
      // Execute the next setup or assertion step for this scenario.
      importBatchId: importBatch.id,
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: fx.manager.employeeId,
    },
  });

  // Await async work before asserting or releasing locks.
  await prisma.cleaningTask.update({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: fx.taskAId },
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Fixture field status for the seeded actor/entity.
      status: TaskStatus.completed,
      // Execute the next setup or assertion step for this scenario.
      completedAt,
    },
  });
  // Await async work before asserting or releasing locks.
  await prisma.cleaningTask.update({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: fx.taskBId },
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Fixture field status for the seeded actor/entity.
      status: TaskStatus.completed,
      // Execute the next setup or assertion step for this scenario.
      completedAt,
    },
  });

  // sessionA: session cookie jar for authenticated requests.
  const sessionA = await prisma.cleaningSession.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      taskId: fx.taskAId,
      // Execute the next setup or assertion step for this scenario.
      employeeId: fx.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      startedAt,
      // Execute the next setup or assertion step for this scenario.
      finishedAt: completedAt,
      // Fixture field status for the seeded actor/entity.
      status: SessionStatus.completed,
      // Execute the next setup or assertion step for this scenario.
      startCommandId: `t04-agg-start-a-${fx.taskAId}`,
      // Execute the next setup or assertion step for this scenario.
      completeCommandId: `t04-agg-complete-a-${fx.taskAId}`,
    },
  });
  // sessionB: session cookie jar for authenticated requests.
  const sessionB = await prisma.cleaningSession.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      taskId: fx.taskBId,
      // Execute the next setup or assertion step for this scenario.
      employeeId: fx.otherHk.employeeId,
      // Execute the next setup or assertion step for this scenario.
      startedAt,
      // Execute the next setup or assertion step for this scenario.
      finishedAt: completedAt,
      // Fixture field status for the seeded actor/entity.
      status: SessionStatus.completed,
      // Execute the next setup or assertion step for this scenario.
      startCommandId: `t04-agg-start-b-${fx.taskBId}`,
      // Execute the next setup or assertion step for this scenario.
      completeCommandId: `t04-agg-complete-b-${fx.taskBId}`,
    },
  });

  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    entryAId: entryA.id,
    // Execute the next setup or assertion step for this scenario.
    entryBId: entryB.id,
    // Execute the next setup or assertion step for this scenario.
    importBatchId: importBatch.id,
    // Session/CSRF step exercising auth lifecycle.
    sessionAId: sessionA.id,
    // Session/CSRF step exercising auth lifecycle.
    sessionBId: sessionB.id,
    // Execute the next setup or assertion step for this scenario.
    fromIso: hotelDateYmd,
    // Execute the next setup or assertion step for this scenario.
    toIso: hotelDateYmd,
    // Execute the next setup or assertion step for this scenario.
    hotelDateYmd,
  };
}

// Export helper cleanupAggregateSeed for reuse across related tests.
export async function cleanupAggregateSeed(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  seed: AggregateSeedIds,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Await async work before asserting or releasing locks.
  await prisma.cleaningSession.deleteMany({
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    where: { id: { in: [seed.sessionAId, seed.sessionBId] } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.dailyPlanEntry.deleteMany({
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    where: { id: { in: [seed.entryAId, seed.entryBId] } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.dailyPlanImportBatch.deleteMany({
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    where: { id: seed.importBatchId },
  });
}

// Export helper cleanupScopeSmokeFixture for reuse across related tests.
export async function cleanupScopeSmokeFixture(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  fx: ScopeSmokeFixture,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Bind employeeIds for later setup or assertions in this scope.
  const employeeIds = [
    // Execute the next setup or assertion step for this scenario.
    fx.supervisorA.employeeId,
    // Execute the next setup or assertion step for this scenario.
    fx.supervisorB.employeeId,
    // Execute the next setup or assertion step for this scenario.
    fx.supervisorEmpty.employeeId,
    // Execute the next setup or assertion step for this scenario.
    fx.housekeeper.employeeId,
    // Execute the next setup or assertion step for this scenario.
    fx.otherHk.employeeId,
    // Execute the next setup or assertion step for this scenario.
    fx.manager.employeeId,
  ];

  // Await async work before asserting or releasing locks.
  await prisma.auditEvent.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: [fx.auditOwnId, fx.auditForeignId] } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.maintenanceTicket.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: [fx.ticketAId, fx.ticketBId] } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.dailyPlanEntry.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: [fx.locAId, fx.locBId] } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.dailyPlanImportBatch.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { createdByEmployeeId: { in: employeeIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.cleaningSession.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      taskId: { in: [fx.taskAId, fx.taskBId, fx.taskOtherHkId] },
    },
  });
  // Await async work before asserting or releasing locks.
  await prisma.cleaningTask.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: [fx.taskAId, fx.taskBId, fx.taskOtherHkId] } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.sectorLocation.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: [fx.locAId, fx.locBId] } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.sector.updateMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: [fx.sectorAId, fx.sectorBId] } },
    // Execute the next setup or assertion step for this scenario.
    data: { primarySupervisorEmployeeId: null },
  });
  // Await async work before asserting or releasing locks.
  await prisma.sector.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: [fx.sectorAId, fx.sectorBId] } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.location.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: [fx.locAId, fx.locBId] } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.floor.deleteMany({ where: { id: fx.floorId } });
  // Await async work before asserting or releasing locks.
  await prisma.building.deleteMany({ where: { id: fx.buildingId } });
  // Await async work before asserting or releasing locks.
  await prisma.property.deleteMany({ where: { id: fx.propertyId } });

  // Await async work before asserting or releasing locks.
  await cleanupEmployeeGraph(prisma, employeeIds);
}
