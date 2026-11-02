/**
 * Isolated audit repro: H-CLEAN-1 — approve after cycle bump vs reject fail-closed.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.cwd(), "package.json"));
const apiRoot = process.cwd();
const { PrismaClient, TaskStatus, CleaningStatus } = require("@prisma/client");

function imp(rel: string) {
  return import(pathToFileURL(path.join(apiRoot, rel)).href);
}

async function main() {
  const { assertTestDatabase } = await imp("tests/assertTestDatabase.ts");
  const {
    createCleaningTask,
    inspectCleaningTask,
    startCleaningTask,
    completeCleaningSession,
  } = await imp("src/services/cleaning/index.ts");
  const { bumpDirtyAndRebindWork } = await imp(
    "src/services/cleaning/cycles.ts",
  );
  const { prisma: appPrisma } = await imp("src/db.ts");
  const { AppError } = await imp("src/errors.ts");
  const {
    createCleaningWorld,
    cleanupCleaningWorld,
    hotelTodayYmd,
    resetCleaningWork,
  } = await imp("tests/cleaning/fixtures.ts");

  const prisma = new PrismaClient();
  await assertTestDatabase(prisma);
  const world = await createCleaningWorld(prisma);

  try {
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
      commandId: `audit-stale-start-${Date.now()}`,
      expectedVersion: task.version,
    });
    const completed = await completeCleaningSession({
      sessionId: started.session.id,
      employeeId: world.hk1.employeeId,
      notes: "done",
      expectedVersion: started.task.version,
      commandId: `audit-stale-complete-${Date.now()}`,
    });
    assert.equal(completed.task.status, TaskStatus.awaiting_inspection);

    await appPrisma.$transaction(async (tx: unknown) => {
      await bumpDirtyAndRebindWork(tx, world.locationAId);
    });

    const locAfterDirty = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });

    // Reject must 409 (existing regression).
    let rejectThrew = false;
    try {
      await inspectCleaningTask({
        taskId: completed.task.id,
        inspectorEmployeeId: world.manager.employeeId,
        commandId: `audit-stale-reject-${Date.now()}`,
        result: "rejected",
        findings: "stale reject",
        expectedVersion: completed.task.version,
      });
    } catch (err) {
      rejectThrew =
        err instanceof AppError &&
        err.status === 409 &&
        err.code === "stale_cleaning_cycle";
    }
    assert.equal(rejectThrew, true, "reject negative control: 409");

    // Approve on stale cycle (same task still awaiting_inspection).
    const approved = await inspectCleaningTask({
      taskId: completed.task.id,
      inspectorEmployeeId: world.manager.employeeId,
      commandId: `audit-stale-approve-${Date.now()}`,
      result: "approved",
      expectedVersion: completed.task.version,
    });

    const taskAfter = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: completed.task.id },
    });
    const locAfter = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });

    console.log(
      JSON.stringify({
        locAfterDirty: {
          cleaningStatus: locAfterDirty.cleaningStatus,
          cleaningCycle: locAfterDirty.cleaningCycle,
          taskCycle: completed.task.cleaningCycle,
        },
        approve: {
          taskStatus: taskAfter.status,
          locationStatus: locAfter.cleaningStatus,
          locationCycle: locAfter.cleaningCycle,
          locationUpdatedHint: approved,
        },
      }),
    );

    assert.equal(taskAfter.status, TaskStatus.completed);
    assert.notEqual(
      locAfter.cleaningStatus,
      CleaningStatus.verified_clean,
      "stale approve must not restore verified_clean (documented soft guard)",
    );
    console.log(
      "H-CLEAN-1 OBSERVED: approve completes task; location stays non-verified_clean (intentional soft guard)",
    );
    console.log(
      "H-CLEAN-1 CONTRACT: reject fails closed; approve soft-skips location update — asymmetric by design in inspection.ts",
    );
  } finally {
    await cleanupCleaningWorld(prisma, world);
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
