import { withDatabaseBarrier, orderedDatabaseRace } from "../dbBarrier";
/**
 * cleaning concurrency invariants.
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

describe("cleaning lifecycle concurrency (12/21/29)", () => {
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

  it("concurrent create same room+day → one active task", async () => {
    const today = await hotelTodayYmd();
    const locBefore = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });

    const settled = await withDatabaseBarrier(prisma, tx => tx.$queryRaw`SELECT id FROM "Location" WHERE id = ${world.locationAId} FOR UPDATE`, () => Promise.allSettled([
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
    ]));

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

  it("concurrent start two tasks same HK → one running session", async () => {
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
    const beforeTasks = await prisma.cleaningTask.findMany({ where: { id: { in: [taskA.id, taskB.id] } } });
    const beforeLocations = await prisma.location.findMany({ where: { id: { in: [world.locationAId, world.locationBId] } } });
    const beforeAudit = await prisma.auditEvent.findMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } }, orderBy: { id: "asc" } });

    const settled = await withDatabaseBarrier(prisma, tx => tx.$executeRaw`LOCK TABLE "CleaningSession" IN SHARE MODE`, () => Promise.allSettled([
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
    ]));

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
    const winner = await prisma.cleaningSession.findFirstOrThrow({ where: { employeeId: world.hk1.employeeId, status: SessionStatus.running } });
    const loser = beforeTasks.find(t => t.id !== winner.taskId)!;
    assert.deepEqual(await prisma.cleaningTask.findUniqueOrThrow({ where: { id: loser.id } }), loser);
    assert.deepEqual(await prisma.location.findUniqueOrThrow({ where: { id: loser.locationId } }), beforeLocations.find(l => l.id === loser.locationId));
    assert.deepEqual(await prisma.auditEvent.findMany({ where: { locationId: loser.locationId }, orderBy: { id: "asc" } }), beforeAudit.filter(a => a.locationId === loser.locationId));
    assert.equal(await prisma.cleaningSession.count({ where: { taskId: loser.id } }), 0);
  });

  for (const firstDecision of ["approved", "rejected"] as const) {
  it(`${firstDecision} wins observed inspection contention`, async () => {
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

    const settled = await orderedDatabaseRace(prisma, tx => tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${completed.task.id} FOR UPDATE`,
      () =>
      inspectCleaningTask({
        taskId: completed.task.id,
        inspectorEmployeeId: world.manager.employeeId,
        commandId: randomUUID(),
        result: firstDecision,
        findings: "first decision findings",
        expectedVersion: completed.task.version,
      }),
      () => inspectCleaningTask({
        taskId: completed.task.id,
        inspectorEmployeeId: world.owner.employeeId,
        commandId: randomUUID(),
        result: firstDecision === "approved" ? "rejected" : "approved",
        findings: "not clean enough",
        expectedVersion: completed.task.version,
      }),
    );

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
    assert.equal(task.status, firstDecision === "approved" ? TaskStatus.completed : TaskStatus.rework);
    assert.equal(settled[0]!.status, "fulfilled");
    assert.equal(settled[1]!.status, "rejected");

    const loc = await prisma.location.findUniqueOrThrow({
      where: { id: world.locationAId },
    });
    if (task.status === TaskStatus.completed) {
      assert.equal(loc.cleaningStatus, CleaningStatus.verified_clean);
    } else {
      assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
    }
  });

  }
  for (const startFirst of [true, false]) {
  it(`${startFirst ? "start": "reassign"} wins observed contention`, async () => {
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });

    const start = () =>
      startCleaningTask({
        taskId: task.id,
        employeeId: world.hk1.employeeId,
        commandId: randomUUID(),
        expectedVersion: task.version,
      });
    const reassign = () => reassignCleaningTask({
        taskId: task.id,
        assignedEmployeeId: world.hk2.employeeId,
        reason: "cover shift",
        expectedVersion: task.version,
        actorEmployeeId: world.manager.employeeId,
      });
    const ordered = await orderedDatabaseRace(prisma, tx => tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE`, startFirst ? start : reassign, startFirst ? reassign : start);
    const settled = startFirst ? ordered : [ordered[1]!, ordered[0]!];

    const startResult = settled[0]!;
    const reassignResult = settled[1]!;

    const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    const running = await prisma.cleaningSession.findFirst({
      where: { taskId: task.id, status: SessionStatus.running },
    });

    assert.equal(Boolean(running), startFirst);
    if (running) {
      assert.equal(
        running.employeeId,
        finalTask.assignedEmployeeId,
        "running session employee must match task assignee",
      );
      assert.equal(finalTask.status, TaskStatus.in_progress);
      assert.equal(reassignResult.status, "rejected");
      assert.ok(isAppError(reassignResult.reason), "reassign loser must be a structured AppError");
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
      assert.ok(isAppError(startResult.reason), "start loser must be a structured AppError");
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
  }
});
