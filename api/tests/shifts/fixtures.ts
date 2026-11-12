/**
 * Shift catalog + roster world for P1-64–P1-66.
 */
import type { PrismaClient } from "@prisma/client";
import { Role } from "@prisma/client";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  // Shape EmployeeUserFixture documents the fixture/response fields this suite touches.
  type EmployeeUserFixture,
} from "../fixtures";

// Export SHIFTS_PASSWORD for shared test/setup consumers.
export const SHIFTS_PASSWORD = "demo1234";

// Export ShiftsWorld for shared test/setup consumers.
export type ShiftsWorld = {
  stamp: string;
  password: string;
  manager: EmployeeUserFixture;
  employeeA: EmployeeUserFixture;
  employeeB: EmployeeUserFixture;
  employeeC: EmployeeUserFixture;
  shiftMorningId: string;
  shiftEveningId: string;
  shiftInactiveId: string;
  /** Hotel dates used by tests (UTC midnight). */
  dayD: string;
  dayD2: string;
};

// Export helper createShiftsWorld for reuse across related tests.
export async function createShiftsWorld(
  prisma: PrismaClient,
): Promise<ShiftsWorld> {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const password = SHIFTS_PASSWORD;

  // manager: seeded entity required before the mutation under test.
  const manager = await createEmployeeWithUser(prisma, {
    employeeNumber: `SH-MGR-${stamp}`.slice(0, 32),
    email: `sh-mgr-${stamp}@test.local`,
    role: Role.manager,
    fullName: "SH Manager",
    password,
  });
  // employeeA: seeded entity required before the mutation under test.
  const employeeA = await createEmployeeWithUser(prisma, {
    employeeNumber: `SH-EA-${stamp}`.slice(0, 32),
    email: `sh-ea-${stamp}@test.local`,
    role: Role.housekeeper,
    fullName: "SH Employee A",
    password,
  });
  // employeeB: seeded entity required before the mutation under test.
  const employeeB = await createEmployeeWithUser(prisma, {
    employeeNumber: `SH-EB-${stamp}`.slice(0, 32),
    email: `sh-eb-${stamp}@test.local`,
    role: Role.housekeeper,
    fullName: "SH Employee B",
    password,
  });
  // employeeC: seeded entity required before the mutation under test.
  const employeeC = await createEmployeeWithUser(prisma, {
    employeeNumber: `SH-EC-${stamp}`.slice(0, 32),
    email: `sh-ec-${stamp}@test.local`,
    role: Role.housekeeper,
    fullName: "SH Employee C",
    password,
  });

  // morning: seeded entity required before the mutation under test.
  const morning = await prisma.shift.create({
    data: {
      code: `SH-M-${stamp}`.slice(0, 32),
      nameBg: "Сутрин",
      nameEn: "Morning",
      startTime: "07:00",
      endTime: "15:00",
      sortOrder: 1,
      isActive: true,
    },
  });
  // evening: seeded entity required before the mutation under test.
  const evening = await prisma.shift.create({
    data: {
      code: `SH-E-${stamp}`.slice(0, 32),
      nameBg: "Вечер",
      nameEn: "Evening",
      startTime: "15:00",
      endTime: "23:00",
      sortOrder: 2,
      isActive: true,
    },
  });
  // inactive: seeded entity required before the mutation under test.
  const inactive = await prisma.shift.create({
    data: {
      code: `SH-X-${stamp}`.slice(0, 32),
      nameBg: "Неактивна",
      nameEn: "Inactive",
      startTime: "00:00",
      endTime: "08:00",
      sortOrder: 9,
      isActive: false,
    },
  });

  const dayD = "2099-08-01";
  const dayD2 = "2099-08-02";

  await prisma.employeeShiftRoster.createMany({
    data: [
      {
        employeeId: employeeA.employeeId,
        hotelDate: new Date(`${dayD}T00:00:00.000Z`),
        shiftId: morning.id,
      },
      {
        employeeId: employeeB.employeeId,
        hotelDate: new Date(`${dayD}T00:00:00.000Z`),
        shiftId: evening.id,
      },
      {
        employeeId: employeeA.employeeId,
        hotelDate: new Date(`${dayD2}T00:00:00.000Z`),
        shiftId: evening.id,
      },
      {
        employeeId: employeeC.employeeId,
        hotelDate: new Date(`${dayD2}T00:00:00.000Z`),
        shiftId: morning.id,
      },
    ],
  });

  return {
    stamp,
    password,
    manager,
    employeeA,
    employeeB,
    employeeC,
    shiftMorningId: morning.id,
    shiftEveningId: evening.id,
    shiftInactiveId: inactive.id,
    dayD,
    dayD2,
  };
}

// Export helper rosterEntriesForDay for reuse across related tests.
export async function rosterEntriesForDay(
  prisma: PrismaClient,
  hotelDate: string,
): Promise<Array<{ employeeId: string; shiftId: string }>> {
  const rows = await prisma.employeeShiftRoster.findMany({
    where: { hotelDate: new Date(`${hotelDate}T00:00:00.000Z`) },
    select: { employeeId: true, shiftId: true },
    orderBy: [{ employeeId: "asc" }],
  });
  return rows;
}

// Export helper cleanupShiftsWorld for reuse across related tests.
export async function cleanupShiftsWorld(
  prisma: PrismaClient,
  world: ShiftsWorld,
): Promise<void> {
  const empIds = [
    world.manager.employeeId,
    world.employeeA.employeeId,
    world.employeeB.employeeId,
    world.employeeC.employeeId,
  ];
  await prisma.employeeShiftRoster.deleteMany({
    where: { employeeId: { in: empIds } },
  });
  await prisma.auditEvent.deleteMany({
    where: {
      action: "shift.roster.upsert",
      entityId: { in: [world.dayD, world.dayD2] },
    },
  });
  // Detach tasks that may reference shifts from other suites sharing DB.
  await prisma.cleaningTask.updateMany({
    where: {
      shiftId: {
        in: [
          world.shiftMorningId,
          world.shiftEveningId,
          world.shiftInactiveId,
        ],
      },
    },
    data: { shiftId: null },
  });
  await prisma.dailyPlanEntry.updateMany({
    where: {
      shiftId: {
        in: [
          world.shiftMorningId,
          world.shiftEveningId,
          world.shiftInactiveId,
        ],
      },
    },
    data: { shiftId: null },
  });
  await prisma.shift.deleteMany({
    where: {
      id: {
        in: [
          world.shiftMorningId,
          world.shiftEveningId,
          world.shiftInactiveId,
        ],
      },
    },
  });
  await cleanupEmployeeGraph(prisma, empIds);
}
