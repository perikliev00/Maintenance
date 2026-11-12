/**
 * concurrent create∥import with Location FOR UPDATE .
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
  DailyPlanCategory,
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
// Import bindings from ../../src/errors.
import { AppError } from "../../src/errors";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  createDailyPlanEntry,
  // Execute the next setup or assertion step for this scenario.
  importDailyPlan,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/dailyPlan";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  PLAN_CONFLICT_MESSAGE,
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
  createPlanWorld,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  prepareRoom,
  // Concurrency/isolation step for the race under test.
  runWhileRowLockedBoth,
  // Execute the next setup or assertion step for this scenario.
  snapshotLocation,
  // Shape PlanWorld documents the fixture/response fields this suite touches.
  type PlanWorld,
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

// Local helper isConflict used by cases in this file.
function isConflict(err: unknown): boolean {
  // Return the arranged value/result to the caller.
  return (
    // Execute the next setup or assertion step for this scenario.
    err instanceof AppError &&
    // Execute the next setup or assertion step for this scenario.
    err.status === 409 &&
    // Execute the next setup or assertion step for this scenario.
    err.code === "conflict" &&
    // Execute the next setup or assertion step for this scenario.
    err.message === PLAN_CONFLICT_MESSAGE
  );
}

// Suite: daily plan create/import race.
describe("daily plan create/import race", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: PlanWorld;
  // Execute the next setup or assertion step for this scenario.
  let today: string;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createPlanWorld(prisma);
    // Await async work before asserting or releasing locks.
    today = await hotelTodayYmd();
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
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

  // Case: serial: manual then import skips.
  it("serial: manual then import skips", async () => {
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, world.locationAId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
    });
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationAId, today);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await createDailyPlanEntry({
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      category: "arrival",
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.owner.employeeId,
    });
    // imp: synchronize actors so the race window is observable.
    const imp = await importDailyPlan(
      {
        // Execute the next setup or assertion step for this scenario.
        hotelDate: today,
        // Execute the next setup or assertion step for this scenario.
        sourceLabel: "t51-serial-mi",
        // Execute the next setup or assertion step for this scenario.
        entries: [
          {
            // Execute the next setup or assertion step for this scenario.
            buildingCode: world.buildingCode,
            // Execute the next setup or assertion step for this scenario.
            roomNumber: world.roomANumber,
            // Execute the next setup or assertion step for this scenario.
            category: DailyPlanCategory.arrival,
            // Execute the next setup or assertion step for this scenario.
            externalId: `t51-mi-${world.stamp}`,
          },
        ],
      },
      // Execute the next setup or assertion step for this scenario.
      world.owner.employeeId,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(imp.batch.createdCount, 0);
    // Assert the observed value matches the intended post-condition.
    assert.equal(imp.batch.skippedCount, 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(imp.batch.errorCount, 0);
  });

  // Case: serial: import then manual → 409.
  it("serial: import then manual → 409", async () => {
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, world.locationBId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
    });
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationBId, today);
    // Await async work before asserting or releasing locks.
    await importDailyPlan(
      {
        // Execute the next setup or assertion step for this scenario.
        hotelDate: today,
        // Execute the next setup or assertion step for this scenario.
        sourceLabel: "t51-serial-im",
        // Execute the next setup or assertion step for this scenario.
        entries: [
          {
            // Execute the next setup or assertion step for this scenario.
            buildingCode: world.buildingCode,
            // Execute the next setup or assertion step for this scenario.
            roomNumber: world.roomBNumber,
            // Execute the next setup or assertion step for this scenario.
            category: DailyPlanCategory.arrival,
            // Execute the next setup or assertion step for this scenario.
            externalId: `t51-im-${world.stamp}`,
          },
        ],
      },
      // Execute the next setup or assertion step for this scenario.
      world.owner.employeeId,
    );
    // Await async work before asserting or releasing locks.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        createDailyPlanEntry({
          // Execute the next setup or assertion step for this scenario.
          hotelDate: today,
          // Execute the next setup or assertion step for this scenario.
          locationId: world.locationBId,
          // Execute the next setup or assertion step for this scenario.
          category: "arrival",
          // Execute the next setup or assertion step for this scenario.
          createdByEmployeeId: world.owner.employeeId,
        }),
      // Execute the next setup or assertion step for this scenario.
      (err: unknown) => isConflict(err),
    );
  });

  // Case probes concurrency/isolation: concurrent arrival create∥import (no prior task).
  it("concurrent arrival create∥import (no prior task)", async () => {
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, world.locationAId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: 10,
    });
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationAId, today);
    // c0: synchronize actors so the race window is observable.
    const c0 = (await snapshotLocation(prisma, world.locationAId))
      // Continue the call chain for setup or assertion detail.
      .cleaningCycle;

    // Await async work before asserting or releasing locks.
    const { resultA, resultB } = await runWhileRowLockedBoth({
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      startA: () =>
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        createDailyPlanEntry({
          // Execute the next setup or assertion step for this scenario.
          hotelDate: today,
          // Execute the next setup or assertion step for this scenario.
          locationId: world.locationAId,
          // Execute the next setup or assertion step for this scenario.
          category: "arrival",
          // Execute the next setup or assertion step for this scenario.
          createdByEmployeeId: world.owner.employeeId,
        }),
      // Execute the next setup or assertion step for this scenario.
      startB: () =>
        // Execute the next setup or assertion step for this scenario.
        importDailyPlan(
          {
            // Execute the next setup or assertion step for this scenario.
            hotelDate: today,
            // Concurrency/isolation step for the race under test.
            sourceLabel: "t51a-race",
            // Execute the next setup or assertion step for this scenario.
            entries: [
              {
                // Execute the next setup or assertion step for this scenario.
                buildingCode: world.buildingCode,
                // Execute the next setup or assertion step for this scenario.
                roomNumber: world.roomANumber,
                // Execute the next setup or assertion step for this scenario.
                category: DailyPlanCategory.arrival,
                // Execute the next setup or assertion step for this scenario.
                externalId: `t51a-${world.stamp}`,
              },
            ],
          },
          // Execute the next setup or assertion step for this scenario.
          world.owner.employeeId,
        ),
    });

    // Bind createOk for later setup or assertions in this scope.
    const createOk = resultA.status === "fulfilled";
    // Bind createConflict for later setup or assertions in this scope.
    const createConflict =
      // Execute the next setup or assertion step for this scenario.
      resultA.status === "rejected" && isConflict(resultA.reason);
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      createOk || createConflict,
      // Execute the next setup or assertion step for this scenario.
      `create outcome unexpected: ${JSON.stringify(resultA)}`,
    );

    // Assert HTTP status matches the contract for this path.
    assert.equal(resultB.status, "fulfilled", JSON.stringify(resultB));
    // Bind batch for later setup or assertions in this scope.
    const batch = (
      // Execute the next setup or assertion step for this scenario.
      resultB as PromiseFulfilledResult<
        // Execute the next setup or assertion step for this scenario.
        Awaited<ReturnType<typeof importDailyPlan>>
      >
    // Execute the next setup or assertion step for this scenario.
    ).value.batch;

    // Conditional path for setup, cleanup, or alternate outcomes.
    if (createOk) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.createdCount, 0);
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.skippedCount, 1);
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.errorCount, 0);
    // Execute the next setup or assertion step for this scenario.
    } else {
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.createdCount, 1);
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.skippedCount, 0);
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.errorCount, 0);
    }

    // entries: synchronize actors so the race window is observable.
    const entries = await prisma.dailyPlanEntry.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${today}T00:00:00.000Z`),
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        category: DailyPlanCategory.arrival,
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(entries, 1);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);
    // loc: synchronize actors so the race window is observable.
    const loc = await snapshotLocation(prisma, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningCycle, c0 + 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.occupancy, Occupancy.vacant);
  });

  // Case probes concurrency/isolation: concurrent departure create∥import with preexisting task.
  it("concurrent departure create∥import with preexisting task", async () => {
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, world.locationAId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: 20,
    });
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationAId, today);
    // preexisting: seeded entity required before the mutation under test.
    const preexisting = await createActiveTask(prisma, {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      hotelDateYmd: today,
      // Execute the next setup or assertion step for this scenario.
      priority: Priority.normal,
    });
    // c0: synchronize actors so the race window is observable.
    const c0 = (await snapshotLocation(prisma, world.locationAId))
      // Continue the call chain for setup or assertion detail.
      .cleaningCycle;

    // Await async work before asserting or releasing locks.
    const { resultA, resultB } = await runWhileRowLockedBoth({
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      startA: () =>
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        createDailyPlanEntry({
          // Execute the next setup or assertion step for this scenario.
          hotelDate: today,
          // Execute the next setup or assertion step for this scenario.
          locationId: world.locationAId,
          // Execute the next setup or assertion step for this scenario.
          category: "departure",
          // Execute the next setup or assertion step for this scenario.
          createdByEmployeeId: world.owner.employeeId,
        }),
      // Execute the next setup or assertion step for this scenario.
      startB: () =>
        // Execute the next setup or assertion step for this scenario.
        importDailyPlan(
          {
            // Execute the next setup or assertion step for this scenario.
            hotelDate: today,
            // Concurrency/isolation step for the race under test.
            sourceLabel: "t51b-race",
            // Execute the next setup or assertion step for this scenario.
            entries: [
              {
                // Execute the next setup or assertion step for this scenario.
                buildingCode: world.buildingCode,
                // Execute the next setup or assertion step for this scenario.
                roomNumber: world.roomANumber,
                // Execute the next setup or assertion step for this scenario.
                category: DailyPlanCategory.departure,
                // Execute the next setup or assertion step for this scenario.
                externalId: `t51b-${world.stamp}`,
              },
            ],
          },
          // Execute the next setup or assertion step for this scenario.
          world.owner.employeeId,
        ),
    });

    // Bind createOk for later setup or assertions in this scope.
    const createOk = resultA.status === "fulfilled";
    // Bind createConflict for later setup or assertions in this scope.
    const createConflict =
      // Execute the next setup or assertion step for this scenario.
      resultA.status === "rejected" && isConflict(resultA.reason);
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      createOk || createConflict,
      // Execute the next setup or assertion step for this scenario.
      `create outcome unexpected: ${JSON.stringify(resultA)}`,
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(resultB.status, "fulfilled", JSON.stringify(resultB));
    // Bind batch for later setup or assertions in this scope.
    const batch = (
      // Execute the next setup or assertion step for this scenario.
      resultB as PromiseFulfilledResult<
        // Execute the next setup or assertion step for this scenario.
        Awaited<ReturnType<typeof importDailyPlan>>
      >
    // Execute the next setup or assertion step for this scenario.
    ).value.batch;

    // Conditional path for setup, cleanup, or alternate outcomes.
    if (createOk) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.createdCount, 0);
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.skippedCount, 1);
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.errorCount, 0);
    // Execute the next setup or assertion step for this scenario.
    } else {
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.createdCount, 1);
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.skippedCount, 0);
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.errorCount, 0);
    }

    // entries: synchronize actors so the race window is observable.
    const entries = await prisma.dailyPlanEntry.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${today}T00:00:00.000Z`),
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        category: DailyPlanCategory.departure,
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(entries, 1);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);
    // task: synchronize actors so the race window is observable.
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: preexisting.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.priority, Priority.high);
    // loc: synchronize actors so the race window is observable.
    const loc = await snapshotLocation(prisma, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningCycle, c0 + 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.occupancy, Occupancy.vacant);
  });
});
