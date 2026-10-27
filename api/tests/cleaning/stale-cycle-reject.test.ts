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
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { PrismaClient, TaskStatus } from "@prisma/client";
import dotenv from "dotenv";
import {
  createCleaningTask,
  inspectCleaningTask,
  startCleaningTask,
  completeCleaningSession,
} from "../../src/services/cleaning";
import { bumpDirtyAndRebindWork } from "../../src/services/cleaning/cycles";
import { prisma as appPrisma } from "../../src/db";
import { AppError } from "../../src/errors";
import {
  CLN_PASSWORD,
  cleanupCleaningWorld,
  createCleaningWorld,
  hotelTodayYmd,
  resetCleaningWork,
  type CleaningWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

describe("stale-cycle reject safety", () => {
  let world: CleaningWorld;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createCleaningWorld(prisma);
  });

  after(async () => {
    if (world) await cleanupCleaningWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("reject of non-current cycle returns 409 and does not move task to rework", async () => {
    await resetCleaningWork(prisma, world);
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });
    const started = await startCleaningTask({
      taskId: task.id,
      employeeId: world.hk1.employeeId,
      commandId: `stale-start-${Date.now()}`,
      expectedVersion: task.version,
    });
    const sessionId = started.session.id;
    const completed = await completeCleaningSession({
      sessionId,
      employeeId: world.hk1.employeeId,
      notes: "done",
      expectedVersion: started.task.version,
      commandId: `stale-complete-${Date.now()}`,
    });
    assert.equal(completed.task.status, TaskStatus.awaiting_inspection);

    // Bump location cycle so the awaiting_inspection task is stale.
    await appPrisma.$transaction(async (tx) => {
      await bumpDirtyAndRebindWork(tx, world.locationAId);
    });

    await assert.rejects(
      () =>
        inspectCleaningTask({
          taskId: completed.task.id,
          inspectorEmployeeId: world.manager.employeeId,
          commandId: `stale-reject-${Date.now()}`,
          result: "rejected",
          findings: "stale reject attempt",
          expectedVersion: completed.task.version,
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 409 &&
        err.code === "stale_cleaning_cycle",
    );

    const taskAfter = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: completed.task.id },
    });
    assert.equal(taskAfter.status, TaskStatus.awaiting_inspection);

    void CLN_PASSWORD;
  });
});
