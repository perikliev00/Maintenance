/**
 * My-work queue world for P1-67 / P1-68.
 */
import type { PrismaClient } from "@prisma/client";
// Prisma client types/runtime for DB setup and assertions.
import { Role, TicketStatus } from "@prisma/client";
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

// Export MYWORK_PASSWORD for shared test/setup consumers.
export const MYWORK_PASSWORD = "demo1234";

// Export MyWorkWorld for shared test/setup consumers.
export type MyWorkWorld = {
  // Execute the next setup or assertion step for this scenario.
  stamp: string;
  // Fixture field password for the seeded actor/entity.
  password: string;
  // Execute the next setup or assertion step for this scenario.
  propertyId: string;
  // Execute the next setup or assertion step for this scenario.
  buildingId: string;
  // Execute the next setup or assertion step for this scenario.
  floorId: string;
  // Execute the next setup or assertion step for this scenario.
  supervisor: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  housekeeper: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  otherHk: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  technician: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  otherTech: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  manager: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  sectorOwnId: string;
  // Execute the next setup or assertion step for this scenario.
  sectorOtherId: string;
  // Execute the next setup or assertion step for this scenario.
  locOwnId: string;
  // Execute the next setup or assertion step for this scenario.
  locOtherId: string;
  // Execute the next setup or assertion step for this scenario.
  locNullId: string;
  // Execute the next setup or assertion step for this scenario.
  shiftMorningId: string;
  // Execute the next setup or assertion step for this scenario.
  shiftEveningId: string;
  // Execute the next setup or assertion step for this scenario.
  dayD: string;
  // Execute the next setup or assertion step for this scenario.
  dayD2: string;
  // Execute the next setup or assertion step for this scenario.
  taskMorningId: string;
  // Execute the next setup or assertion step for this scenario.
  taskNullShiftId: string;
  // Execute the next setup or assertion step for this scenario.
  taskEveningId: string;
  // Execute the next setup or assertion step for this scenario.
  taskOtherDayId: string;
  // Execute the next setup or assertion step for this scenario.
  taskForeignSectorId: string;
  // Execute the next setup or assertion step for this scenario.
  ticketOwnOpenId: string;
  // Execute the next setup or assertion step for this scenario.
  ticketOwnAssignedId: string;
  // Execute the next setup or assertion step for this scenario.
  ticketOwnInProgressId: string;
  // Execute the next setup or assertion step for this scenario.
  ticketOwnWaitingId: string;
  // Execute the next setup or assertion step for this scenario.
  ticketForeignOpenId: string;
  // Execute the next setup or assertion step for this scenario.
  ticketOwnResolvedId: string;
  // Execute the next setup or assertion step for this scenario.
  ticketOwnClosedId: string;
  /** Cleaning assigned to otherHk on dayD (must not appear in HK queue). */
  taskForeignAssigneeId: string;
  /** Completed / cancelled controls on dayD for HK. */
  taskCompletedId: string;
  // Execute the next setup or assertion step for this scenario.
  taskCancelledId: string;
  // Execute the next setup or assertion step for this scenario.
  cleaningForTechId: string;
};

