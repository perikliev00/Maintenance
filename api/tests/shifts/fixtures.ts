/**
 * Shift catalog + roster world for P1-64–P1-66.
 */
import type { PrismaClient } from "@prisma/client";
// Prisma client types/runtime for DB setup and assertions.
import { Role } from "@prisma/client";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupEmployeeGraph,
  // Execute the next setup or assertion step for this scenario.
  createEmployeeWithUser,
  // Shape EmployeeUserFixture documents the fixture/response fields this suite touches.
  type EmployeeUserFixture,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../fixtures";

// Export SHIFTS_PASSWORD for shared test/setup consumers.
export const SHIFTS_PASSWORD = "demo1234";

// Export ShiftsWorld for shared test/setup consumers.
export type ShiftsWorld = {
  // Execute the next setup or assertion step for this scenario.
  stamp: string;
  // Fixture field password for the seeded actor/entity.
  password: string;
  // Execute the next setup or assertion step for this scenario.
  manager: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  employeeA: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  employeeB: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  employeeC: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  shiftMorningId: string;
  // Execute the next setup or assertion step for this scenario.
  shiftEveningId: string;
  // Execute the next setup or assertion step for this scenario.
  shiftInactiveId: string;
  /** Hotel dates used by tests (UTC midnight). */
  dayD: string;
  // Execute the next setup or assertion step for this scenario.
  dayD2: string;
};

// Export helper createShiftsWorld for reuse across related tests.
export async function createShiftsWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
// Execute the next setup or assertion step for this scenario.
): Promise<ShiftsWorld> {
  // stamp: unique stamp so parallel runs do not collide.
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // password: credential/token material for auth flows.
  const password = SHIFTS_PASSWORD;

  // manager: seeded entity required before the mutation under test.
  const manager = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `SH-MGR-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `sh-mgr-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.manager,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "SH Manager",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // employeeA: seeded entity required before the mutation under test.
  const employeeA = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `SH-EA-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `sh-ea-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.housekeeper,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "SH Employee A",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // employeeB: seeded entity required before the mutation under test.
  const employeeB = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `SH-EB-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `sh-eb-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.housekeeper,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "SH Employee B",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // employeeC: seeded entity required before the mutation under test.
  const employeeC = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `SH-EC-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `sh-ec-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.housekeeper,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "SH Employee C",
    // Execute the next setup or assertion step for this scenario.
    password,
  });

  // morning: seeded entity required before the mutation under test.
  const morning = await prisma.shift.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      code: `SH-M-${stamp}`.slice(0, 32),
      // Execute the next setup or assertion step for this scenario.
      nameBg: "Сутрин",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "Morning",
      // Execute the next setup or assertion step for this scenario.
      startTime: "07:00",
      // Execute the next setup or assertion step for this scenario.
      endTime: "15:00",
      // Execute the next setup or assertion step for this scenario.
      sortOrder: 1,
      // Execute the next setup or assertion step for this scenario.
      isActive: true,
    },
  });
  // evening: seeded entity required before the mutation under test.
  const evening = await prisma.shift.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      code: `SH-E-${stamp}`.slice(0, 32),
      // Execute the next setup or assertion step for this scenario.
      nameBg: "Вечер",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "Evening",
      // Execute the next setup or assertion step for this scenario.
      startTime: "15:00",
      // Execute the next setup or assertion step for this scenario.
      endTime: "23:00",
      // Execute the next setup or assertion step for this scenario.
      sortOrder: 2,
      // Execute the next setup or assertion step for this scenario.
      isActive: true,
    },
  });
  // inactive: seeded entity required before the mutation under test.
  const inactive = await prisma.shift.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      code: `SH-X-${stamp}`.slice(0, 32),
      // Execute the next setup or assertion step for this scenario.
      nameBg: "Неактивна",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "Inactive",
      // Execute the next setup or assertion step for this scenario.
      startTime: "00:00",
      // Execute the next setup or assertion step for this scenario.
      endTime: "08:00",
      // Execute the next setup or assertion step for this scenario.
      sortOrder: 9,
      // Execute the next setup or assertion step for this scenario.
      isActive: false,
    },
  });

  // Bind dayD for later setup or assertions in this scope.
  const dayD = "2099-08-01";
  // Bind dayD2 for later setup or assertions in this scope.
  const dayD2 = "2099-08-02";

  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  await prisma.employeeShiftRoster.createMany({
    // Execute the next setup or assertion step for this scenario.
    data: [
      {
        // Execute the next setup or assertion step for this scenario.
        employeeId: employeeA.employeeId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${dayD}T00:00:00.000Z`),
        // Execute the next setup or assertion step for this scenario.
        shiftId: morning.id,
      },
      {
        // Execute the next setup or assertion step for this scenario.
        employeeId: employeeB.employeeId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${dayD}T00:00:00.000Z`),
        // Execute the next setup or assertion step for this scenario.
        shiftId: evening.id,
      },
      {
        // Execute the next setup or assertion step for this scenario.
        employeeId: employeeA.employeeId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${dayD2}T00:00:00.000Z`),
        // Execute the next setup or assertion step for this scenario.
        shiftId: evening.id,
      },
      {
        // Execute the next setup or assertion step for this scenario.
        employeeId: employeeC.employeeId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${dayD2}T00:00:00.000Z`),
        // Execute the next setup or assertion step for this scenario.
        shiftId: morning.id,
      },
    ],
  });

  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    stamp,
    // Execute the next setup or assertion step for this scenario.
    password,
    // Execute the next setup or assertion step for this scenario.
    manager,
    // Execute the next setup or assertion step for this scenario.
    employeeA,
    // Execute the next setup or assertion step for this scenario.
    employeeB,
    // Execute the next setup or assertion step for this scenario.
    employeeC,
    // Execute the next setup or assertion step for this scenario.
    shiftMorningId: morning.id,
    // Execute the next setup or assertion step for this scenario.
    shiftEveningId: evening.id,
    // Execute the next setup or assertion step for this scenario.
    shiftInactiveId: inactive.id,
    // Execute the next setup or assertion step for this scenario.
    dayD,
    // Execute the next setup or assertion step for this scenario.
    dayD2,
  };
}

