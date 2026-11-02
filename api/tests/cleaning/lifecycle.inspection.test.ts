/**
 * 20 — ownership gates + inspection lifecycle.
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import {
  CleaningStatus,
  InspectionResult,
  PrismaClient,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import dotenv from "dotenv";
import {
  completeCleaningSession,
  createCleaningTask,
  inspectCleaningTask,
  startCleaningTask,
} from "../../src/services/cleaning";
import { getFlags } from "../../src/services/settings";
import {
  cleanupCleaningWorld,
  createAndStartToday,
  createCleaningWorld,
  hotelTodayYmd,
  isAppError,
  resetCleaningWork,
  withFlagsPatch,
  type CleaningWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

describe("cleaning lifecycle inspection (20)", () => {
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

  it("foreign start/complete blocked; owner bypass works", async () => {
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });

    try {
      await startCleaningTask({
        taskId: task.id,
        employeeId: world.hk2.employeeId,
        commandId: randomUUID(),
        expectedVersion: task.version,
      });
      assert.fail("expected assignee_conflict on foreign start");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "assignee_conflict");
    }

    const started = await startCleaningTask({
      taskId: task.id,
      employeeId: world.hk1.employeeId,
      commandId: randomUUID(),
      expectedVersion: task.version,
    });

    try {
      await completeCleaningSession({
        sessionId: started.session.id,
        employeeId: world.hk2.employeeId,
        commandId: randomUUID(),
        expectedVersion: started.task.version,
      });
      assert.fail("expected assignee_conflict on foreign complete");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "assignee_conflict");
    }

    // Owner completes HK1's session (true foreign-complete exception).
    const ownerCompletesForeign = await completeCleaningSession({
      sessionId: started.session.id,
      employeeId: world.owner.employeeId,
      commandId: randomUUID(),
      expectedVersion: started.task.version,
      bypassSessionOwnerCheck: true,
    });
    assert.equal(ownerCompletesForeign.session.employeeId, world.hk1.employeeId);
    assert.equal(
      ownerCompletesForeign.session.completeActorEmployeeId,
      world.owner.employeeId,
    );
    assert.ok(
      ownerCompletesForeign.task.status === TaskStatus.awaiting_inspection ||
        ownerCompletesForeign.task.status === TaskStatus.completed,
    );

    // Service layer: without bypassSessionOwnerCheck, manager is denied.
    // HTTP/sync set the flag via canBypassCleaningAssignee .
    await resetCleaningWork(prisma, world);
    const { started: started2 } = await createAndStartToday(
      world,
      world.locationAId,
      world.hk1.employeeId,
    );
    try {
      await completeCleaningSession({
        sessionId: started2.session.id,
        employeeId: world.manager.employeeId,
        commandId: randomUUID(),
        expectedVersion: started2.task.version,
        bypassSessionOwnerCheck: false,
      });
      assert.fail("expected assignee_conflict for manager foreign complete");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "assignee_conflict");
    }
  });

  it("complete with require_inspection=true", async () => {
    assert.equal((await getFlags()).require_inspection, true);
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
    assert.equal(completed.task.completedAt, null);
    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(loc.cleaningStatus, CleaningStatus.pending_inspection);
  });

  it("complete with require_inspection=false", async () => {
    await withFlagsPatch(
      world.owner.employeeId,
      { require_inspection: false },
      async () => {
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
        assert.equal(completed.task.status, TaskStatus.completed);
        assert.ok(completed.task.completedAt);
        const loc = await prisma.location.findUniqueOrThrow({
          where: { id: world.locationAId },
        });
        assert.equal(loc.cleaningStatus, CleaningStatus.verified_clean);
      },
    );
  });

  it("reject requires findings; rework + dirty", async () => {
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

    try {
      await inspectCleaningTask({
        taskId: completed.task.id,
        inspectorEmployeeId: world.manager.employeeId,
        commandId: randomUUID(),
        result: "rejected",
        findings: "   ",
        expectedVersion: completed.task.version,
      });
      assert.fail("expected validation on empty findings");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "validation");
      assert.equal(err.status, 400);
    }

    const rejected = await inspectCleaningTask({
      taskId: completed.task.id,
      inspectorEmployeeId: world.manager.employeeId,
      commandId: randomUUID(),
      result: "rejected",
      findings: "missed bathroom",
      expectedVersion: completed.task.version,
    });
    assert.equal(rejected.task.status, TaskStatus.rework);
    assert.equal(rejected.inspection.result, InspectionResult.rejected);
    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
  });

  it("rework then approve same task preserves history", async () => {
    const { started } = await createAndStartToday(
      world,
      world.locationAId,
      world.hk1.employeeId,
    );
    const firstComplete = await completeCleaningSession({
      sessionId: started.session.id,
      employeeId: world.hk1.employeeId,
      commandId: randomUUID(),
      expectedVersion: started.task.version,
    });
    const rejectCmd = randomUUID();
    const rejected = await inspectCleaningTask({
      taskId: firstComplete.task.id,
      inspectorEmployeeId: world.manager.employeeId,
      commandId: rejectCmd,
      result: "rejected",
      findings: "dust on nightstand",
      expectedVersion: firstComplete.task.version,
    });
    assert.equal(rejected.task.status, TaskStatus.rework);

    const reworkStart = await startCleaningTask({
      taskId: rejected.task.id,
      employeeId: world.hk1.employeeId,
      commandId: randomUUID(),
      expectedVersion: rejected.task.version,
    });
    const reworkComplete = await completeCleaningSession({
      sessionId: reworkStart.session.id,
      employeeId: world.hk1.employeeId,
      commandId: randomUUID(),
      expectedVersion: reworkStart.task.version,
    });
    const approved = await inspectCleaningTask({
      taskId: reworkComplete.task.id,
      inspectorEmployeeId: world.manager.employeeId,
      commandId: randomUUID(),
      result: "approved",
      expectedVersion: reworkComplete.task.version,
    });

    assert.equal(approved.task.id, firstComplete.task.id);
    assert.equal(approved.task.status, TaskStatus.completed);

    const sessions = await prisma.cleaningSession.findMany({
      where: {
        taskId: approved.task.id,
        status: SessionStatus.completed,
      },
    });
    assert.ok(sessions.length >= 2, `expected ≥2 completed sessions, got ${sessions.length}`);

    const inspections = await prisma.inspection.findMany({
      where: { taskId: approved.task.id },
      orderBy: { inspectedAt: "asc" },
    });
    assert.equal(inspections.length, 2);
    assert.equal(inspections[0]!.result, InspectionResult.rejected);
    assert.equal(inspections[0]!.findings, "dust on nightstand");
    assert.equal(inspections[1]!.result, InspectionResult.approved);

    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    assert.equal(loc.cleaningStatus, CleaningStatus.verified_clean);
  });
});
