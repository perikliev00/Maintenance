/**
 * historical vs current sector snapshots.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { DailyPlanCategory, PrismaClient, Role } from "@prisma/client";
import {
  createCleaningTask,
  reassignCleaningTask,
} from "../../src/services/cleaning/tasks";
import { createDailyPlanEntry } from "../../src/services/dailyPlan";
import { replaceMembership } from "../../src/services/sectors/membership";
import type { DataScope } from "../../src/services/dataScope";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
import {
  cleanupSectorsWorld,
  createSectorsWorld,
  resetSectorMemberships,
  runWhileLocationLockedWithTx,
  setSectorLocationsAtHead,
  updateSectorAtHead,
  // Shape SectorsWorld documents the fixture/response fields this suite touches.
  type SectorsWorld,
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Local helper allScope used by cases in this file.
function allScope(employeeId: string): DataScope {
  return { kind: "all", employeeId, role: Role.manager, sectorIds: [] };
}

// Suite: sector snapshots lifecycle.
describe("sector snapshots lifecycle", () => {
  let world: SectorsWorld;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    world = await createSectorsWorld(prisma);
  });

  after(async () => {
    if (world) await cleanupSectorsWorld(prisma, world);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetSectorMemberships(prisma, world);
    await prisma.cleaningTask.deleteMany({
      where: {
        locationId: {
          in: [
            world.loc1Id,
            world.loc2Id,
            world.loc3Id,
            world.loc4Id,
            world.loc5Id,
          ],
        },
      },
    });
    await prisma.dailyPlanEntry.deleteMany({
      where: {
        locationId: {
          in: [
            world.loc1Id,
            world.loc2Id,
            world.loc3Id,
            world.loc4Id,
            world.loc5Id,
          ],
        },
      },
    });
  });

  // Case: freeze after move + supervisor change.
  it("freeze after move + supervisor change", async () => {
    const task = await createCleaningTask({
      locationId: world.loc1Id,
      hotelDate: "2099-10-01",
      assignedEmployeeId: world.housekeeper.employeeId,
      actorEmployeeId: world.manager.employeeId,
    });
    assert.equal(task.sectorId, world.sectorA1Id);
    assert.equal(
      task.sectorSupervisorEmployeeId,
      world.supervisorA.employeeId,
    );

    await setSectorLocationsAtHead(prisma, world.sectorA2Id, [world.loc1Id, world.loc3Id], {
      actorEmployeeId: world.manager.employeeId,
      scope: allScope(world.manager.employeeId),
      allowCrossSectorTransfer: true,
    });
    await updateSectorAtHead(prisma, world.sectorA1Id, {
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      actorEmployeeId: world.manager.employeeId,
    });

    const row = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(row.sectorId, world.sectorA1Id);
    assert.equal(row.sectorSupervisorEmployeeId, world.supervisorA.employeeId);

    const live = await prisma.sectorLocation.findUnique({
      where: { locationId: world.loc1Id },
    });
    assert.equal(live?.sectorId, world.sectorA2Id);
    assert.notEqual(row.sectorId, live?.sectorId);
  });

  // Case: reassign does not overwrite stamped snapshots.
  it("reassign does not overwrite stamped snapshots", async () => {
    const task = await createCleaningTask({
      locationId: world.loc1Id,
      hotelDate: "2099-10-02",
      assignedEmployeeId: world.housekeeper.employeeId,
      actorEmployeeId: world.manager.employeeId,
    });
    await setSectorLocationsAtHead(prisma, world.sectorA2Id, [world.loc1Id, world.loc3Id], {
      actorEmployeeId: world.manager.employeeId,
      scope: allScope(world.manager.employeeId),
      allowCrossSectorTransfer: true,
    });
    await updateSectorAtHead(prisma, world.sectorA1Id, {
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      actorEmployeeId: world.manager.employeeId,
    });

    const hk2 = world.housekeeper;
    await reassignCleaningTask({
      taskId: task.id,
      assignedEmployeeId: hk2.employeeId,
      reason: "reassign",
      actorEmployeeId: world.manager.employeeId,
      actorRole: Role.manager,
      forceDespiteAvailability: true,
    });

    const row = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(row.sectorId, world.sectorA1Id);
    assert.equal(row.sectorSupervisorEmployeeId, world.supervisorA.employeeId);
  });

  // Case: null supervisor stays null after primary assign + reassign.
  it("null supervisor stays null after primary assign + reassign", async () => {
    await updateSectorAtHead(prisma, world.sectorA1Id, {
      primarySupervisorEmployeeId: null,
      actorEmployeeId: world.manager.employeeId,
    });
    const task = await createCleaningTask({
      locationId: world.loc1Id,
      hotelDate: "2099-10-03",
      assignedEmployeeId: world.housekeeper.employeeId,
      actorEmployeeId: world.manager.employeeId,
    });
    assert.equal(task.sectorId, world.sectorA1Id);
    assert.equal(task.sectorSupervisorEmployeeId, null);

    await updateSectorAtHead(prisma, world.sectorA1Id, {
      primarySupervisorEmployeeId: world.supervisorA.employeeId,
      actorEmployeeId: world.manager.employeeId,
    });
    await reassignCleaningTask({
      taskId: task.id,
      assignedEmployeeId: world.housekeeper.employeeId,
      reason: "unnamed case",
      actorEmployeeId: world.manager.employeeId,
      actorRole: Role.manager,
      forceDespiteAvailability: true,
    });

    const row = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(row.sectorId, world.sectorA1Id);
    assert.equal(row.sectorSupervisorEmployeeId, null);
  });

  // Case: unassigned-room null snapshots stay null after assign+reassign.
  it("unassigned-room null snapshots stay null after assign+reassign", async () => {
    const task = await createCleaningTask({
      locationId: world.loc5Id,
      hotelDate: "2099-10-04",
      assignedEmployeeId: world.housekeeper.employeeId,
      actorEmployeeId: world.manager.employeeId,
    });
    assert.equal(task.sectorId, null);
    assert.equal(task.sectorSupervisorEmployeeId, null);

    await setSectorLocationsAtHead(prisma, 
      world.sectorA1Id,
      [world.loc1Id, world.loc2Id, world.loc5Id],
      {
        actorEmployeeId: world.manager.employeeId,
        scope: allScope(world.manager.employeeId),
        allowCrossSectorTransfer: true,
      },
    );
    await reassignCleaningTask({
      taskId: task.id,
      assignedEmployeeId: world.housekeeper.employeeId,
      reason: "unnamed case",
      actorEmployeeId: world.manager.employeeId,
      actorRole: Role.manager,
      forceDespiteAvailability: true,
    });

    const row = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(row.sectorId, null);
    assert.equal(row.sectorSupervisorEmployeeId, null);
  });

  // Case: new manual task gets current snapshot.
  it("new manual task gets current snapshot", async () => {
    await setSectorLocationsAtHead(prisma, world.sectorA2Id, [world.loc1Id, world.loc3Id], {
      actorEmployeeId: world.manager.employeeId,
      scope: allScope(world.manager.employeeId),
      allowCrossSectorTransfer: true,
    });
    await updateSectorAtHead(prisma, world.sectorA2Id, {
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      actorEmployeeId: world.manager.employeeId,
    });

    const task = await createCleaningTask({
      locationId: world.loc1Id,
      hotelDate: "2099-10-05",
      assignedEmployeeId: world.housekeeper.employeeId,
      actorEmployeeId: world.manager.employeeId,
    });
    assert.equal(task.sectorId, world.sectorA2Id);
    assert.equal(
      task.sectorSupervisorEmployeeId,
      world.supervisorB.employeeId,
    );
  });

  // Case: daily-plan create path stamps current snapshot.
  it("daily-plan create path stamps current snapshot", async () => {
    await setSectorLocationsAtHead(prisma, world.sectorA2Id, [world.loc1Id, world.loc3Id], {
      actorEmployeeId: world.manager.employeeId,
      scope: allScope(world.manager.employeeId),
      allowCrossSectorTransfer: true,
    });
    await updateSectorAtHead(prisma, world.sectorA2Id, {
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      actorEmployeeId: world.manager.employeeId,
    });

    const hotelDate = "2099-10-06";
    await createDailyPlanEntry({
      hotelDate,
      locationId: world.loc1Id,
      category: DailyPlanCategory.departure,
      createdByEmployeeId: world.manager.employeeId,
      assignedEmployeeId: world.housekeeper.employeeId,
    });

    const task = await prisma.cleaningTask.findFirst({
      where: {
        locationId: world.loc1Id,
        hotelDate: new Date(`${hotelDate}T00:00:00.000Z`),
        status: { notIn: ["cancelled", "completed"] },
      },
    });
    assert.ok(task, "expected plan-created task");
    assert.equal(task!.sectorId, world.sectorA2Id);
    assert.equal(
      task!.sectorSupervisorEmployeeId,
      world.supervisorB.employeeId,
    );
  });

  // Case probes concurrency/isolation: createCleaningTask sees membership move while blocked on Location.
  it("createCleaningTask sees membership move while blocked on Location", async () => {
    const hotelDate = "2099-10-07";
    await prisma.cleaningTask.deleteMany({
      where: {
        locationId: world.loc1Id,
        hotelDate: new Date(`${hotelDate}T00:00:00.000Z`),
      },
    });
    await updateSectorAtHead(prisma, world.sectorForeignId, {
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      actorEmployeeId: world.manager.employeeId,
    });

    // created: seeded entity required before the mutation under test.
    const created = await runWhileLocationLockedWithTx({
      prisma,
      locationId: world.loc1Id,
      startRace: () =>
        createCleaningTask({
          locationId: world.loc1Id,
          hotelDate,
          assignedEmployeeId: world.housekeeper.employeeId,
          actorEmployeeId: world.manager.employeeId,
        }),
      whileBlocked: async ({ tx }) => {
        await replaceMembership(
          tx,
          world.sectorForeignId,
          [world.loc1Id, world.loc4Id],
          {
            scope: allScope(world.manager.employeeId),
            allowCrossSectorTransfer: true,
          },
        );
      },
    });

    assert.ok(created?.id);
    const row = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: created.id },
    });
    assert.equal(row.sectorId, world.sectorForeignId);
    assert.equal(
      row.sectorSupervisorEmployeeId,
      world.supervisorB.employeeId,
    );
  });

  // Case probes concurrency/isolation: daily-plan create sees membership move while blocked on Location.
  it("daily-plan create sees membership move while blocked on Location", async () => {
    const hotelDate = "2099-10-08";
    await prisma.cleaningTask.deleteMany({
      where: {
        locationId: world.loc1Id,
        hotelDate: new Date(`${hotelDate}T00:00:00.000Z`),
      },
    });
    await prisma.dailyPlanEntry.deleteMany({
      where: {
        locationId: world.loc1Id,
        hotelDate: new Date(`${hotelDate}T00:00:00.000Z`),
      },
    });
    await updateSectorAtHead(prisma, world.sectorForeignId, {
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      actorEmployeeId: world.manager.employeeId,
    });

    await runWhileLocationLockedWithTx({
      prisma,
      locationId: world.loc1Id,
      startRace: () =>
        createDailyPlanEntry({
          hotelDate,
          locationId: world.loc1Id,
          category: DailyPlanCategory.departure,
          createdByEmployeeId: world.manager.employeeId,
          assignedEmployeeId: world.housekeeper.employeeId,
        }),
      whileBlocked: async ({ tx }) => {
        await replaceMembership(
          tx,
          world.sectorForeignId,
          [world.loc1Id, world.loc4Id],
          {
            scope: allScope(world.manager.employeeId),
            allowCrossSectorTransfer: true,
          },
        );
      },
    });

    const task = await prisma.cleaningTask.findFirst({
      where: {
        locationId: world.loc1Id,
        hotelDate: new Date(`${hotelDate}T00:00:00.000Z`),
        status: { notIn: ["cancelled", "completed"] },
      },
    });
    assert.ok(task, "expected plan-created task");
    assert.equal(task!.sectorId, world.sectorForeignId);
    assert.equal(
      task!.sectorSupervisorEmployeeId,
      world.supervisorB.employeeId,
    );
  });
});
