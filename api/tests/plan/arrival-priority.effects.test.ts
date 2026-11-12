/**
 * 54 — arrival / priority plan effects (54).
 */
import assert from "node:assert/strict";
// Import bindings from node:path.
import path from "node:path";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CleaningStatus,
  // Execute the next setup or assertion step for this scenario.
  Occupancy,
  // Execute the next setup or assertion step for this scenario.
  Priority,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import bindings from ../../src/services/dailyPlan.
import { createDailyPlanEntry } from "../../src/services/dailyPlan";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cancelActiveTasks,
  // Execute the next setup or assertion step for this scenario.
  cleanupPlanArtifacts,
  // Execute the next setup or assertion step for this scenario.
  cleanupPlanWorld,
  // Execute the next setup or assertion step for this scenario.
  countActiveTasks,
  // Execute the next setup or assertion step for this scenario.
  createActiveTask,
  // Execute the next setup or assertion step for this scenario.
  createExtraHousekeeper,
  // Execute the next setup or assertion step for this scenario.
  createPlanWorld,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  prepareRoom,
  // Execute the next setup or assertion step for this scenario.
  snapshotLocation,
  // Shape PlanWorld documents the fixture/response fields this suite touches.
  type PlanWorld,
  // Execute the next setup or assertion step for this scenario.
  cleanupEmployeeGraph,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Execute the next setup or assertion step for this scenario.
dotenv.config({
  // Execute the next setup or assertion step for this scenario.
  path: path.resolve(__dirname, "../../.env"),
  // Execute the next setup or assertion step for this scenario.
  override: true,
});

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: daily plan arrival/priority effects (54 / 54).
describe("daily plan arrival/priority effects (54 / 54)", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: PlanWorld;
  // Execute the next setup or assertion step for this scenario.
  let today: string;
  // Execute the next setup or assertion step for this scenario.
  let hkA2: Awaited<ReturnType<typeof createExtraHousekeeper>>;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createPlanWorld(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    hkA2 = await createExtraHousekeeper(prisma, world.stamp, "A2");
    // Await async work before asserting or releasing locks.
    today = await hotelTodayYmd();
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (hkA2) await cleanupEmployeeGraph(prisma, [hkA2.employeeId]);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupPlanWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await cleanupPlanArtifacts(prisma, [
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      world.locationBId,
      // Execute the next setup or assertion step for this scenario.
      world.locationCId,
      // Execute the next setup or assertion step for this scenario.
      world.archivedLocationId,
    ]);
  });

  // Case: arrival on dirty room creates high-priority task.
  it("arrival on dirty room creates high-priority task", async () => {
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, world.locationAId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.occupied,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
    });
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationAId, today);

    // result: seeded entity required before the mutation under test.
    const result = await createDailyPlanEntry({
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      category: "arrival",
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.owner.employeeId,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.effects.task, "created");
    // Assert the observed value matches the intended post-condition.
    assert.ok(result.effects.cleaningTaskId);
    // task: synchronize actors so the race window is observable.
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: result.effects.cleaningTaskId! },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.priority, Priority.high);
    // loc: synchronize actors so the race window is observable.
    const loc = await snapshotLocation(prisma, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.occupancy, Occupancy.occupied);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);
  });

  // Case: arrival bumps existing normal task to high.
  it("arrival bumps existing normal task to high", async () => {
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, world.locationAId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.occupied,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
    });
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationAId, today);
    // existing: seeded entity required before the mutation under test.
    const existing = await createActiveTask(prisma, {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      hotelDateYmd: today,
      // Execute the next setup or assertion step for this scenario.
      priority: Priority.normal,
    });

    // result: seeded entity required before the mutation under test.
    const result = await createDailyPlanEntry({
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      category: "arrival",
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.owner.employeeId,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.effects.task, "bumped");
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.effects.cleaningTaskId, existing.id);
    // task: synchronize actors so the race window is observable.
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: existing.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.priority, Priority.high);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      (await snapshotLocation(prisma, world.locationAId)).occupancy,
      // Execute the next setup or assertion step for this scenario.
      Occupancy.occupied,
    );
    // Assert collection size matches the expected post-condition.
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);
  });

  // Case: arrival on verified_clean skips task.
  it("arrival on verified_clean skips task", async () => {
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, world.locationAId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.verified_clean,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: 5,
    });
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationAId, today);
    // before: synchronize actors so the race window is observable.
    const before = await snapshotLocation(prisma, world.locationAId);

    // result: seeded entity required before the mutation under test.
    const result = await createDailyPlanEntry({
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      category: "arrival",
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.owner.employeeId,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.effects.task, "skipped");
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.effects.cleaningTaskId, null);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 0);
    // after: synchronize actors so the race window is observable.
    const after = await snapshotLocation(prisma, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.occupancy, before.occupancy);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.cleaningStatus, before.cleaningStatus);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.cleaningCycle, before.cleaningCycle);
  });

  // Case: priority creates urgent task with assignee/shift.
  it("priority creates urgent task with assignee/shift", async () => {
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, world.locationAId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.occupied,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
    });
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationAId, today);

    // result: seeded entity required before the mutation under test.
    const result = await createDailyPlanEntry({
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      category: "priority",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: world.shiftId,
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.owner.employeeId,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.effects.task, "created");
    // task: synchronize actors so the race window is observable.
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: result.effects.cleaningTaskId! },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.priority, Priority.urgent);
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.assignedEmployeeId, world.hk1.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.shiftId, world.shiftId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      (await snapshotLocation(prisma, world.locationAId)).occupancy,
      // Execute the next setup or assertion step for this scenario.
      Occupancy.occupied,
    );
  });

  // Case: priority bumps high→urgent and preserves assignee/shift.
  it("priority bumps high→urgent and preserves assignee/shift", async () => {
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, world.locationAId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
    });
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationAId, today);
    // existing: seeded entity required before the mutation under test.
    const existing = await createActiveTask(prisma, {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      hotelDateYmd: today,
      // Execute the next setup or assertion step for this scenario.
      priority: Priority.high,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: world.shiftId,
    });

    // result: seeded entity required before the mutation under test.
    const result = await createDailyPlanEntry({
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      category: "priority",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: hkA2.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: world.shift2Id,
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.owner.employeeId,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.effects.task, "bumped");
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.effects.cleaningTaskId, existing.id);
    // task: synchronize actors so the race window is observable.
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: existing.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.priority, Priority.urgent);
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.assignedEmployeeId, world.hk1.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.shiftId, world.shiftId);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);
  });

  // Case: priority links urgent task without downgrade or overwrite.
  it("priority links urgent task without downgrade or overwrite", async () => {
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, world.locationAId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
    });
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationAId, today);
    // existing: seeded entity required before the mutation under test.
    const existing = await createActiveTask(prisma, {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      hotelDateYmd: today,
      // Execute the next setup or assertion step for this scenario.
      priority: Priority.urgent,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: world.shiftId,
    });

    // result: seeded entity required before the mutation under test.
    const result = await createDailyPlanEntry({
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      category: "priority",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: hkA2.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: world.shift2Id,
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.owner.employeeId,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.effects.task, "linked");
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.effects.cleaningTaskId, existing.id);
    // task: synchronize actors so the race window is observable.
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: existing.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.priority, Priority.urgent);
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.assignedEmployeeId, world.hk1.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.shiftId, world.shiftId);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);
  });
});
