/**
 * 20 — ownership gates + inspection lifecycle.
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
  InspectionResult,
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
  startCleaningTask,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/cleaning";
// Import bindings from ../../src/services/settings.
import { getFlags } from "../../src/services/settings";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  createAndStartToday,
  // Execute the next setup or assertion step for this scenario.
  createCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  isAppError,
  // Execute the next setup or assertion step for this scenario.
  resetCleaningWork,
  // Execute the next setup or assertion step for this scenario.
  withFlagsPatch,
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

// Suite: cleaning lifecycle inspection (20).
describe("cleaning lifecycle inspection (20)", () => {
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

  // Case probes concurrency/isolation: foreign start/complete blocked; owner bypass works.
  it("foreign start/complete blocked; owner bypass works", async () => {
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

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await startCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected assignee_conflict on foreign start");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "assignee_conflict");
    }

    // started: synchronize actors so the race window is observable.
    const started = await startCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: task.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: task.version,
    });

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await completeCleaningSession({
        // Session/CSRF step exercising auth lifecycle.
        sessionId: started.session.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: started.task.version,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected assignee_conflict on foreign complete");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "assignee_conflict");
    }

    // Owner completes HK1's session (true foreign-complete exception).
    const ownerCompletesForeign = await completeCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: started.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: started.task.version,
      // Session/CSRF step exercising auth lifecycle.
      bypassSessionOwnerCheck: true,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(ownerCompletesForeign.session.employeeId, world.hk1.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Session/CSRF step exercising auth lifecycle.
      ownerCompletesForeign.session.completeActorEmployeeId,
      // Execute the next setup or assertion step for this scenario.
      world.owner.employeeId,
    );
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      ownerCompletesForeign.task.status === TaskStatus.awaiting_inspection ||
        // Execute the next setup or assertion step for this scenario.
        ownerCompletesForeign.task.status === TaskStatus.completed,
    );

    // Service layer: without bypassSessionOwnerCheck, manager is denied.
    // HTTP/sync set the flag via canBypassCleaningAssignee .
    await resetCleaningWork(prisma, world);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    const { started: started2 } = await createAndStartToday(
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      world.hk1.employeeId,
    );
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await completeCleaningSession({
        // Session/CSRF step exercising auth lifecycle.
        sessionId: started2.session.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.manager.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: started2.task.version,
        // Session/CSRF step exercising auth lifecycle.
        bypassSessionOwnerCheck: false,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected assignee_conflict for manager foreign complete");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "assignee_conflict");
    }
  });

  // Case: complete with require_inspection=true.
  it("complete with require_inspection=true", async () => {
    // Assert the observed value matches the intended post-condition.
    assert.equal((await getFlags()).require_inspection, true);
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
    // Assert the observed value matches the intended post-condition.
    assert.equal(completed.task.completedAt, null);
    // loc: synchronize actors so the race window is observable.
    const loc = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningStatus, CleaningStatus.pending_inspection);
  });

  // Case: complete with require_inspection=false.
  it("complete with require_inspection=false", async () => {
    // Await async work before asserting or releasing locks.
    await withFlagsPatch(
      // Execute the next setup or assertion step for this scenario.
      world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      { require_inspection: false },
      // Execute the next setup or assertion step for this scenario.
      async () => {
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
        assert.equal(completed.task.status, TaskStatus.completed);
        // Assert the observed value matches the intended post-condition.
        assert.ok(completed.task.completedAt);
        // loc: synchronize actors so the race window is observable.
        const loc = await prisma.location.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: world.locationAId },
        });
        // Assert the observed value matches the intended post-condition.
        assert.equal(loc.cleaningStatus, CleaningStatus.verified_clean);
      },
    );
  });

  // Case: reject requires findings; rework + dirty.
  it("reject requires findings; rework + dirty", async () => {
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

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await inspectCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: completed.task.id,
        // Execute the next setup or assertion step for this scenario.
        inspectorEmployeeId: world.manager.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        result: "rejected",
        // Execute the next setup or assertion step for this scenario.
        findings: "   ",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: completed.task.version,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected validation on empty findings");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "validation");
      // Assert HTTP status matches the contract for this path.
      assert.equal(err.status, 400);
    }

    // rejected: synchronize actors so the race window is observable.
    const rejected = await inspectCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: completed.task.id,
      // Execute the next setup or assertion step for this scenario.
      inspectorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      result: "rejected",
      // Delivery/replay step for async notification paths.
      findings: "missed bathroom",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: completed.task.version,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(rejected.task.status, TaskStatus.rework);
    // Assert the observed value matches the intended post-condition.
    assert.equal(rejected.inspection.result, InspectionResult.rejected);
    // loc: synchronize actors so the race window is observable.
    const loc = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
  });

  // Case: rework then approve same task preserves history.
  it("rework then approve same task preserves history", async () => {
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    const { started } = await createAndStartToday(
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      world.hk1.employeeId,
    );
    // firstComplete: synchronize actors so the race window is observable.
    const firstComplete = await completeCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: started.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: started.task.version,
    });
    // rejectCmd: unique stamp so parallel runs do not collide.
    const rejectCmd = randomUUID();
    // rejected: synchronize actors so the race window is observable.
    const rejected = await inspectCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: firstComplete.task.id,
      // Execute the next setup or assertion step for this scenario.
      inspectorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: rejectCmd,
      // Execute the next setup or assertion step for this scenario.
      result: "rejected",
      // Execute the next setup or assertion step for this scenario.
      findings: "dust on nightstand",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: firstComplete.task.version,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(rejected.task.status, TaskStatus.rework);

    // reworkStart: synchronize actors so the race window is observable.
    const reworkStart = await startCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: rejected.task.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: rejected.task.version,
    });
    // reworkComplete: synchronize actors so the race window is observable.
    const reworkComplete = await completeCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: reworkStart.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: reworkStart.task.version,
    });
    // approved: in-process HTTP server handle for this suite.
    const approved = await inspectCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: reworkComplete.task.id,
      // Execute the next setup or assertion step for this scenario.
      inspectorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      result: "approved",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: reworkComplete.task.version,
    });

    // Assert the observed value matches the intended post-condition.
    assert.equal(approved.task.id, firstComplete.task.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal(approved.task.status, TaskStatus.completed);

    // sessions: session cookie jar for authenticated requests.
    const sessions = await prisma.cleaningSession.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        taskId: approved.task.id,
        // Fixture field status for the seeded actor/entity.
        status: SessionStatus.completed,
      },
    });
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.ok(sessions.length >= 2, `expected ≥2 completed sessions, got ${sessions.length}`);

    // inspections: synchronize actors so the race window is observable.
    const inspections = await prisma.inspection.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { taskId: approved.task.id },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { inspectedAt: "asc" },
    });
    // Assert collection size matches the expected post-condition.
    assert.equal(inspections.length, 2);
    // Assert the observed value matches the intended post-condition.
    assert.equal(inspections[0]!.result, InspectionResult.rejected);
    // Assert the observed value matches the intended post-condition.
    assert.equal(inspections[0]!.findings, "dust on nightstand");
    // Assert the observed value matches the intended post-condition.
    assert.equal(inspections[1]!.result, InspectionResult.approved);

    // loc: synchronize actors so the race window is observable.
    const loc = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningStatus, CleaningStatus.verified_clean);
  });
});
