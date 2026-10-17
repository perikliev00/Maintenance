/**
 * T-CLN-11, T-CLN-12, T-CLN-21, T-CLN-29 — cleaning concurrency invariants.
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import {
  CleaningStatus,
  PrismaClient,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import dotenv from "dotenv";
import {
  completeCleaningSession,
  createCleaningTask,
  inspectCleaningTask,
  reassignCleaningTask,
  startCleaningTask,
} from "../../src/services/cleaning";
import {
  cleanupCleaningWorld,
  countActiveTasks,
  createAndStartToday,
  createCleaningWorld,
  errCode,
  hotelTodayYmd,
  isAppError,
  resetCleaningWork,
  type CleaningWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

describe("cleaning lifecycle concurrency (T-CLN-11/12/21/29)", () => {
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

  it("T-CLN-11: concurrent create same room+day → one active task", async () => {
    const today = await hotelTodayYmd();
    const locBefore = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });

    const settled = await Promise.allSettled([
      createCleaningTask({
        locationId: world.locationAId,
        hotelDate: today,
        assignedEmployeeId: world.hk1.employeeId,
        actorEmployeeId: world.owner.employeeId,
      }),
      createCleaningTask({
        locationId: world.locationAId,
        hotelDate: today,
        assignedEmployeeId: world.hk2.employeeId,
        actorEmployeeId: world.owner.employeeId,
      }),
    ]);

    const ok = settled.filter((s) => s.status === "fulfilled");
    const fail = settled.filter((s) => s.status === "rejected");
    assert.equal(ok.length, 1, "expected exactly one successful create");
    assert.equal(fail.length, 1, "expected exactly one failed create");
    assert.ok(
      fail[0]!.status === "rejected" && isAppError(fail[0].reason),
      "loser should be AppError",
    );
    assert.equal(errCode(fail[0].reason), "conflict");

    const active = await countActiveTasks(prisma, world.locationAId, today);
    assert.equal(active, 1);

    const winner = (ok[0] as PromiseFulfilledResult<{ id: string; cleaningCycle: number }>)
      .value;
    const locAfter = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    // Fixture rooms start dirty — loser must not bump cycle or flip status.
    assert.equal(locAfter.cleaningCycle, locBefore.cleaningCycle + 1);
    assert.equal(locAfter.cleaningStatus, locBefore.cleaningStatus);
    assert.equal(locAfter.cleaningStatus, CleaningStatus.dirty);
    assert.equal(winner.cleaningCycle, locAfter.cleaningCycle);
  });

  it("T-CLN-12: concurrent start two tasks same HK → one running session", async () => {
    const today = await hotelTodayYmd();
    const taskA = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });
    const taskB = await createCleaningTask({
      locationId: world.locationBId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });

    const settled = await Promise.allSettled([
      startCleaningTask({
        taskId: taskA.id,
        employeeId: world.hk1.employeeId,
        commandId: randomUUID(),
        expectedVersion: taskA.version,
      }),
      startCleaningTask({
        taskId: taskB.id,
        employeeId: world.hk1.employeeId,
        commandId: randomUUID(),
        expectedVersion: taskB.version,
      }),
    ]);

    const ok = settled.filter((s) => s.status === "fulfilled");
    const fail = settled.filter((s) => s.status === "rejected");
    assert.equal(ok.length, 1);
    assert.equal(fail.length, 1);
    assert.equal(errCode(fail[0]!.status === "rejected" ? fail[0].reason : null), "conflict");

    const running = await prisma.cleaningSession.count({
      where: {
        employeeId: world.hk1.employeeId,
        status: SessionStatus.running,
      },
    });
    assert.equal(running, 1);
  });

  it("T-CLN-21: concurrent approve vs reject → one decision", async () => {
    const { started } = await createAndStartToday(
      world,
      world.locationAId,
      world.hk1.employeeId,
    );
    const completed = await completeCleaningSession({
      sessionId: started.session.id,
      employeeId: world.hk1.employeeId,
      commandId: randomUUID(),
      expectedVersion: started.task.version,
    });
    assert.equal(completed.task.status, TaskStatus.awaiting_inspection);

    const settled = await Promise.allSettled([
      inspectCleaningTask({
        taskId: completed.task.id,
        inspectorEmployeeId: world.manager.employeeId,
        commandId: randomUUID(),
        result: "approved",
        expectedVersion: completed.task.version,
      }),
      inspectCleaningTask({
        taskId: completed.task.id,
        inspectorEmployeeId: world.owner.employeeId,
        commandId: randomUUID(),
        result: "rejected",
        findings: "not clean enough",
        expectedVersion: completed.task.version,
      }),
    ]);

    const ok = settled.filter((s) => s.status === "fulfilled");
    const fail = settled.filter((s) => s.status === "rejected");
    assert.equal(ok.length, 1);
    assert.equal(fail.length, 1);
    const loserCode = errCode(
      fail[0]!.status === "rejected" ? fail[0].reason : null,
    );
    assert.ok(
      loserCode === "invalid_state" || loserCode === "version_conflict",
      `loser code ${loserCode}`,
    );

    const task = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: completed.task.id },
    });
    assert.ok(
      task.status === TaskStatus.completed || task.status === TaskStatus.rework,
      `unexpected status ${task.status}`,
    );

    const inspections = await prisma.inspection.count({
      where: { taskId: completed.task.id },
    });
    assert.equal(inspections, 1);

    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    if (task.status === TaskStatus.completed) {
      assert.equal(loc.cleaningStatus, CleaningStatus.verified_clean);
    } else {
      assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
    }
  });

  it("T-CLN-29: concurrent start + reassign stay consistent", async () => {
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });

    const settled = await Promise.allSettled([
      startCleaningTask({
        taskId: task.id,
        employeeId: world.hk1.employeeId,
        commandId: randomUUID(),
        expectedVersion: task.version,
      }),
      reassignCleaningTask({
        taskId: task.id,
        assignedEmployeeId: world.hk2.employeeId,
        reason: "cover shift",
        expectedVersion: task.version,
        actorEmployeeId: world.manager.employeeId,
      }),
    ]);

    const startResult = settled[0]!;
    const reassignResult = settled[1]!;

    const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    const running = await prisma.cleaningSession.findFirst({
      where: { taskId: task.id, status: SessionStatus.running },
    });

    if (running) {
      assert.equal(
        running.employeeId,
        finalTask.assignedEmployeeId,
        "running session employee must match task assignee",
      );
      assert.equal(finalTask.status, TaskStatus.in_progress);
      assert.equal(reassignResult.status, "rejected");
      const code = errCode(
        reassignResult.status === "rejected" ? reassignResult.reason : null,
      );
      assert.ok(
        code === "conflict" ||
          code === "invalid_state" ||
          code === "version_conflict",
        `reassign loser code ${code}`,
      );
    } else {
      assert.equal(finalTask.assignedEmployeeId, world.hk2.employeeId);
      assert.equal(startResult.status, "rejected");
      const code = errCode(
        startResult.status === "rejected" ? startResult.reason : null,
      );
      assert.ok(
        code === "assignee_conflict" ||
          code === "version_conflict" ||
          code === "invalid_state" ||
          code === "conflict",
        `start loser code ${code}`,
      );
    }
  });
});
