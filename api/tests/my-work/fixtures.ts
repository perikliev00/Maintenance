/**
 * My-work queue world for P1-67 / P1-68.
 */
import type { PrismaClient } from "@prisma/client";
import { Role, TicketStatus } from "@prisma/client";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../fixtures";

export const MYWORK_PASSWORD = "demo1234";

export type MyWorkWorld = {
  stamp: string;
  password: string;
  propertyId: string;
  buildingId: string;
  floorId: string;
  supervisor: EmployeeUserFixture;
  housekeeper: EmployeeUserFixture;
  otherHk: EmployeeUserFixture;
  technician: EmployeeUserFixture;
  otherTech: EmployeeUserFixture;
  manager: EmployeeUserFixture;
  sectorOwnId: string;
  sectorOtherId: string;
  locOwnId: string;
  locOtherId: string;
  locNullId: string;
  shiftMorningId: string;
  shiftEveningId: string;
  dayD: string;
  dayD2: string;
  taskMorningId: string;
  taskNullShiftId: string;
  taskEveningId: string;
  taskOtherDayId: string;
  taskForeignSectorId: string;
  ticketOwnOpenId: string;
  ticketOwnAssignedId: string;
  ticketOwnInProgressId: string;
  ticketOwnWaitingId: string;
  ticketForeignOpenId: string;
  ticketOwnResolvedId: string;
  ticketOwnClosedId: string;
  /** Cleaning assigned to otherHk on dayD (must not appear in HK queue). */
  taskForeignAssigneeId: string;
  /** Completed / cancelled controls on dayD for HK. */
  taskCompletedId: string;
  taskCancelledId: string;
  cleaningForTechId: string;
};

