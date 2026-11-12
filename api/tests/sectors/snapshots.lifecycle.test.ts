/**
 * historical vs current sector snapshots.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { DailyPlanCategory, PrismaClient, Role } from "@prisma/client";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  createCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  reassignCleaningTask,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/cleaning/tasks";
// Import bindings from ../../src/services/dailyPlan.
import { createDailyPlanEntry } from "../../src/services/dailyPlan";
// Import bindings from ../../src/services/sectors/membership.
import { replaceMembership } from "../../src/services/sectors/membership";
// Type-only import from ../../src/services/dataScope for compile-time contracts.
import type { DataScope } from "../../src/services/dataScope";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupSectorsWorld,
  // Execute the next setup or assertion step for this scenario.
  createSectorsWorld,
  // Execute the next setup or assertion step for this scenario.
  resetSectorMemberships,
  // Concurrency/isolation step for the race under test.
  runWhileLocationLockedWithTx,
  // Execute the next setup or assertion step for this scenario.
  setSectorLocationsAtHead,
  // Execute the next setup or assertion step for this scenario.
  updateSectorAtHead,
  // Shape SectorsWorld documents the fixture/response fields this suite touches.
  type SectorsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Local helper allScope used by cases in this file.
function allScope(employeeId: string): DataScope {
  // Return the arranged value/result to the caller.
  return { kind: "all", employeeId, role: Role.manager, sectorIds: [] };
}

// Suite: sector snapshots lifecycle.
describe("sector snapshots lifecycle", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: SectorsWorld;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createSectorsWorld(prisma);
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupSectorsWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await resetSectorMemberships(prisma, world);
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: {
          // Execute the next setup or assertion step for this scenario.
          in: [
            // Execute the next setup or assertion step for this scenario.
            world.loc1Id,
            // Execute the next setup or assertion step for this scenario.
            world.loc2Id,
            // Execute the next setup or assertion step for this scenario.
            world.loc3Id,
            // Execute the next setup or assertion step for this scenario.
            world.loc4Id,
            // Execute the next setup or assertion step for this scenario.
            world.loc5Id,
          ],
        },
      },
    });
    // Await async work before asserting or releasing locks.
    await prisma.dailyPlanEntry.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: {
          // Execute the next setup or assertion step for this scenario.
          in: [
            // Execute the next setup or assertion step for this scenario.
            world.loc1Id,
            // Execute the next setup or assertion step for this scenario.
            world.loc2Id,
            // Execute the next setup or assertion step for this scenario.
            world.loc3Id,
            // Execute the next setup or assertion step for this scenario.
            world.loc4Id,
            // Execute the next setup or assertion step for this scenario.
            world.loc5Id,
          ],
        },
      },
    });
  });

  // Case: freeze after move + supervisor change.
  it("freeze after move + supervisor change", async () => {
    // task: seeded entity required before the mutation under test.
    const task = await createCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: "2099-10-01",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.sectorId, world.sectorA1Id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      task.sectorSupervisorEmployeeId,
      // Execute the next setup or assertion step for this scenario.
      world.supervisorA.employeeId,
    );

    // Await async work before asserting or releasing locks.
    await setSectorLocationsAtHead(prisma, world.sectorA2Id, [world.loc1Id, world.loc3Id], {
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      scope: allScope(world.manager.employeeId),
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: true,
    });
    // Await async work before asserting or releasing locks.
    await updateSectorAtHead(prisma, world.sectorA1Id, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });

    // row: synchronize actors so the race window is observable.
    const row = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: task.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.sectorId, world.sectorA1Id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.sectorSupervisorEmployeeId, world.supervisorA.employeeId);

    // live: synchronize actors so the race window is observable.
    const live = await prisma.sectorLocation.findUnique({
      // SQL fragment used to observe locks or assert DB state.
      where: { locationId: world.loc1Id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(live?.sectorId, world.sectorA2Id);
    // Assert the observed value matches the intended post-condition.
    assert.notEqual(row.sectorId, live?.sectorId);
  });

  // Case: reassign does not overwrite stamped snapshots.
  it("reassign does not overwrite stamped snapshots", async () => {
    // task: seeded entity required before the mutation under test.
    const task = await createCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: "2099-10-02",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });
    // Await async work before asserting or releasing locks.
    await setSectorLocationsAtHead(prisma, world.sectorA2Id, [world.loc1Id, world.loc3Id], {
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      scope: allScope(world.manager.employeeId),
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: true,
    });
    // Await async work before asserting or releasing locks.
    await updateSectorAtHead(prisma, world.sectorA1Id, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });

    // Bind hk2 for later setup or assertions in this scope.
    const hk2 = world.housekeeper;
    // Await async work before asserting or releasing locks.
    await reassignCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: task.id,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: hk2.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "reassign",
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorRole: Role.manager,
      // Execute the next setup or assertion step for this scenario.
      forceDespiteAvailability: true,
    });

    // row: synchronize actors so the race window is observable.
    const row = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: task.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.sectorId, world.sectorA1Id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.sectorSupervisorEmployeeId, world.supervisorA.employeeId);
  });

  // Case: null supervisor stays null after primary assign + reassign.
  it("null supervisor stays null after primary assign + reassign", async () => {
    // Await async work before asserting or releasing locks.
    await updateSectorAtHead(prisma, world.sectorA1Id, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: null,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });
    // task: seeded entity required before the mutation under test.
    const task = await createCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: "2099-10-03",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.sectorId, world.sectorA1Id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.sectorSupervisorEmployeeId, null);

    // Await async work before asserting or releasing locks.
    await updateSectorAtHead(prisma, world.sectorA1Id, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: world.supervisorA.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });
    // Await async work before asserting or releasing locks.
    await reassignCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: task.id,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "unnamed case",
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorRole: Role.manager,
      // Execute the next setup or assertion step for this scenario.
      forceDespiteAvailability: true,
    });

    // row: synchronize actors so the race window is observable.
    const row = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: task.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.sectorId, world.sectorA1Id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.sectorSupervisorEmployeeId, null);
  });

  // Case: unassigned-room null snapshots stay null after assign+reassign.
  it("unassigned-room null snapshots stay null after assign+reassign", async () => {
    // task: seeded entity required before the mutation under test.
    const task = await createCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.loc5Id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: "2099-10-04",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.sectorId, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.sectorSupervisorEmployeeId, null);

    // Await async work before asserting or releasing locks.
    await setSectorLocationsAtHead(prisma, 
      // Execute the next setup or assertion step for this scenario.
      world.sectorA1Id,
      // Execute the next setup or assertion step for this scenario.
      [world.loc1Id, world.loc2Id, world.loc5Id],
      {
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.manager.employeeId,
        // Execute the next setup or assertion step for this scenario.
        scope: allScope(world.manager.employeeId),
        // Delivery/replay step for async notification paths.
        allowCrossSectorTransfer: true,
      },
    );
    // Await async work before asserting or releasing locks.
    await reassignCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: task.id,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "unnamed case",
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorRole: Role.manager,
      // Execute the next setup or assertion step for this scenario.
      forceDespiteAvailability: true,
    });

    // row: synchronize actors so the race window is observable.
    const row = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: task.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.sectorId, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.sectorSupervisorEmployeeId, null);
  });

  // Case: new manual task gets current snapshot.
  it("new manual task gets current snapshot", async () => {
    // Await async work before asserting or releasing locks.
    await setSectorLocationsAtHead(prisma, world.sectorA2Id, [world.loc1Id, world.loc3Id], {
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      scope: allScope(world.manager.employeeId),
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: true,
    });
    // Await async work before asserting or releasing locks.
    await updateSectorAtHead(prisma, world.sectorA2Id, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });

    // task: seeded entity required before the mutation under test.
    const task = await createCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: "2099-10-05",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.sectorId, world.sectorA2Id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      task.sectorSupervisorEmployeeId,
      // Execute the next setup or assertion step for this scenario.
      world.supervisorB.employeeId,
    );
  });

  // Case: daily-plan create path stamps current snapshot.
  it("daily-plan create path stamps current snapshot", async () => {
    // Await async work before asserting or releasing locks.
    await setSectorLocationsAtHead(prisma, world.sectorA2Id, [world.loc1Id, world.loc3Id], {
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      scope: allScope(world.manager.employeeId),
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: true,
    });
    // Await async work before asserting or releasing locks.
    await updateSectorAtHead(prisma, world.sectorA2Id, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });

    // Bind hotelDate for later setup or assertions in this scope.
    const hotelDate = "2099-10-06";
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await createDailyPlanEntry({
      // Execute the next setup or assertion step for this scenario.
      hotelDate,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      category: DailyPlanCategory.departure,
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.housekeeper.employeeId,
    });

    // task: synchronize actors so the race window is observable.
    const task = await prisma.cleaningTask.findFirst({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: world.loc1Id,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${hotelDate}T00:00:00.000Z`),
        // Fixture field status for the seeded actor/entity.
        status: { notIn: ["cancelled", "completed"] },
      },
    });
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.ok(task, "expected plan-created task");
    // Assert the observed value matches the intended post-condition.
    assert.equal(task!.sectorId, world.sectorA2Id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      task!.sectorSupervisorEmployeeId,
      // Execute the next setup or assertion step for this scenario.
      world.supervisorB.employeeId,
    );
  });

  // Case probes concurrency/isolation: createCleaningTask sees membership move while blocked on Location.
  it("createCleaningTask sees membership move while blocked on Location", async () => {
    // Bind hotelDate for later setup or assertions in this scope.
    const hotelDate = "2099-10-07";
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: world.loc1Id,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${hotelDate}T00:00:00.000Z`),
      },
    });
    // Await async work before asserting or releasing locks.
    await updateSectorAtHead(prisma, world.sectorForeignId, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });

    // created: seeded entity required before the mutation under test.
    const created = await runWhileLocationLockedWithTx({
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.loc1Id,
      // Concurrency/isolation step for the race under test.
      startRace: () =>
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        createCleaningTask({
          // Execute the next setup or assertion step for this scenario.
          locationId: world.loc1Id,
          // Execute the next setup or assertion step for this scenario.
          hotelDate,
          // Execute the next setup or assertion step for this scenario.
          assignedEmployeeId: world.housekeeper.employeeId,
          // Execute the next setup or assertion step for this scenario.
          actorEmployeeId: world.manager.employeeId,
        }),
      // Concurrency/isolation step for the race under test.
      whileBlocked: async ({ tx }) => {
        // Await async work before asserting or releasing locks.
        await replaceMembership(
          // Execute the next setup or assertion step for this scenario.
          tx,
          // Execute the next setup or assertion step for this scenario.
          world.sectorForeignId,
          // Execute the next setup or assertion step for this scenario.
          [world.loc1Id, world.loc4Id],
          {
            // Execute the next setup or assertion step for this scenario.
            scope: allScope(world.manager.employeeId),
            // Delivery/replay step for async notification paths.
            allowCrossSectorTransfer: true,
          },
        );
      },
    });

    // Assert the observed value matches the intended post-condition.
    assert.ok(created?.id);
    // row: synchronize actors so the race window is observable.
    const row = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: created.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.sectorId, world.sectorForeignId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      row.sectorSupervisorEmployeeId,
      // Execute the next setup or assertion step for this scenario.
      world.supervisorB.employeeId,
    );
  });

  // Case probes concurrency/isolation: daily-plan create sees membership move while blocked on Location.
  it("daily-plan create sees membership move while blocked on Location", async () => {
    // Bind hotelDate for later setup or assertions in this scope.
    const hotelDate = "2099-10-08";
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: world.loc1Id,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${hotelDate}T00:00:00.000Z`),
      },
    });
    // Await async work before asserting or releasing locks.
    await prisma.dailyPlanEntry.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: world.loc1Id,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${hotelDate}T00:00:00.000Z`),
      },
    });
    // Await async work before asserting or releasing locks.
    await updateSectorAtHead(prisma, world.sectorForeignId, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });

    // Await async work before asserting or releasing locks.
    await runWhileLocationLockedWithTx({
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.loc1Id,
      // Concurrency/isolation step for the race under test.
      startRace: () =>
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        createDailyPlanEntry({
          // Execute the next setup or assertion step for this scenario.
          hotelDate,
          // Execute the next setup or assertion step for this scenario.
          locationId: world.loc1Id,
          // Execute the next setup or assertion step for this scenario.
          category: DailyPlanCategory.departure,
          // Execute the next setup or assertion step for this scenario.
          createdByEmployeeId: world.manager.employeeId,
          // Execute the next setup or assertion step for this scenario.
          assignedEmployeeId: world.housekeeper.employeeId,
        }),
      // Concurrency/isolation step for the race under test.
      whileBlocked: async ({ tx }) => {
        // Await async work before asserting or releasing locks.
        await replaceMembership(
          // Execute the next setup or assertion step for this scenario.
          tx,
          // Execute the next setup or assertion step for this scenario.
          world.sectorForeignId,
          // Execute the next setup or assertion step for this scenario.
          [world.loc1Id, world.loc4Id],
          {
            // Execute the next setup or assertion step for this scenario.
            scope: allScope(world.manager.employeeId),
            // Delivery/replay step for async notification paths.
            allowCrossSectorTransfer: true,
          },
        );
      },
    });

    // task: synchronize actors so the race window is observable.
    const task = await prisma.cleaningTask.findFirst({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: world.loc1Id,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${hotelDate}T00:00:00.000Z`),
        // Fixture field status for the seeded actor/entity.
        status: { notIn: ["cancelled", "completed"] },
      },
    });
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.ok(task, "expected plan-created task");
    // Assert the observed value matches the intended post-condition.
    assert.equal(task!.sectorId, world.sectorForeignId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      task!.sectorSupervisorEmployeeId,
      // Execute the next setup or assertion step for this scenario.
      world.supervisorB.employeeId,
    );
  });
});
