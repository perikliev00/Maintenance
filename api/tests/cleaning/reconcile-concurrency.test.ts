/**
 * Explicit reconcile must not overwrite a newer valid cleaningStatus.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { CleaningStatus, PrismaClient, TaskStatus } from "@prisma/client";
import dotenv from "dotenv";
import {
  createCleaningTask,
  startCleaningTask,
} from "../../src/services/cleaning";
import { reconcileOrphanCleaningStatusForLocation } from "../../src/services/locations/reconcileCleaningStatus";
import {
  cleanupCleaningWorld,
  createCleaningWorld,
  hotelTodayYmd,
  resetCleaningWork,
  // Shape CleaningWorld documents the fixture/response fields this suite touches.
  type CleaningWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: reconcile cleaningStatus concurrency.
describe("reconcile cleaningStatus concurrency", () => {
  let world: CleaningWorld;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createCleaningWorld(prisma);
  });

  beforeEach(async () => {
    await resetCleaningWork(prisma, world);
  });

  after(async () => {
    if (world) await cleanupCleaningWorld(prisma, world);
    await prisma.$disconnect();
  });

  // Case: reconcile is a no-op after a valid start (running session).
  it("reconcile is a no-op after a valid start (running session)", async () => {
    const today = await hotelTodayYmd();
    await prisma.location.update({
      where: { id: world.locationAId },
      data: { cleaningStatus: CleaningStatus.dirty },
    });

    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });
    await startCleaningTask({
      taskId: task.id,
      employeeId: world.hk1.employeeId,
      commandId: randomUUID(),
      expectedVersion: task.version,
    });

    const afterStart = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(afterStart.cleaningStatus, CleaningStatus.in_progress);

    const result = await reconcileOrphanCleaningStatusForLocation(
      world.locationAId,
    );
    assert.equal(result.updated, false);
    assert.equal(result.cleaningStatus, CleaningStatus.in_progress);

    const still = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(still.status, TaskStatus.in_progress);
  });

  // Case: reconcile heals true orphan then start can set in_progress.
  it("reconcile heals true orphan then start can set in_progress", async () => {
    await prisma.location.update({
      where: { id: world.locationAId },
      data: { cleaningStatus: CleaningStatus.in_progress },
    });

    const healed = await reconcileOrphanCleaningStatusForLocation(
      world.locationAId,
    );
    assert.equal(healed.updated, true);
    assert.equal(healed.cleaningStatus, CleaningStatus.dirty);

    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });
    await startCleaningTask({
      taskId: task.id,
      employeeId: world.hk1.employeeId,
      commandId: randomUUID(),
      expectedVersion: task.version,
    });

    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(loc.cleaningStatus, CleaningStatus.in_progress);

    const noop = await reconcileOrphanCleaningStatusForLocation(
      world.locationAId,
    );
    assert.equal(noop.updated, false);
  });

  // Case probes concurrency/isolation: parallel start + reconcile leaves valid in_progress.
  it("parallel start + reconcile leaves valid in_progress", async () => {
    const today = await hotelTodayYmd();
    await prisma.location.update({
      where: { id: world.locationAId },
      data: { cleaningStatus: CleaningStatus.dirty },
    });
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });

    // settled: capture concurrent outcomes for race assertions.
    const settled = await Promise.allSettled([
      startCleaningTask({
        taskId: task.id,
        employeeId: world.hk1.employeeId,
        commandId: randomUUID(),
        expectedVersion: task.version,
      }),
      reconcileOrphanCleaningStatusForLocation(world.locationAId),
      reconcileOrphanCleaningStatusForLocation(world.locationAId),
    ]);
    const startOk = settled[0];
    assert.equal(startOk.status, "fulfilled", "start must succeed");

    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(
      loc.cleaningStatus,
      CleaningStatus.in_progress,
      "valid in_progress must survive overlapping reconcile",
    );
    const running = await prisma.cleaningSession.findFirst({
      where: { taskId: task.id, status: "running" },
    });
    assert.ok(running);
  });

  // Case: CAS updateMany refuses when expected cleaningStatus no longer matches.
  it("CAS updateMany refuses when expected cleaningStatus no longer matches", async () => {
    await prisma.location.update({
      where: { id: world.locationAId },
      data: { cleaningStatus: CleaningStatus.in_progress },
    });
    // Another writer already moved the row (simulates lost update race).
    await prisma.location.update({
      where: { id: world.locationAId },
      data: { cleaningStatus: CleaningStatus.dirty },
    });
    const cas = await prisma.location.updateMany({
      where: {
        id: world.locationAId,
        cleaningStatus: CleaningStatus.in_progress,
      },
      data: { cleaningStatus: CleaningStatus.dirty },
    });
    assert.equal(cas.count, 0);
    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
  });
});