export async function createMyWorkWorld(
  prisma: PrismaClient,
): Promise<MyWorkWorld> {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const password = MYWORK_PASSWORD;
  const dayD = "2099-12-01";
  const dayD2 = "2099-12-02";

  const supervisor = await createEmployeeWithUser(prisma, {
    employeeNumber: `MW-SUP-${stamp}`.slice(0, 32),
    email: `mw-sup-${stamp}@test.local`,
    role: Role.supervisor,
    fullName: "MW Supervisor",
    password,
  });
  const housekeeper = await createEmployeeWithUser(prisma, {
    employeeNumber: `MW-HK-${stamp}`.slice(0, 32),
    email: `mw-hk-${stamp}@test.local`,
    role: Role.housekeeper,
    fullName: "MW Housekeeper",
    password,
  });
  const otherHk = await createEmployeeWithUser(prisma, {
    employeeNumber: `MW-HK2-${stamp}`.slice(0, 32),
    email: `mw-hk2-${stamp}@test.local`,
    role: Role.housekeeper,
    fullName: "MW Other HK",
    password,
  });
  const technician = await createEmployeeWithUser(prisma, {
    employeeNumber: `MW-TECH-${stamp}`.slice(0, 32),
    email: `mw-tech-${stamp}@test.local`,
    role: Role.technician,
    fullName: "MW Technician",
    password,
  });
  const otherTech = await createEmployeeWithUser(prisma, {
    employeeNumber: `MW-TECH2-${stamp}`.slice(0, 32),
    email: `mw-tech2-${stamp}@test.local`,
    role: Role.technician,
    fullName: "MW Other Tech",
    password,
  });
  const manager = await createEmployeeWithUser(prisma, {
    employeeNumber: `MW-MGR-${stamp}`.slice(0, 32),
    email: `mw-mgr-${stamp}@test.local`,
    role: Role.manager,
    fullName: "MW Manager",
    password,
  });

  const property = await prisma.property.create({
    data: { name: `MW Property ${stamp}` },
  });
  const building = await prisma.building.create({
    data: {
      propertyId: property.id,
      name: "MW Building",
      code: `MWB-${stamp}`.slice(0, 32),
    },
  });
  const floor = await prisma.floor.create({
    data: { buildingId: building.id, number: 3, name: "MW Floor" },
  });

  const sectorOwn = await prisma.sector.create({
    data: {
      propertyId: property.id,
      code: `MWO-${stamp}`.slice(0, 32),
      nameBg: "MW Own",
      nameEn: "MW Own",
      primarySupervisorEmployeeId: supervisor.employeeId,
      isActive: true,
    },
  });
  const sectorOther = await prisma.sector.create({
    data: {
      propertyId: property.id,
      code: `MWX-${stamp}`.slice(0, 32),
      nameBg: "MW Other",
      nameEn: "MW Other",
      primarySupervisorEmployeeId: null,
      isActive: true,
    },
  });

  const mkLoc = (prefix: string) =>
    prisma.location.create({
      data: {
        floorId: floor.id,
        number: `${prefix}-${stamp}`.slice(0, 24),
        kind: "room",
      },
    });

  const locOwn = await mkLoc("MWO");
  const locOther = await mkLoc("MWX");
  const locNull = await mkLoc("MWN");

  await prisma.sectorLocation.createMany({
    data: [
      { sectorId: sectorOwn.id, locationId: locOwn.id },
      { sectorId: sectorOwn.id, locationId: locNull.id },
      { sectorId: sectorOther.id, locationId: locOther.id },
    ],
  });

  const morning = await prisma.shift.create({
    data: {
      code: `MW-M-${stamp}`.slice(0, 32),
      nameBg: "Сутрин",
      nameEn: "Morning",
      startTime: "07:00",
      endTime: "15:00",
      sortOrder: 1,
      isActive: true,
    },
  });
  const evening = await prisma.shift.create({
    data: {
      code: `MW-E-${stamp}`.slice(0, 32),
      nameBg: "Вечер",
      nameEn: "Evening",
      startTime: "15:00",
      endTime: "23:00",
      sortOrder: 2,
      isActive: true,
    },
  });

  await prisma.employeeShiftRoster.create({
    data: {
      employeeId: housekeeper.employeeId,
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      shiftId: evening.id,
    },
  });

  // One active task per location/day — use three rooms on dayD.
  const tm = await prisma.cleaningTask.create({
    data: {
      locationId: locOwn.id,
      sectorId: sectorOwn.id,
      sectorSupervisorEmployeeId: supervisor.employeeId,
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      status: "assigned",
      assignedEmployeeId: housekeeper.employeeId,
      shiftId: morning.id,
      cleaningCycle: locOwn.cleaningCycle,
    },
  });
  const tn = await prisma.cleaningTask.create({
    data: {
      locationId: locNull.id,
      sectorId: sectorOwn.id,
      sectorSupervisorEmployeeId: supervisor.employeeId,
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      status: "assigned",
      assignedEmployeeId: housekeeper.employeeId,
      shiftId: null,
      cleaningCycle: locNull.cleaningCycle,
    },
  });
  const te = await prisma.cleaningTask.create({
    data: {
      locationId: locOther.id,
      sectorId: sectorOther.id,
      sectorSupervisorEmployeeId: null,
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      status: "assigned",
      assignedEmployeeId: housekeeper.employeeId,
      shiftId: evening.id,
      cleaningCycle: locOther.cleaningCycle,
    },
  });
  const tOtherDay = await prisma.cleaningTask.create({
    data: {
      locationId: locOwn.id,
      sectorId: sectorOwn.id,
      sectorSupervisorEmployeeId: supervisor.employeeId,
      hotelDate: new Date(`${dayD2}T00:00:00.000Z`),
      status: "assigned",
      assignedEmployeeId: housekeeper.employeeId,
      shiftId: morning.id,
      cleaningCycle: locOwn.cleaningCycle,
    },
  });
  // Stale foreign sector snapshot on a room now in own sector (supervisor filter).
  const tForeignSnap = await prisma.cleaningTask.create({
    data: {
      locationId: locNull.id,
      sectorId: sectorOther.id,
      sectorSupervisorEmployeeId: null,
      hotelDate: new Date(`${dayD2}T00:00:00.000Z`),
      status: "assigned",
      assignedEmployeeId: otherHk.employeeId,
      shiftId: null,
      cleaningCycle: locNull.cleaningCycle,
    },
  });

  const ticketOwnOpen = await prisma.maintenanceTicket.create({
    data: {
      locationId: locOwn.id,
      title: `MW own open ${stamp}`,
      categoryKey: "other",
      categoryLabelBg: "Друго",
      categoryLabelEn: "Other",
      reportedByEmployeeId: manager.employeeId,
      assigneeId: technician.employeeId,
      status: TicketStatus.new,
    },
  });
  const ticketOwnAssigned = await prisma.maintenanceTicket.create({
    data: {
      locationId: locOwn.id,
      title: `MW own assigned ${stamp}`,
      categoryKey: "other",
      categoryLabelBg: "Друго",
      categoryLabelEn: "Other",
      reportedByEmployeeId: manager.employeeId,
      assigneeId: technician.employeeId,
      status: TicketStatus.assigned,
    },
  });
  const ticketOwnInProgress = await prisma.maintenanceTicket.create({
    data: {
      locationId: locOwn.id,
      title: `MW own in_progress ${stamp}`,
      categoryKey: "other",
      categoryLabelBg: "Друго",
      categoryLabelEn: "Other",
      reportedByEmployeeId: manager.employeeId,
      assigneeId: technician.employeeId,
      status: TicketStatus.in_progress,
    },
  });
  const ticketOwnWaiting = await prisma.maintenanceTicket.create({
    data: {
      locationId: locOwn.id,
      title: `MW own waiting ${stamp}`,
      categoryKey: "other",
      categoryLabelBg: "Друго",
      categoryLabelEn: "Other",
      reportedByEmployeeId: manager.employeeId,
      assigneeId: technician.employeeId,
      status: TicketStatus.waiting,
    },
  });
  const ticketForeign = await prisma.maintenanceTicket.create({
    data: {
      locationId: locOther.id,
      title: `MW foreign ${stamp}`,
      categoryKey: "other",
      categoryLabelBg: "Друго",
      categoryLabelEn: "Other",
      reportedByEmployeeId: manager.employeeId,
      assigneeId: otherTech.employeeId,
      status: TicketStatus.new,
    },
  });
  const ticketResolved = await prisma.maintenanceTicket.create({
    data: {
      locationId: locOwn.id,
      title: `MW resolved ${stamp}`,
      categoryKey: "other",
      categoryLabelBg: "Друго",
      categoryLabelEn: "Other",
      reportedByEmployeeId: manager.employeeId,
      assigneeId: technician.employeeId,
      status: TicketStatus.resolved,
      resolvedAt: new Date(),
      resolvedByEmployeeId: technician.employeeId,
    },
  });
  const ticketClosed = await prisma.maintenanceTicket.create({
    data: {
      locationId: locOwn.id,
      title: `MW closed ${stamp}`,
      categoryKey: "other",
      categoryLabelBg: "Друго",
      categoryLabelEn: "Other",
      reportedByEmployeeId: manager.employeeId,
      assigneeId: technician.employeeId,
      status: TicketStatus.closed,
      closedAt: new Date(),
      closedByEmployeeId: technician.employeeId,
    },
  });
  // Extra rooms so dayD can hold foreign-assignee + terminal controls without
  // colliding with the one-active-task-per-room/date unique index.
  const locForeignAssignee = await mkLoc("MWF");
  const locCompleted = await mkLoc("MWC");
  const locCancelled = await mkLoc("MWK");
  await prisma.sectorLocation.createMany({
    data: [
      { sectorId: sectorOwn.id, locationId: locForeignAssignee.id },
      { sectorId: sectorOwn.id, locationId: locCompleted.id },
      { sectorId: sectorOwn.id, locationId: locCancelled.id },
    ],
  });

  const taskForeignAssignee = await prisma.cleaningTask.create({
    data: {
      locationId: locForeignAssignee.id,
      sectorId: sectorOwn.id,
      sectorSupervisorEmployeeId: supervisor.employeeId,
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      status: "assigned",
      assignedEmployeeId: otherHk.employeeId,
      shiftId: morning.id,
      cleaningCycle: locForeignAssignee.cleaningCycle,
    },
  });
  const taskCompleted = await prisma.cleaningTask.create({
    data: {
      locationId: locCompleted.id,
      sectorId: sectorOwn.id,
      sectorSupervisorEmployeeId: supervisor.employeeId,
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      status: "completed",
      assignedEmployeeId: housekeeper.employeeId,
      shiftId: morning.id,
      cleaningCycle: locCompleted.cleaningCycle,
    },
  });
  const taskCancelled = await prisma.cleaningTask.create({
    data: {
      locationId: locCancelled.id,
      sectorId: sectorOwn.id,
      sectorSupervisorEmployeeId: supervisor.employeeId,
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      status: "cancelled",
      assignedEmployeeId: housekeeper.employeeId,
      shiftId: morning.id,
      cleaningCycle: locCancelled.cleaningCycle,
    },
  });

  const locTechClean = await mkLoc("MWT");
  await prisma.sectorLocation.create({
    data: { sectorId: sectorOwn.id, locationId: locTechClean.id },
  });
  const cleaningForTech = await prisma.cleaningTask.create({
    data: {
      locationId: locTechClean.id,
      sectorId: sectorOwn.id,
      sectorSupervisorEmployeeId: supervisor.employeeId,
      hotelDate: new Date(`${dayD}T00:00:00.000Z`),
      status: "assigned",
      assignedEmployeeId: housekeeper.employeeId,
      // Evening so morning-filter suites stay exact; still present for tech empty-queue proof.
      shiftId: evening.id,
      cleaningCycle: locTechClean.cleaningCycle,
    },
  });

  return {
    stamp,
    password,
    propertyId: property.id,
    buildingId: building.id,
    floorId: floor.id,
    supervisor,
    housekeeper,
    otherHk,
    technician,
    otherTech,
    manager,
    sectorOwnId: sectorOwn.id,
    sectorOtherId: sectorOther.id,
    locOwnId: locOwn.id,
    locOtherId: locOther.id,
    locNullId: locNull.id,
    shiftMorningId: morning.id,
    shiftEveningId: evening.id,
    dayD,
    dayD2,
    taskMorningId: tm.id,
    taskNullShiftId: tn.id,
    taskEveningId: te.id,
    taskOtherDayId: tOtherDay.id,
    taskForeignSectorId: tForeignSnap.id,
    ticketOwnOpenId: ticketOwnOpen.id,
    ticketOwnAssignedId: ticketOwnAssigned.id,
    ticketOwnInProgressId: ticketOwnInProgress.id,
    ticketOwnWaitingId: ticketOwnWaiting.id,
    ticketForeignOpenId: ticketForeign.id,
    ticketOwnResolvedId: ticketResolved.id,
    ticketOwnClosedId: ticketClosed.id,
    taskForeignAssigneeId: taskForeignAssignee.id,
    taskCompletedId: taskCompleted.id,
    taskCancelledId: taskCancelled.id,
    cleaningForTechId: cleaningForTech.id,
  };
}