// Export helper rosterEntriesForDay for reuse across related tests.
export async function rosterEntriesForDay(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  hotelDate: string,
// Execute the next setup or assertion step for this scenario.
): Promise<Array<{ employeeId: string; shiftId: string }>> {
  // rows: synchronize actors so the race window is observable.
  const rows = await prisma.employeeShiftRoster.findMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { hotelDate: new Date(`${hotelDate}T00:00:00.000Z`) },
    // SQL fragment used to observe locks or assert DB state.
    select: { employeeId: true, shiftId: true },
    // Execute the next setup or assertion step for this scenario.
    orderBy: [{ employeeId: "asc" }],
  });
  // Return the arranged value/result to the caller.
  return rows;
}

// Export helper cleanupShiftsWorld for reuse across related tests.
export async function cleanupShiftsWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: ShiftsWorld,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Bind empIds for later setup or assertions in this scope.
  const empIds = [
    // Execute the next setup or assertion step for this scenario.
    world.manager.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.employeeA.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.employeeB.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.employeeC.employeeId,
  ];
  // Await async work before asserting or releasing locks.
  await prisma.employeeShiftRoster.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { employeeId: { in: empIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.auditEvent.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      action: "shift.roster.upsert",
      // Execute the next setup or assertion step for this scenario.
      entityId: { in: [world.dayD, world.dayD2] },
    },
  });
  // Detach tasks that may reference shifts from other suites sharing DB.
  await prisma.cleaningTask.updateMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      shiftId: {
        // Execute the next setup or assertion step for this scenario.
        in: [
          // Execute the next setup or assertion step for this scenario.
          world.shiftMorningId,
          // Execute the next setup or assertion step for this scenario.
          world.shiftEveningId,
          // Execute the next setup or assertion step for this scenario.
          world.shiftInactiveId,
        ],
      },
    },
    // Execute the next setup or assertion step for this scenario.
    data: { shiftId: null },
  });
  // Await async work before asserting or releasing locks.
  await prisma.dailyPlanEntry.updateMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      shiftId: {
        // Execute the next setup or assertion step for this scenario.
        in: [
          // Execute the next setup or assertion step for this scenario.
          world.shiftMorningId,
          // Execute the next setup or assertion step for this scenario.
          world.shiftEveningId,
          // Execute the next setup or assertion step for this scenario.
          world.shiftInactiveId,
        ],
      },
    },
    // Execute the next setup or assertion step for this scenario.
    data: { shiftId: null },
  });
  // Await async work before asserting or releasing locks.
  await prisma.shift.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      id: {
        // Execute the next setup or assertion step for this scenario.
        in: [
          // Execute the next setup or assertion step for this scenario.
          world.shiftMorningId,
          // Execute the next setup or assertion step for this scenario.
          world.shiftEveningId,
          // Execute the next setup or assertion step for this scenario.
          world.shiftInactiveId,
        ],
      },
    },
  });
  // Await async work before asserting or releasing locks.
  await cleanupEmployeeGraph(prisma, empIds);
}
