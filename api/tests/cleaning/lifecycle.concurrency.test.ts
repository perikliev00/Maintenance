// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { withDatabaseBarrier, orderedDatabaseRace } from "../dbBarrier";
/**
 * cleaning concurrency invariants.
 */
import assert from "node:assert/strict";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import bindings from node:path.
import path from "node:path";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CleaningStatus,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
  // Session/CSRF step exercising auth lifecycle.
  SessionStatus,
  // Execute the next setup or assertion step for this scenario.
  TaskStatus,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import module bindings used by this suite.
import {
  // Session/CSRF step exercising auth lifecycle.
  completeCleaningSession,
  // Execute the next setup or assertion step for this scenario.
  createCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  inspectCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  reassignCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  startCleaningTask,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/cleaning";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  countActiveTasks,
  // Execute the next setup or assertion step for this scenario.
  createAndStartToday,
  // Execute the next setup or assertion step for this scenario.
  createCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  errCode,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  isAppError,
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

// Suite: cleaning lifecycle concurrency (12/21/29).
describe("cleaning lifecycle concurrency (12/21/29)", () => {
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

  // Case probes concurrency/isolation: concurrent create same room+day → one active task.
  it("concurrent create same room+day → one active task", async () => {
    // today: synchronize actors so the race window is observable.
    const today = await hotelTodayYmd();
    // locBefore: synchronize actors so the race window is observable.
    const locBefore = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });

    // settled: capture concurrent outcomes for race assertions.
    const settled = await withDatabaseBarrier(prisma, tx => tx.$queryRaw`SELECT id FROM "Location" WHERE id = ${world.locationAId} FOR UPDATE`, () => Promise.allSettled([
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      createCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: today,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk1.employeeId,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
      }),
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      createCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: today,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
      }),
    ]));

    // Bind ok for later setup or assertions in this scope.
    const ok = settled.filter((s) => s.status === "fulfilled");
    // Bind fail for later setup or assertions in this scope.
    const fail = settled.filter((s) => s.status === "rejected");
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.equal(ok.length, 1, "expected exactly one successful create");
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.equal(fail.length, 1, "expected exactly one failed create");
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      fail[0]!.status === "rejected" && isAppError(fail[0].reason),
      // Execute the next setup or assertion step for this scenario.
      "loser should be AppError",
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(errCode(fail[0].reason), "conflict");

    // active: synchronize actors so the race window is observable.
    const active = await countActiveTasks(prisma, world.locationAId, today);
    // Assert the observed value matches the intended post-condition.
    assert.equal(active, 1);

    // Bind winner for later setup or assertions in this scope.
    const winner = (ok[0] as PromiseFulfilledResult<{ id: string; cleaningCycle: number }>)
      // Continue the call chain for setup or assertion detail.
      .value;
    // locAfter: synchronize actors so the race window is observable.
    const locAfter = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Fixture rooms start dirty — loser must not bump cycle or flip status.
    assert.equal(locAfter.cleaningCycle, locBefore.cleaningCycle + 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(locAfter.cleaningStatus, locBefore.cleaningStatus);
    // Assert the observed value matches the intended post-condition.
    assert.equal(locAfter.cleaningStatus, CleaningStatus.dirty);
    // Assert the observed value matches the intended post-condition.
    assert.equal(winner.cleaningCycle, locAfter.cleaningCycle);
  });

  // Case probes concurrency/isolation: concurrent start two tasks same HK → one running session.
  it("concurrent start two tasks same HK → one running session", async () => {
    // today: synchronize actors so the race window is observable.
    const today = await hotelTodayYmd();
    // taskA: seeded entity required before the mutation under test.
    const taskA = await createCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
    });
    // taskB: seeded entity required before the mutation under test.
    const taskB = await createCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationBId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
    });
    // beforeTasks: synchronize actors so the race window is observable.
    const beforeTasks = await prisma.cleaningTask.findMany({ where: { id: { in: [taskA.id, taskB.id] } } });
    // beforeLocations: synchronize actors so the race window is observable.
    const beforeLocations = await prisma.location.findMany({ where: { id: { in: [world.locationAId, world.locationBId] } } });
    // beforeAudit: synchronize actors so the race window is observable.
    const beforeAudit = await prisma.auditEvent.findMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } }, orderBy: { id: "asc" } });

    // settled: capture concurrent outcomes for race assertions.
    const settled = await withDatabaseBarrier(prisma, tx => tx.$executeRaw`LOCK TABLE "CleaningSession" IN SHARE MODE`, () => Promise.allSettled([
      // Execute the next setup or assertion step for this scenario.
      startCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: taskA.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk1.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: taskA.version,
      }),
      // Execute the next setup or assertion step for this scenario.
      startCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: taskB.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk1.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: taskB.version,
      }),
    ]));

    // Bind ok for later setup or assertions in this scope.
    const ok = settled.filter((s) => s.status === "fulfilled");
    // Bind fail for later setup or assertions in this scope.
    const fail = settled.filter((s) => s.status === "rejected");
    // Assert collection size matches the expected post-condition.
    assert.equal(ok.length, 1);
    // Assert collection size matches the expected post-condition.
    assert.equal(fail.length, 1);
    // Assert HTTP status matches the contract for this path.
    assert.equal(errCode(fail[0]!.status === "rejected" ? fail[0].reason : null), "conflict");

    // running: synchronize actors so the race window is observable.
    const running = await prisma.cleaningSession.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk1.employeeId,
        // Fixture field status for the seeded actor/entity.
        status: SessionStatus.running,
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(running, 1);
    // winner: synchronize actors so the race window is observable.
    const winner = await prisma.cleaningSession.findFirstOrThrow({ where: { employeeId: world.hk1.employeeId, status: SessionStatus.running } });
    // Bind loser for later setup or assertions in this scope.
    const loser = beforeTasks.find(t => t.id !== winner.taskId)!;
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await prisma.cleaningTask.findUniqueOrThrow({ where: { id: loser.id } }), loser);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await prisma.location.findUniqueOrThrow({ where: { id: loser.locationId } }), beforeLocations.find(l => l.id === loser.locationId));
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await prisma.auditEvent.findMany({ where: { locationId: loser.locationId }, orderBy: { id: "asc" } }), beforeAudit.filter(a => a.locationId === loser.locationId));
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.cleaningSession.count({ where: { taskId: loser.id } }), 0);
  });

  // Iterate to cover variants or wait until a condition holds.
  for (const firstDecision of ["approved", "rejected"] as const) {
  // Case: ${firstDecision} wins observed inspection contention.
  it(`${firstDecision} wins observed inspection contention`, async () => {
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    const { started } = await createAndStartToday(
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      world.hk1.employeeId,
    );
    // completed: synchronize actors so the race window is observable.
    const completed = await completeCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: started.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: started.task.version,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(completed.task.status, TaskStatus.awaiting_inspection);

    // settled: synchronize actors so the race window is observable.
    const settled = await orderedDatabaseRace(prisma, tx => tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${completed.task.id} FOR UPDATE`,
      // Execute the next setup or assertion step for this scenario.
      () =>
      // Execute the next setup or assertion step for this scenario.
      inspectCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: completed.task.id,
        // Execute the next setup or assertion step for this scenario.
        inspectorEmployeeId: world.manager.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        result: firstDecision,
        // Execute the next setup or assertion step for this scenario.
        findings: "first decision findings",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: completed.task.version,
      }),
      // Execute the next setup or assertion step for this scenario.
      () => inspectCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: completed.task.id,
        // Execute the next setup or assertion step for this scenario.
        inspectorEmployeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        result: firstDecision === "approved" ? "rejected" : "approved",
        // Execute the next setup or assertion step for this scenario.
        findings: "not clean enough",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: completed.task.version,
      }),
    );

    // Bind ok for later setup or assertions in this scope.
    const ok = settled.filter((s) => s.status === "fulfilled");
    // Bind fail for later setup or assertions in this scope.
    const fail = settled.filter((s) => s.status === "rejected");
    // Assert collection size matches the expected post-condition.
    assert.equal(ok.length, 1);
    // Assert collection size matches the expected post-condition.
    assert.equal(fail.length, 1);
    // Bind loserCode for later setup or assertions in this scope.
    const loserCode = errCode(
      // Execute the next setup or assertion step for this scenario.
      fail[0]!.status === "rejected" ? fail[0].reason : null,
    );
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      loserCode === "invalid_state" || loserCode === "version_conflict",
      // Execute the next setup or assertion step for this scenario.
      `loser code ${loserCode}`,
    );

    // task: synchronize actors so the race window is observable.
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: completed.task.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      task.status === TaskStatus.completed || task.status === TaskStatus.rework,
      // Execute the next setup or assertion step for this scenario.
      `unexpected status ${task.status}`,
    );

    // inspections: synchronize actors so the race window is observable.
    const inspections = await prisma.inspection.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { taskId: completed.task.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(inspections, 1);
    // Assert HTTP status matches the contract for this path.
    assert.equal(task.status, firstDecision === "approved" ? TaskStatus.completed : TaskStatus.rework);
    // Assert HTTP status matches the contract for this path.
    assert.equal(settled[0]!.status, "fulfilled");
    // Assert HTTP status matches the contract for this path.
    assert.equal(settled[1]!.status, "rejected");

    // loc: synchronize actors so the race window is observable.
    const loc = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Guard optional cleanup or alternate assertion paths.
    if (task.status === TaskStatus.completed) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(loc.cleaningStatus, CleaningStatus.verified_clean);
    // Execute the next setup or assertion step for this scenario.
    } else {
      // Assert the observed value matches the intended post-condition.
      assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
    }
  });

  }
  // Iterate to cover variants or wait until a condition holds.
  for (const startFirst of [true, false]) {
  // Case: ${startFirst ? .
  it(`${startFirst ? "start": "reassign"} wins observed contention`, async () => {
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

    // Bind start for later setup or assertions in this scope.
    const start = () =>
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
      });
    // Bind reassign for later setup or assertions in this scope.
    const reassign = () => reassignCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "cover shift",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.manager.employeeId,
      });
    // ordered: synchronize actors so the race window is observable.
    const ordered = await orderedDatabaseRace(prisma, tx => tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE`, startFirst ? start : reassign, startFirst ? reassign : start);
    // Bind settled for later setup or assertions in this scope.
    const settled = startFirst ? ordered : [ordered[1]!, ordered[0]!];

    // Bind startResult for later setup or assertions in this scope.
    const startResult = settled[0]!;
    // Bind reassignResult for later setup or assertions in this scope.
    const reassignResult = settled[1]!;

    // finalTask: synchronize actors so the race window is observable.
    const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: task.id },
    });
    // running: synchronize actors so the race window is observable.
    const running = await prisma.cleaningSession.findFirst({
      // SQL fragment used to observe locks or assert DB state.
      where: { taskId: task.id, status: SessionStatus.running },
    });

    // Assert the observed value matches the intended post-condition.
    assert.equal(Boolean(running), startFirst);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (running) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        running.employeeId,
        // Execute the next setup or assertion step for this scenario.
        finalTask.assignedEmployeeId,
        // Session/CSRF step exercising auth lifecycle.
        "running session employee must match task assignee",
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(finalTask.status, TaskStatus.in_progress);
      // Assert HTTP status matches the contract for this path.
      assert.equal(reassignResult.status, "rejected");
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(reassignResult.reason), "reassign loser must be a structured AppError");
      // Bind code for later setup or assertions in this scope.
      const code = errCode(
        // Execute the next setup or assertion step for this scenario.
        reassignResult.status === "rejected" ? reassignResult.reason : null,
      );
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        code === "conflict" ||
          // Execute the next setup or assertion step for this scenario.
          code === "invalid_state" ||
          // Execute the next setup or assertion step for this scenario.
          code === "version_conflict",
        // Execute the next setup or assertion step for this scenario.
        `reassign loser code ${code}`,
      );
    // Execute the next setup or assertion step for this scenario.
    } else {
      // Assert the observed value matches the intended post-condition.
      assert.equal(finalTask.assignedEmployeeId, world.hk2.employeeId);
      // Assert HTTP status matches the contract for this path.
      assert.equal(startResult.status, "rejected");
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(startResult.reason), "start loser must be a structured AppError");
      // Bind code for later setup or assertions in this scope.
      const code = errCode(
        // Execute the next setup or assertion step for this scenario.
        startResult.status === "rejected" ? startResult.reason : null,
      );
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        code === "assignee_conflict" ||
          // Execute the next setup or assertion step for this scenario.
          code === "version_conflict" ||
          // Execute the next setup or assertion step for this scenario.
          code === "invalid_state" ||
          // Execute the next setup or assertion step for this scenario.
          code === "conflict",
        // Execute the next setup or assertion step for this scenario.
        `start loser code ${code}`,
      );
    }
  });
  }
});
