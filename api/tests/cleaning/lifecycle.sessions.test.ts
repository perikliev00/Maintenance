/**
 * T-CLN-13,14,22–26,30 — dates, cancel, stale soft-guard, idempotency, markDirty.
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
  cancelCleaningSession,
  completeCleaningSession,
  createCleaningTask,
  inspectCleaningTask,
  markRoomDirty,
  startCleaningTask,
} from "../../src/services/cleaning";
import { getFlags } from "../../src/services/settings";
import {
  cleanupCleaningWorld,
  createAndStartToday,
  createCleaningWorld,
  createDualDayRunningSetup,
  hotelTodayYmd,
  isAppError,
  resetCleaningWork,
  ymdOffset,
  type CleaningWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

describe("cleaning lifecycle sessions (T-CLN-13/14/22–26/30)", () => {
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

  it("T-CLN-13: cannot start future hotelDate task", async () => {
    const today = await hotelTodayYmd();
    const future = ymdOffset(today, 2);
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: future,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });
    assert.equal(task.cleaningCycle, 0);

    const locBefore = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });

    try {
      await startCleaningTask({
        taskId: task.id,
        employeeId: world.hk1.employeeId,
        commandId: randomUUID(),
        expectedVersion: task.version,
      });
      assert.fail("expected invalid_state for future start");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "invalid_state");
      assert.match(err.message, /hotel date/i);
    }

    const sessions = await prisma.cleaningSession.count({
      where: { taskId: task.id },
    });
    assert.equal(sessions, 0);

    const locAfter = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(locAfter.cleaningStatus, locBefore.cleaningStatus);
    assert.equal(locAfter.cleaningCycle, locBefore.cleaningCycle);
  });

  it("T-CLN-14: unbound cycle binds on start for today", async () => {
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });
    await prisma.cleaningTask.update({
      where: { id: task.id },
      data: { cleaningCycle: 0 },
    });

    const started = await startCleaningTask({
      taskId: task.id,
      employeeId: world.hk1.employeeId,
      commandId: randomUUID(),
      expectedVersion: task.version,
    });

    assert.equal(started.task.status, TaskStatus.in_progress);
    assert.ok(started.task.cleaningCycle > 0);
    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(started.task.cleaningCycle, loc.cleaningCycle);
    assert.equal(loc.cleaningStatus, CleaningStatus.in_progress);
    assert.equal(started.session.status, SessionStatus.running);
  });

  it("T-CLN-22: cancel returns task to assigned and room dirty", async () => {
    const { started } = await createAndStartToday(
      world,
      world.locationAId,
      world.hk1.employeeId,
    );
    const cancelled = await cancelCleaningSession({
      sessionId: started.session.id,
      employeeId: world.owner.employeeId,
      commandId: randomUUID(),
      expectedVersion: started.task.version,
      bypassSessionOwnerCheck: true,
    });
    assert.equal(cancelled.session.status, SessionStatus.cancelled);
    assert.equal(cancelled.task.status, TaskStatus.assigned);
    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
  });

  it("T-CLN-23: cancel old session does not stomp newer room", async () => {
    const setup = await createDualDayRunningSetup(prisma, world);

    const locBefore = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(locBefore.cleaningStatus, CleaningStatus.in_progress);

    await cancelCleaningSession({
      sessionId: setup.day1SessionId,
      employeeId: world.owner.employeeId,
      commandId: randomUUID(),
      expectedVersion: setup.day1Version,
      bypassSessionOwnerCheck: true,
    });

    const locAfter = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(locAfter.cleaningStatus, CleaningStatus.in_progress);

    const day2Session = await prisma.cleaningSession.findUniqueOrThrow({
      where: { id: setup.day2SessionId },
    });
    assert.equal(day2Session.status, SessionStatus.running);
  });

  it("T-CLN-24: complete old session does not verify newer room", async () => {
    assert.equal((await getFlags()).require_inspection, true);
    const setup = await createDualDayRunningSetup(prisma, world);

    const completed = await completeCleaningSession({
      sessionId: setup.day1SessionId,
      employeeId: world.hk1.employeeId,
      commandId: randomUUID(),
      expectedVersion: setup.day1Version,
    });
    assert.equal(completed.task.status, TaskStatus.awaiting_inspection);

    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(loc.cleaningStatus, CleaningStatus.in_progress);

    const day2Session = await prisma.cleaningSession.findUniqueOrThrow({
      where: { id: setup.day2SessionId },
    });
    assert.equal(day2Session.status, SessionStatus.running);

    const day2Task = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: setup.day2TaskId },
    });
    assert.equal(day2Task.status, TaskStatus.in_progress);
  });

  it("T-CLN-25: matching commandId replay is idempotent", async () => {
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });
    const startCmd = randomUUID();
    const firstStart = await startCleaningTask({
      taskId: task.id,
      employeeId: world.hk1.employeeId,
      commandId: startCmd,
      expectedVersion: task.version,
    });
    assert.equal(firstStart.idempotent, false);
    const secondStart = await startCleaningTask({
      taskId: task.id,
      employeeId: world.hk1.employeeId,
      commandId: startCmd,
      expectedVersion: task.version,
    });
    assert.equal(secondStart.idempotent, true);
    assert.equal(secondStart.session.id, firstStart.session.id);
    assert.equal(
      await prisma.cleaningSession.count({ where: { taskId: task.id } }),
      1,
      "start replay must not create a second session",
    );

    const completeCmd = randomUUID();
    const firstComplete = await completeCleaningSession({
      sessionId: firstStart.session.id,
      employeeId: world.hk1.employeeId,
      commandId: completeCmd,
      expectedVersion: firstStart.task.version,
    });
    assert.equal(firstComplete.idempotent, false);
    const secondComplete = await completeCleaningSession({
      sessionId: firstStart.session.id,
      employeeId: world.hk1.employeeId,
      commandId: completeCmd,
      expectedVersion: firstStart.task.version,
    });
    assert.equal(secondComplete.idempotent, true);
    assert.equal(secondComplete.session.id, firstComplete.session.id);
    assert.equal(
      await prisma.cleaningSession.count({
        where: { taskId: task.id, status: SessionStatus.completed },
      }),
      1,
      "complete replay must not create a second completed session",
    );

    const inspectCmd = randomUUID();
    const firstInspect = await inspectCleaningTask({
      taskId: firstComplete.task.id,
      inspectorEmployeeId: world.manager.employeeId,
      commandId: inspectCmd,
      result: "approved",
      expectedVersion: firstComplete.task.version,
    });
    assert.equal(firstInspect.idempotent, false);
    const secondInspect = await inspectCleaningTask({
      taskId: firstComplete.task.id,
      inspectorEmployeeId: world.manager.employeeId,
      commandId: inspectCmd,
      result: "approved",
      expectedVersion: firstComplete.task.version,
    });
    assert.equal(secondInspect.idempotent, true);
    assert.equal(secondInspect.inspection.id, firstInspect.inspection.id);

    const inspectCount = await prisma.inspection.count({
      where: { taskId: firstComplete.task.id },
    });
    assert.equal(inspectCount, 1);

    // Cancel path: fresh session
    await resetCleaningWork(prisma, world);
    const { started: forCancel } = await createAndStartToday(
      world,
      world.locationAId,
      world.hk1.employeeId,
    );
    const cancelCmd = randomUUID();
    const firstCancel = await cancelCleaningSession({
      sessionId: forCancel.session.id,
      employeeId: world.owner.employeeId,
      commandId: cancelCmd,
      expectedVersion: forCancel.task.version,
      bypassSessionOwnerCheck: true,
    });
    assert.equal(firstCancel.idempotent, false);
    const secondCancel = await cancelCleaningSession({
      sessionId: forCancel.session.id,
      employeeId: world.owner.employeeId,
      commandId: cancelCmd,
      expectedVersion: forCancel.task.version,
      bypassSessionOwnerCheck: true,
    });
    assert.equal(secondCancel.idempotent, true);
    assert.equal(secondCancel.session.id, firstCancel.session.id);
    assert.equal(
      await prisma.cleaningSession.count({
        where: {
          id: forCancel.session.id,
          status: SessionStatus.cancelled,
        },
      }),
      1,
    );
  });

  it("T-CLN-26: same commandId with different task/employee/decision conflicts", async () => {
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
      assignedEmployeeId: world.hk2.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });

    const startCmd = randomUUID();
    const startedA = await startCleaningTask({
      taskId: taskA.id,
      employeeId: world.hk1.employeeId,
      commandId: startCmd,
      expectedVersion: taskA.version,
    });

    try {
      await startCleaningTask({
        taskId: taskB.id,
        employeeId: world.hk2.employeeId,
        commandId: startCmd,
        expectedVersion: taskB.version,
      });
      assert.fail("expected conflict for start commandId on different task");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "conflict");
      assert.match(err.message, /commandId reused/i);
    }

    try {
      await startCleaningTask({
        taskId: taskA.id,
        employeeId: world.hk2.employeeId,
        commandId: startCmd,
        expectedVersion: startedA.task.version,
        bypassAssigneeCheck: true,
      });
      assert.fail("expected conflict for start commandId with different employee");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "conflict");
    }

    const startedB = await startCleaningTask({
      taskId: taskB.id,
      employeeId: world.hk2.employeeId,
      commandId: randomUUID(),
      expectedVersion: taskB.version,
    });

    const completeCmd = randomUUID();
    const completedA = await completeCleaningSession({
      sessionId: startedA.session.id,
      employeeId: world.hk1.employeeId,
      commandId: completeCmd,
      expectedVersion: startedA.task.version,
    });

    try {
      await completeCleaningSession({
        sessionId: startedB.session.id,
        employeeId: world.hk2.employeeId,
        commandId: completeCmd,
        expectedVersion: startedB.task.version,
      });
      assert.fail("expected conflict for complete commandId on different session");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "conflict");
    }

    const inspectCmd = randomUUID();
    await inspectCleaningTask({
      taskId: completedA.task.id,
      inspectorEmployeeId: world.manager.employeeId,
      commandId: inspectCmd,
      result: "approved",
      expectedVersion: completedA.task.version,
    });

    try {
      await inspectCleaningTask({
        taskId: completedA.task.id,
        inspectorEmployeeId: world.manager.employeeId,
        commandId: inspectCmd,
        result: "rejected",
        findings: "should not flip decision",
        expectedVersion: completedA.task.version,
      });
      assert.fail("expected conflict for inspect commandId with different decision");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "conflict");
    }

    try {
      await inspectCleaningTask({
        taskId: completedA.task.id,
        inspectorEmployeeId: world.owner.employeeId,
        commandId: inspectCmd,
        result: "approved",
        expectedVersion: completedA.task.version,
      });
      assert.fail("expected conflict for inspect commandId with different inspector");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "conflict");
    }

    // Original outcomes must remain unchanged after rejected collisions.
    assert.equal(
      await prisma.cleaningSession.count({
        where: { startCommandId: startCmd },
      }),
      1,
    );
    assert.equal(
      await prisma.cleaningSession.count({
        where: { completeCommandId: completeCmd },
      }),
      1,
    );
    const inspection = await prisma.inspection.findUniqueOrThrow({
      where: { commandId: inspectCmd },
    });
    assert.equal(inspection.result, "approved");
    assert.equal(inspection.inspectorEmployeeId, world.manager.employeeId);

    const taskAAfter = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: taskA.id },
    });
    assert.equal(taskAAfter.status, TaskStatus.completed);

    const sessionB = await prisma.cleaningSession.findUniqueOrThrow({
      where: { id: startedB.session.id },
    });
    assert.equal(sessionB.status, SessionStatus.running);
  });

  it("T-CLN-30: markDirty during running rebinds and complete updates room", async () => {
    assert.equal((await getFlags()).require_inspection, true);
    const { started } = await createAndStartToday(
      world,
      world.locationAId,
      world.hk1.employeeId,
    );
    const cycleBefore = started.task.cleaningCycle;

    await markRoomDirty(world.locationAId, world.owner.employeeId);

    const taskAfterDirty = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: started.task.id },
    });
    const locAfterDirty = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(locAfterDirty.cleaningStatus, CleaningStatus.dirty);
    assert.equal(taskAfterDirty.cleaningCycle, locAfterDirty.cleaningCycle);
    assert.ok(taskAfterDirty.cleaningCycle > cycleBefore);

    const completed = await completeCleaningSession({
      sessionId: started.session.id,
      employeeId: world.hk1.employeeId,
      commandId: randomUUID(),
      expectedVersion: taskAfterDirty.version,
    });
    assert.equal(completed.task.status, TaskStatus.awaiting_inspection);

    const locAfterComplete = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(locAfterComplete.cleaningStatus, CleaningStatus.pending_inspection);
  });
});
