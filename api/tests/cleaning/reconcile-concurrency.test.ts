/**
 * Explicit reconcile must not overwrite a newer valid cleaningStatus.
 */
import assert from "node:assert/strict";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Import bindings from node:path.
import path from "node:path";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { CleaningStatus, PrismaClient, TaskStatus } from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  createCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  startCleaningTask,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/cleaning";
// Import bindings from ../../src/services/locations/reconcileCleaningStatus.
import { reconcileOrphanCleaningStatusForLocation } from "../../src/services/locations/reconcileCleaningStatus";
// Import module bindings used by this suite.
import {
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

// Suite: reconcile cleaningStatus concurrency.
describe("reconcile cleaningStatus concurrency", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: CleaningWorld;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma);
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await resetCleaningWork(prisma, world);
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupCleaningWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: reconcile is a no-op after a valid start (running session).
  it("reconcile is a no-op after a valid start (running session)", async () => {
    // today: synchronize actors so the race window is observable.
    const today = await hotelTodayYmd();
    // Await async work before asserting or releasing locks.
    await prisma.location.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
      // Execute the next setup or assertion step for this scenario.
      data: { cleaningStatus: CleaningStatus.dirty },
    });

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
    // Await async work before asserting or releasing locks.
    await startCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: task.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: task.version,
    });

    // afterStart: synchronize actors so the race window is observable.
    const afterStart = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(afterStart.cleaningStatus, CleaningStatus.in_progress);

    // result: synchronize actors so the race window is observable.
    const result = await reconcileOrphanCleaningStatusForLocation(
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.updated, false);
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.cleaningStatus, CleaningStatus.in_progress);

    // still: synchronize actors so the race window is observable.
    const still = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: task.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(still.status, TaskStatus.in_progress);
  });

  // Case: reconcile heals true orphan then start can set in_progress.
  it("reconcile heals true orphan then start can set in_progress", async () => {
    // Await async work before asserting or releasing locks.
    await prisma.location.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
      // Execute the next setup or assertion step for this scenario.
      data: { cleaningStatus: CleaningStatus.in_progress },
    });

    // healed: synchronize actors so the race window is observable.
    const healed = await reconcileOrphanCleaningStatusForLocation(
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(healed.updated, true);
    // Assert the observed value matches the intended post-condition.
    assert.equal(healed.cleaningStatus, CleaningStatus.dirty);

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
    // Await async work before asserting or releasing locks.
    await startCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: task.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: task.version,
    });

    // loc: synchronize actors so the race window is observable.
    const loc = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningStatus, CleaningStatus.in_progress);

    // noop: synchronize actors so the race window is observable.
    const noop = await reconcileOrphanCleaningStatusForLocation(
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(noop.updated, false);
  });

  // Case probes concurrency/isolation: parallel start + reconcile leaves valid in_progress.
  it("parallel start + reconcile leaves valid in_progress", async () => {
    // today: synchronize actors so the race window is observable.
    const today = await hotelTodayYmd();
    // Await async work before asserting or releasing locks.
    await prisma.location.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
      // Execute the next setup or assertion step for this scenario.
      data: { cleaningStatus: CleaningStatus.dirty },
    });
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

    // settled: capture concurrent outcomes for race assertions.
    const settled = await Promise.allSettled([
      // Execute the next setup or assertion step for this scenario.
      startCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk1.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
      }),
      // Execute the next setup or assertion step for this scenario.
      reconcileOrphanCleaningStatusForLocation(world.locationAId),
      // Execute the next setup or assertion step for this scenario.
      reconcileOrphanCleaningStatusForLocation(world.locationAId),
    ]);
    // Bind startOk for later setup or assertions in this scope.
    const startOk = settled[0];
    // Assert HTTP status matches the contract for this path.
    assert.equal(startOk.status, "fulfilled", "start must succeed");

    // loc: synchronize actors so the race window is observable.
    const loc = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      loc.cleaningStatus,
      // Execute the next setup or assertion step for this scenario.
      CleaningStatus.in_progress,
      // Execute the next setup or assertion step for this scenario.
      "valid in_progress must survive overlapping reconcile",
    );
    // running: synchronize actors so the race window is observable.
    const running = await prisma.cleaningSession.findFirst({
      // SQL fragment used to observe locks or assert DB state.
      where: { taskId: task.id, status: "running" },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(running);
  });

  // Case: CAS updateMany refuses when expected cleaningStatus no longer matches.
  it("CAS updateMany refuses when expected cleaningStatus no longer matches", async () => {
    // Await async work before asserting or releasing locks.
    await prisma.location.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
      // Execute the next setup or assertion step for this scenario.
      data: { cleaningStatus: CleaningStatus.in_progress },
    });
    // Another writer already moved the row (simulates lost update race).
    await prisma.location.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
      // Execute the next setup or assertion step for this scenario.
      data: { cleaningStatus: CleaningStatus.dirty },
    });
    // cas: synchronize actors so the race window is observable.
    const cas = await prisma.location.updateMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        id: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        cleaningStatus: CleaningStatus.in_progress,
      },
      // Execute the next setup or assertion step for this scenario.
      data: { cleaningStatus: CleaningStatus.dirty },
    });
    // Assert collection size matches the expected post-condition.
    assert.equal(cas.count, 0);
    // loc: synchronize actors so the race window is observable.
    const loc = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
  });
});
