/**
 * Reject on a superseded cleaning cycle must fail closed (409), not leave
 * task=rework while location stays pending_inspection.
 *
 * Identification for existing divergent rows (read-only ops note):
 *   SELECT t.id, t.status, l."cleaningStatus", t."cleaningCycle", l."cleaningCycle"
 *   FROM "CleaningTask" t JOIN "Location" l ON l.id = t."locationId"
 *   WHERE t.status = 'rework' AND l."cleaningStatus" = 'pending_inspection'
 *     AND t."cleaningCycle" <> l."cleaningCycle";
 */
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Import bindings from node:path.
import path from "node:path";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient, TaskStatus } from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  createCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  inspectCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  startCleaningTask,
  // Session/CSRF step exercising auth lifecycle.
  completeCleaningSession,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/cleaning";
// Import bindings from ../../src/services/cleaning/cycles.
import { bumpDirtyAndRebindWork } from "../../src/services/cleaning/cycles";
// Import bindings from ../../src/db.
import { prisma as appPrisma } from "../../src/db";
// Import bindings from ../../src/errors.
import { AppError } from "../../src/errors";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  createCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  resetCleaningWork,
  // Shape CleaningWorld documents the fixture/response fields this suite touches.
  type CleaningWorld,
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

// Suite: stale-cycle reject safety.
describe("stale-cycle reject safety", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: CleaningWorld;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma);
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupCleaningWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: reject of non-current cycle returns 409 and does not move task to rework.
  it("reject of non-current cycle returns 409 and does not move task to rework", async () => {
    // Await async work before asserting or releasing locks.
    await resetCleaningWork(prisma, world);
    // today: synchronize actors so the race window is observable.
    const today = await hotelTodayYmd();
    // task: seeded entity required before the mutation under test.
    const task = await createCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
    });
    // started: synchronize actors so the race window is observable.
    const started = await startCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: task.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: `stale-start-${Date.now()}`,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: task.version,
    });
    // sessionId: unique stamp so parallel runs do not collide.
    const sessionId = started.session.id;
    // completed: synchronize actors so the race window is observable.
    const completed = await completeCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      notes: "done",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: started.task.version,
      // Execute the next setup or assertion step for this scenario.
      commandId: `stale-complete-${Date.now()}`,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(completed.task.status, TaskStatus.awaiting_inspection);

    // Bump location cycle so the awaiting_inspection task is stale.
    await appPrisma.$transaction(async (tx) => {
      // Await async work before asserting or releasing locks.
      await bumpDirtyAndRebindWork(tx, world.locationAId);
    });

    // Await async work before asserting or releasing locks.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Execute the next setup or assertion step for this scenario.
        inspectCleaningTask({
          // Execute the next setup or assertion step for this scenario.
          taskId: completed.task.id,
          // Execute the next setup or assertion step for this scenario.
          inspectorEmployeeId: world.manager.employeeId,
          // Execute the next setup or assertion step for this scenario.
          commandId: `stale-reject-${Date.now()}`,
          // Execute the next setup or assertion step for this scenario.
          result: "rejected",
          // Execute the next setup or assertion step for this scenario.
          findings: "stale reject attempt",
          // Execute the next setup or assertion step for this scenario.
          expectedVersion: completed.task.version,
        }),
      // Execute the next setup or assertion step for this scenario.
      (err: unknown) =>
        // Execute the next setup or assertion step for this scenario.
        err instanceof AppError &&
        // Execute the next setup or assertion step for this scenario.
        err.status === 409 &&
        // Execute the next setup or assertion step for this scenario.
        err.code === "stale_cleaning_cycle",
    );

    // taskAfter: synchronize actors so the race window is observable.
    const taskAfter = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: completed.task.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(taskAfter.status, TaskStatus.awaiting_inspection);

    // Fire-and-await side effect required before the next assertion.
    void CLN_PASSWORD;
  });
});