export async function cleanupMyWorkWorld(
  prisma: PrismaClient,
  world: MyWorkWorld,
): Promise<void> {
  const locIds = (
    await prisma.location.findMany({
      where: { floorId: world.floorId },
      select: { id: true },
    })
  ).map((l) => l.id);
  await prisma.cleaningSession.deleteMany({
    where: { task: { locationId: { in: locIds } } },
  });
  await prisma.inspection.deleteMany({
    where: { task: { locationId: { in: locIds } } },
  });
  await prisma.cleaningTask.deleteMany({ where: { locationId: { in: locIds } } });
  await prisma.ticketEvent.deleteMany({
    where: { ticket: { locationId: { in: locIds } } },
  });
  await prisma.maintenanceTicket.deleteMany({
    where: { locationId: { in: locIds } },
  });
  await prisma.employeeShiftRoster.deleteMany({
    where: {
      employeeId: {
        in: [
          world.housekeeper.employeeId,
          world.otherHk.employeeId,
          world.technician.employeeId,
        ],
      },
    },
  });
  await prisma.sectorLocation.deleteMany({
    where: { locationId: { in: locIds } },
  });
  await prisma.location.deleteMany({ where: { id: { in: locIds } } });
  await prisma.sector.deleteMany({
    where: { id: { in: [world.sectorOwnId, world.sectorOtherId] } },
  });
  await prisma.cleaningTask.updateMany({
    where: {
      shiftId: { in: [world.shiftMorningId, world.shiftEveningId] },
    },
    data: { shiftId: null },
  });
  await prisma.shift.deleteMany({
    where: { id: { in: [world.shiftMorningId, world.shiftEveningId] } },
  });
  await prisma.floor.delete({ where: { id: world.floorId } });
  await prisma.building.delete({ where: { id: world.buildingId } });
  await prisma.property.delete({ where: { id: world.propertyId } });
  await cleanupEmployeeGraph(prisma, [
    world.supervisor.employeeId,
    world.housekeeper.employeeId,
    world.otherHk.employeeId,
    world.technician.employeeId,
    world.otherTech.employeeId,
    world.manager.employeeId,
  ]);
}