// Export helper createMyWorkWorld for reuse across related tests.
export async function createMyWorkWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
// Execute the next setup or assertion step for this scenario.
): Promise<MyWorkWorld> {
  // stamp: unique stamp so parallel runs do not collide.
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // password: credential/token material for auth flows.
  const password = MYWORK_PASSWORD;
  // Bind dayD for later setup or assertions in this scope.
  const dayD = "2099-12-01";
  // Bind dayD2 for later setup or assertions in this scope.
  const dayD2 = "2099-12-02";

  // supervisor: seeded entity required before the mutation under test.
  const supervisor = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `MW-SUP-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `mw-sup-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.supervisor,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "MW Supervisor",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // housekeeper: seeded entity required before the mutation under test.
  const housekeeper = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `MW-HK-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `mw-hk-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.housekeeper,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "MW Housekeeper",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // otherHk: seeded entity required before the mutation under test.
  const otherHk = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `MW-HK2-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `mw-hk2-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.housekeeper,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "MW Other HK",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // technician: seeded entity required before the mutation under test.
  const technician = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `MW-TECH-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `mw-tech-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.technician,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "MW Technician",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // otherTech: seeded entity required before the mutation under test.
  const otherTech = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `MW-TECH2-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `mw-tech2-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.technician,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "MW Other Tech",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // manager: seeded entity required before the mutation under test.
  const manager = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `MW-MGR-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `mw-mgr-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.manager,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "MW Manager",
    // Execute the next setup or assertion step for this scenario.
    password,
  });

  // property: seeded entity required before the mutation under test.
  const property = await prisma.property.create({
    // Execute the next setup or assertion step for this scenario.
    data: { name: `MW Property ${stamp}` },
  });
  // building: seeded entity required before the mutation under test.
  const building = await prisma.building.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      propertyId: property.id,
      // Fixture field name for the seeded actor/entity.
      name: "MW Building",
      // Execute the next setup or assertion step for this scenario.
      code: `MWB-${stamp}`.slice(0, 32),
    },
  });
  // floor: seeded entity required before the mutation under test.
  const floor = await prisma.floor.create({
    // Execute the next setup or assertion step for this scenario.
    data: { buildingId: building.id, number: 3, name: "MW Floor" },
  });

  // sectorOwn: seeded entity required before the mutation under test.
  const sectorOwn = await prisma.sector.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      propertyId: property.id,
      // Execute the next setup or assertion step for this scenario.
      code: `MWO-${stamp}`.slice(0, 32),
      // Execute the next setup or assertion step for this scenario.
      nameBg: "MW Own",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "MW Own",
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: supervisor.employeeId,
      // Execute the next setup or assertion step for this scenario.
      isActive: true,
    },
  });
  // sectorOther: seeded entity required before the mutation under test.
  const sectorOther = await prisma.sector.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      propertyId: property.id,
      // Execute the next setup or assertion step for this scenario.
      code: `MWX-${stamp}`.slice(0, 32),
      // Execute the next setup or assertion step for this scenario.
      nameBg: "MW Other",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "MW Other",
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: null,
      // Execute the next setup or assertion step for this scenario.
      isActive: true,
    },
  });

  // Bind mkLoc for later setup or assertions in this scope.
  const mkLoc = (prefix: string) =>
    // Execute the next setup or assertion step for this scenario.
    prisma.location.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        floorId: floor.id,
        // Execute the next setup or assertion step for this scenario.
        number: `${prefix}-${stamp}`.slice(0, 24),
        // Execute the next setup or assertion step for this scenario.
        kind: "room",
      },
    });

  // locOwn: synchronize actors so the race window is observable.
  const locOwn = await mkLoc("MWO");
  // locOther: synchronize actors so the race window is observable.
  const locOther = await mkLoc("MWX");
  // locNull: synchronize actors so the race window is observable.
  const locNull = await mkLoc("MWN");

  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  await prisma.sectorLocation.createMany({
    // Execute the next setup or assertion step for this scenario.
    data: [
      // Execute the next setup or assertion step for this scenario.
      { sectorId: sectorOwn.id, locationId: locOwn.id },
      // Execute the next setup or assertion step for this scenario.
      { sectorId: sectorOwn.id, locationId: locNull.id },
      // Execute the next setup or assertion step for this scenario.
      { sectorId: sectorOther.id, locationId: locOther.id },
    ],
  });

  // morning: seeded entity required before the mutation under test.
  const morning = await prisma.shift.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      code: `MW-M-${stamp}`.slice(0, 32),
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
      code: `MW-E-${stamp}`.slice(0, 32),
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

  // Await async work before asserting or releasing locks.
  await prisma.employeeShiftRoster.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      employeeId: housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      // Execute the next setup or assertion step for this scenario.
      shiftId: evening.id,
    },
  });

  // One active task per location/day — use three rooms on dayD.
  const tm = await prisma.cleaningTask.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locOwn.id,
      // Execute the next setup or assertion step for this scenario.
      sectorId: sectorOwn.id,
      // Execute the next setup or assertion step for this scenario.
      sectorSupervisorEmployeeId: supervisor.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      // Fixture field status for the seeded actor/entity.
      status: "assigned",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: morning.id,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: locOwn.cleaningCycle,
    },
  });
  // tn: seeded entity required before the mutation under test.
  const tn = await prisma.cleaningTask.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locNull.id,
      // Execute the next setup or assertion step for this scenario.
      sectorId: sectorOwn.id,
      // Execute the next setup or assertion step for this scenario.
      sectorSupervisorEmployeeId: supervisor.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      // Fixture field status for the seeded actor/entity.
      status: "assigned",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: null,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: locNull.cleaningCycle,
    },
  });
  // te: seeded entity required before the mutation under test.
  const te = await prisma.cleaningTask.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locOther.id,
      // Execute the next setup or assertion step for this scenario.
      sectorId: sectorOther.id,
      // Execute the next setup or assertion step for this scenario.
      sectorSupervisorEmployeeId: null,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      // Fixture field status for the seeded actor/entity.
      status: "assigned",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: evening.id,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: locOther.cleaningCycle,
    },
  });
  // tOtherDay: seeded entity required before the mutation under test.
  const tOtherDay = await prisma.cleaningTask.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locOwn.id,
      // Execute the next setup or assertion step for this scenario.
      sectorId: sectorOwn.id,
      // Execute the next setup or assertion step for this scenario.
      sectorSupervisorEmployeeId: supervisor.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: new Date(`${dayD2}T00:00:00.000Z`),
      // Fixture field status for the seeded actor/entity.
      status: "assigned",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: morning.id,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: locOwn.cleaningCycle,
    },
  });
  // Stale foreign sector snapshot on a room now in own sector (supervisor filter).
  const tForeignSnap = await prisma.cleaningTask.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locNull.id,
      // Execute the next setup or assertion step for this scenario.
      sectorId: sectorOther.id,
      // Execute the next setup or assertion step for this scenario.
      sectorSupervisorEmployeeId: null,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: new Date(`${dayD2}T00:00:00.000Z`),
      // Fixture field status for the seeded actor/entity.
      status: "assigned",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: otherHk.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: null,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: locNull.cleaningCycle,
    },
  });

  // ticketOwnOpen: seeded entity required before the mutation under test.
  const ticketOwnOpen = await prisma.maintenanceTicket.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locOwn.id,
      // Execute the next setup or assertion step for this scenario.
      title: `MW own open ${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      categoryKey: "other",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelBg: "Друго",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelEn: "Other",
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      assigneeId: technician.employeeId,
      // Fixture field status for the seeded actor/entity.
      status: TicketStatus.new,
    },
  });
  // ticketOwnAssigned: seeded entity required before the mutation under test.
  const ticketOwnAssigned = await prisma.maintenanceTicket.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locOwn.id,
      // Execute the next setup or assertion step for this scenario.
      title: `MW own assigned ${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      categoryKey: "other",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelBg: "Друго",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelEn: "Other",
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      assigneeId: technician.employeeId,
      // Fixture field status for the seeded actor/entity.
      status: TicketStatus.assigned,
    },
  });
  // ticketOwnInProgress: seeded entity required before the mutation under test.
  const ticketOwnInProgress = await prisma.maintenanceTicket.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locOwn.id,
      // Execute the next setup or assertion step for this scenario.
      title: `MW own in_progress ${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      categoryKey: "other",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelBg: "Друго",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelEn: "Other",
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      assigneeId: technician.employeeId,
      // Fixture field status for the seeded actor/entity.
      status: TicketStatus.in_progress,
    },
  });
  // ticketOwnWaiting: seeded entity required before the mutation under test.
  const ticketOwnWaiting = await prisma.maintenanceTicket.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locOwn.id,
      // Execute the next setup or assertion step for this scenario.
      title: `MW own waiting ${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      categoryKey: "other",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelBg: "Друго",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelEn: "Other",
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      assigneeId: technician.employeeId,
      // Fixture field status for the seeded actor/entity.
      status: TicketStatus.waiting,
    },
  });
  // ticketForeign: seeded entity required before the mutation under test.
  const ticketForeign = await prisma.maintenanceTicket.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locOther.id,
      // Execute the next setup or assertion step for this scenario.
      title: `MW foreign ${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      categoryKey: "other",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelBg: "Друго",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelEn: "Other",
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      assigneeId: otherTech.employeeId,
      // Fixture field status for the seeded actor/entity.
      status: TicketStatus.new,
    },
  });
  // ticketResolved: seeded entity required before the mutation under test.
  const ticketResolved = await prisma.maintenanceTicket.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locOwn.id,
      // Execute the next setup or assertion step for this scenario.
      title: `MW resolved ${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      categoryKey: "other",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelBg: "Друго",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelEn: "Other",
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      assigneeId: technician.employeeId,
      // Fixture field status for the seeded actor/entity.
      status: TicketStatus.resolved,
      // Execute the next setup or assertion step for this scenario.
      resolvedAt: new Date(),
      // Execute the next setup or assertion step for this scenario.
      resolvedByEmployeeId: technician.employeeId,
    },
  });
  // ticketClosed: seeded entity required before the mutation under test.
  const ticketClosed = await prisma.maintenanceTicket.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locOwn.id,
      // Execute the next setup or assertion step for this scenario.
      title: `MW closed ${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      categoryKey: "other",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelBg: "Друго",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelEn: "Other",
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      assigneeId: technician.employeeId,
      // Fixture field status for the seeded actor/entity.
      status: TicketStatus.closed,
      // Execute the next setup or assertion step for this scenario.
      closedAt: new Date(),
      // Execute the next setup or assertion step for this scenario.
      closedByEmployeeId: technician.employeeId,
    },
  });
  // Extra rooms so dayD can hold foreign-assignee + terminal controls without
  // colliding with the one-active-task-per-room/date unique index.
  const locForeignAssignee = await mkLoc("MWF");
  // locCompleted: synchronize actors so the race window is observable.
  const locCompleted = await mkLoc("MWC");
  // locCancelled: synchronize actors so the race window is observable.
  const locCancelled = await mkLoc("MWK");
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  await prisma.sectorLocation.createMany({
    // Execute the next setup or assertion step for this scenario.
    data: [
      // Execute the next setup or assertion step for this scenario.
      { sectorId: sectorOwn.id, locationId: locForeignAssignee.id },
      // Execute the next setup or assertion step for this scenario.
      { sectorId: sectorOwn.id, locationId: locCompleted.id },
      // Execute the next setup or assertion step for this scenario.
      { sectorId: sectorOwn.id, locationId: locCancelled.id },
    ],
  });

  // taskForeignAssignee: seeded entity required before the mutation under test.
  const taskForeignAssignee = await prisma.cleaningTask.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locForeignAssignee.id,
      // Execute the next setup or assertion step for this scenario.
      sectorId: sectorOwn.id,
      // Execute the next setup or assertion step for this scenario.
      sectorSupervisorEmployeeId: supervisor.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      // Fixture field status for the seeded actor/entity.
      status: "assigned",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: otherHk.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: morning.id,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: locForeignAssignee.cleaningCycle,
    },
  });
  // taskCompleted: seeded entity required before the mutation under test.
  const taskCompleted = await prisma.cleaningTask.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locCompleted.id,
      // Execute the next setup or assertion step for this scenario.
      sectorId: sectorOwn.id,
      // Execute the next setup or assertion step for this scenario.
      sectorSupervisorEmployeeId: supervisor.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      // Fixture field status for the seeded actor/entity.
      status: "completed",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: morning.id,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: locCompleted.cleaningCycle,
    },
  });
  // taskCancelled: seeded entity required before the mutation under test.
  const taskCancelled = await prisma.cleaningTask.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locCancelled.id,
      // Execute the next setup or assertion step for this scenario.
      sectorId: sectorOwn.id,
      // Execute the next setup or assertion step for this scenario.
      sectorSupervisorEmployeeId: supervisor.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      // Fixture field status for the seeded actor/entity.
      status: "cancelled",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: morning.id,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: locCancelled.cleaningCycle,
    },
  });

  // locTechClean: synchronize actors so the race window is observable.
  const locTechClean = await mkLoc("MWT");
  // Await async work before asserting or releasing locks.
  await prisma.sectorLocation.create({
    // Execute the next setup or assertion step for this scenario.
    data: { sectorId: sectorOwn.id, locationId: locTechClean.id },
  });
  // cleaningForTech: seeded entity required before the mutation under test.
  const cleaningForTech = await prisma.cleaningTask.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: locTechClean.id,
      // Execute the next setup or assertion step for this scenario.
      sectorId: sectorOwn.id,
      // Execute the next setup or assertion step for this scenario.
      sectorSupervisorEmployeeId: supervisor.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      // Fixture field status for the seeded actor/entity.
      status: "assigned",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: housekeeper.employeeId,
      // Evening so morning-filter suites stay exact; still present for tech empty-queue proof.
      shiftId: evening.id,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: locTechClean.cleaningCycle,
    },
  });

  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    stamp,
    // Execute the next setup or assertion step for this scenario.
    password,
    // Execute the next setup or assertion step for this scenario.
    propertyId: property.id,
    // Execute the next setup or assertion step for this scenario.
    buildingId: building.id,
    // Execute the next setup or assertion step for this scenario.
    floorId: floor.id,
    // Execute the next setup or assertion step for this scenario.
    supervisor,
    // Execute the next setup or assertion step for this scenario.
    housekeeper,
    // Execute the next setup or assertion step for this scenario.
    otherHk,
    // Execute the next setup or assertion step for this scenario.
    technician,
    // Execute the next setup or assertion step for this scenario.
    otherTech,
    // Execute the next setup or assertion step for this scenario.
    manager,
    // Execute the next setup or assertion step for this scenario.
    sectorOwnId: sectorOwn.id,
    // Execute the next setup or assertion step for this scenario.
    sectorOtherId: sectorOther.id,
    // Execute the next setup or assertion step for this scenario.
    locOwnId: locOwn.id,
    // Execute the next setup or assertion step for this scenario.
    locOtherId: locOther.id,
    // Execute the next setup or assertion step for this scenario.
    locNullId: locNull.id,
    // Execute the next setup or assertion step for this scenario.
    shiftMorningId: morning.id,
    // Execute the next setup or assertion step for this scenario.
    shiftEveningId: evening.id,
    // Execute the next setup or assertion step for this scenario.
    dayD,
    // Execute the next setup or assertion step for this scenario.
    dayD2,
    // Execute the next setup or assertion step for this scenario.
    taskMorningId: tm.id,
    // Execute the next setup or assertion step for this scenario.
    taskNullShiftId: tn.id,
    // Execute the next setup or assertion step for this scenario.
    taskEveningId: te.id,
    // Execute the next setup or assertion step for this scenario.
    taskOtherDayId: tOtherDay.id,
    // Execute the next setup or assertion step for this scenario.
    taskForeignSectorId: tForeignSnap.id,
    // Execute the next setup or assertion step for this scenario.
    ticketOwnOpenId: ticketOwnOpen.id,
    // Execute the next setup or assertion step for this scenario.
    ticketOwnAssignedId: ticketOwnAssigned.id,
    // Execute the next setup or assertion step for this scenario.
    ticketOwnInProgressId: ticketOwnInProgress.id,
    // Execute the next setup or assertion step for this scenario.
    ticketOwnWaitingId: ticketOwnWaiting.id,
    // Execute the next setup or assertion step for this scenario.
    ticketForeignOpenId: ticketForeign.id,
    // Execute the next setup or assertion step for this scenario.
    ticketOwnResolvedId: ticketResolved.id,
    // Execute the next setup or assertion step for this scenario.
    ticketOwnClosedId: ticketClosed.id,
    // Execute the next setup or assertion step for this scenario.
    taskForeignAssigneeId: taskForeignAssignee.id,
    // Execute the next setup or assertion step for this scenario.
    taskCompletedId: taskCompleted.id,
    // Execute the next setup or assertion step for this scenario.
    taskCancelledId: taskCancelled.id,
    // Execute the next setup or assertion step for this scenario.
    cleaningForTechId: cleaningForTech.id,
  };
}

// Export helper cleanupMyWorkWorld for reuse across related tests.
export async function cleanupMyWorkWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: MyWorkWorld,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Bind locIds for later setup or assertions in this scope.
  const locIds = (
    // Await async work before asserting or releasing locks.
    await prisma.location.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { floorId: world.floorId },
      // SQL fragment used to observe locks or assert DB state.
      select: { id: true },
    })
  // Execute the next setup or assertion step for this scenario.
  ).map((l) => l.id);
  // Await async work before asserting or releasing locks.
  await prisma.cleaningSession.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { task: { locationId: { in: locIds } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.inspection.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { task: { locationId: { in: locIds } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.cleaningTask.deleteMany({ where: { locationId: { in: locIds } } });
  // Await async work before asserting or releasing locks.
  await prisma.ticketEvent.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { ticket: { locationId: { in: locIds } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.maintenanceTicket.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: locIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.employeeShiftRoster.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      employeeId: {
        // Execute the next setup or assertion step for this scenario.
        in: [
          // Execute the next setup or assertion step for this scenario.
          world.housekeeper.employeeId,
          // Execute the next setup or assertion step for this scenario.
          world.otherHk.employeeId,
          // Execute the next setup or assertion step for this scenario.
          world.technician.employeeId,
        ],
      },
    },
  });
  // Await async work before asserting or releasing locks.
  await prisma.sectorLocation.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: locIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.location.deleteMany({ where: { id: { in: locIds } } });
  // Await async work before asserting or releasing locks.
  await prisma.sector.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: [world.sectorOwnId, world.sectorOtherId] } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.cleaningTask.updateMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      shiftId: { in: [world.shiftMorningId, world.shiftEveningId] },
    },
    // Execute the next setup or assertion step for this scenario.
    data: { shiftId: null },
  });
  // Await async work before asserting or releasing locks.
  await prisma.shift.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: [world.shiftMorningId, world.shiftEveningId] } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.floor.delete({ where: { id: world.floorId } });
  // Await async work before asserting or releasing locks.
  await prisma.building.delete({ where: { id: world.buildingId } });
  // Await async work before asserting or releasing locks.
  await prisma.property.delete({ where: { id: world.propertyId } });
  // Await async work before asserting or releasing locks.
  await cleanupEmployeeGraph(prisma, [
    // Execute the next setup or assertion step for this scenario.
    world.supervisor.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.housekeeper.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.otherHk.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.technician.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.otherTech.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.manager.employeeId,
  ]);
}
