/**
 * Independent concurrency audit verification (2026-11-05).
 * Exercises RISK-LOCK / RISK-PLAN / RISK-ATTENDANCE against real PostgreSQL
 * production service functions. Do not mock business logic.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  AttendanceAdjustmentStatus,
  // Execute the next setup or assertion step for this scenario.
  AttendanceEventKind,
  // Execute the next setup or assertion step for this scenario.
  AttendanceIntervalStatus,
  // Execute the next setup or assertion step for this scenario.
  CleaningStatus,
  // Execute the next setup or assertion step for this scenario.
  DailyPlanCategory,
  // Execute the next setup or assertion step for this scenario.
  Priority,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  Role,
  // Session/CSRF step exercising auth lifecycle.
  SessionStatus,
  // Execute the next setup or assertion step for this scenario.
  TaskStatus,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import module bindings used by this suite.
import {
  // Session/CSRF step exercising auth lifecycle.
  cancelCleaningSession,
  // Session/CSRF step exercising auth lifecycle.
  completeCleaningSession,
  // Execute the next setup or assertion step for this scenario.
  createCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  inspectCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  markRoomDirty,
  // Execute the next setup or assertion step for this scenario.
  reassignCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  startCleaningTask,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/cleaning";
// Import bindings from ../../src/services/cleaning/cycles.
import { bumpDirtyAndRebindWork } from "../../src/services/cleaning/cycles";
// Import bindings from ../../src/services/dailyPlan.
import { createDailyPlanEntry } from "../../src/services/dailyPlan";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  ingestEvent,
  // Execute the next setup or assertion step for this scenario.
  requestAdjustment,
  // Execute the next setup or assertion step for this scenario.
  reviewAdjustment,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/attendance";
// Import bindings from ../../src/services/settings.
import { getOperations, updateSetting } from "../../src/services/settings";
// Import bindings from ../../src/services/shifts.
import { upsertShiftRoster, listShiftRoster } from "../../src/services/shifts";
// Import bindings from ../../src/errors.
import { AppError } from "../../src/errors";
// Import bindings from ../../src/db.
import { prisma as appPrisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { orderedDatabaseRace, withDatabaseBarrier } from "../dbBarrier";
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
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupAttendanceWorld,
  // Execute the next setup or assertion step for this scenario.
  createAttendanceWorld,
  // Shape AttendanceWorld documents the fixture/response fields this suite touches.
  type AttendanceWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../attendance/fixtures";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupShiftsWorld,
  // Execute the next setup or assertion step for this scenario.
  createShiftsWorld,
  // Shape ShiftsWorld documents the fixture/response fields this suite touches.
  type ShiftsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../shifts/fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Local helper isAppError used by cases in this file.
function isAppError(err: unknown): err is AppError {
  // Return the arranged value/result to the caller.
  return err instanceof AppError;
}

// Helper isPrismaDeadlock: concurrency/isolation coordination.
function isPrismaDeadlock(err: unknown): boolean {
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!err || typeof err !== "object") return false;
  // Bind code for later setup or assertions in this scope.
  const code = (err as { code?: string }).code;
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (code === "P2010" || code === "40P01" || code === "P2034") return true;
  // Bind message for later setup or assertions in this scope.
  const message = String((err as { message?: string }).message ?? err);
  // Return the arranged value/result to the caller.
  return /deadlock|40P01/i.test(message);
}

// Local helper formatReject used by cases in this file.
function formatReject(err: unknown): string {
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (err instanceof Error) {
    // Bind code for later setup or assertions in this scope.
    const code = (err as { code?: string }).code;
    // Return the arranged value/result to the caller.
    return `${err.name}${code ? `/${code}` : ""}: ${err.message}`;
  }
  // Return the arranged value/result to the caller.
  return String(err);
}

// Suite: independent concurrency audit 2026-11-05.
describe("independent concurrency audit 2026-11-05", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: CleaningWorld;
  // Execute the next setup or assertion step for this scenario.
  let attWorld: AttendanceWorld;
  // Execute the next setup or assertion step for this scenario.
  let shiftsWorld: ShiftsWorld;
  // Execute the next setup or assertion step for this scenario.
  let opsBefore: Awaited<ReturnType<typeof getOperations>>;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    attWorld = await createAttendanceWorld(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    shiftsWorld = await createShiftsWorld(prisma);
    // Await async work before asserting or releasing locks.
    opsBefore = await getOperations();
    // Await async work before asserting or releasing locks.
    await updateSetting({
      // Execute the next setup or assertion step for this scenario.
      key: "operations",
      // Execute the next setup or assertion step for this scenario.
      value: { ...opsBefore, hotelTimezone: "UTC" },
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "audit-20261105 tz UTC",
    });
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (opsBefore) {
      // Await async work before asserting or releasing locks.
      await updateSetting({
        // Execute the next setup or assertion step for this scenario.
        key: "operations",
        // Execute the next setup or assertion step for this scenario.
        value: opsBefore,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "audit-20261105 tz restore",
      });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) {
      // Await async work before asserting or releasing locks.
      await prisma.dailyPlanEntry.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { locationId: { in: [world.locationAId, world.locationBId] } },
      });
      // Await async work before asserting or releasing locks.
      await cleanupCleaningWorld(prisma, world);
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (attWorld) await cleanupAttendanceWorld(prisma, attWorld);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (shiftsWorld) await cleanupShiftsWorld(prisma, shiftsWorld);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await resetCleaningWork(prisma, world);
    // Await async work before asserting or releasing locks.
    await prisma.dailyPlanEntry.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { locationId: { in: [world.locationAId, world.locationBId] } },
    });
  });

  // ---------------------------------------------------------------------------
  // RISK-LOCK — markRoomDirty × startCleaningTask
  // ---------------------------------------------------------------------------
  describe("RISK-LOCK dirty vs start", () => {
    // Helper seedAssignedTask: arrange fixture data for the case.
    async function seedAssignedTask() {
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
      // Return the arranged value/result to the caller.
      return task;
    }

    // Case: sequential control both orders: dirty then start, and start then dirty.
    it("sequential control both orders: dirty then start, and start then dirty", async () => {
      {
        // task: seeded entity required before the mutation under test.
        const task = await seedAssignedTask();
        // Await async work before asserting or releasing locks.
        await markRoomDirty(world.locationAId, world.reception.employeeId);
        // started: synchronize actors so the race window is observable.
        const started = await startCleaningTask({
          // Execute the next setup or assertion step for this scenario.
          taskId: task.id,
          // Execute the next setup or assertion step for this scenario.
          employeeId: world.hk1.employeeId,
          // Execute the next setup or assertion step for this scenario.
          commandId: randomUUID(),
        });
        // Assert HTTP status matches the contract for this path.
        assert.equal(started.session.status, SessionStatus.running);
        // loc: synchronize actors so the race window is observable.
        const loc = await prisma.location.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: world.locationAId },
        });
        // Assert the observed value matches the intended post-condition.
        assert.equal(loc.cleaningStatus, CleaningStatus.in_progress);
      }

      // Await async work before asserting or releasing locks.
      await resetCleaningWork(prisma, world);

      {
        // task: seeded entity required before the mutation under test.
        const task = await seedAssignedTask();
        // started: synchronize actors so the race window is observable.
        const started = await startCleaningTask({
          // Execute the next setup or assertion step for this scenario.
          taskId: task.id,
          // Execute the next setup or assertion step for this scenario.
          employeeId: world.hk1.employeeId,
          // Execute the next setup or assertion step for this scenario.
          commandId: randomUUID(),
        });
        // Assert HTTP status matches the contract for this path.
        assert.equal(started.session.status, SessionStatus.running);
        // Await async work before asserting or releasing locks.
        await markRoomDirty(world.locationAId, world.reception.employeeId);
        // loc: synchronize actors so the race window is observable.
        const loc = await prisma.location.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: world.locationAId },
        });
        // Assert the observed value matches the intended post-condition.
        assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
        // finalTask: synchronize actors so the race window is observable.
        const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: task.id },
        });
        // Assert HTTP status matches the contract for this path.
        assert.equal(finalTask.status, TaskStatus.in_progress);
        // Assert the observed value matches the intended post-condition.
        assert.equal(finalTask.cleaningCycle, loc.cleaningCycle);
        // running: synchronize actors so the race window is observable.
        const running = await prisma.cleaningSession.count({
          // SQL fragment used to observe locks or assert DB state.
          where: { taskId: task.id, status: SessionStatus.running },
        });
        // Assert the observed value matches the intended post-condition.
        assert.equal(running, 1);
      }
    });

    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let rep = 1; rep <= 3; rep++) {
      // Case probes concurrency/isolation: concurrent dirty∥start must not deadlock (rep ${rep}).
      it(`concurrent dirty∥start must not deadlock (rep ${rep})`, async () => {
        // task: seeded entity required before the mutation under test.
        const task = await seedAssignedTask();
        // commandId: unique stamp so parallel runs do not collide.
        const commandId = randomUUID();

        // settled: synchronize actors so the race window is observable.
        const settled = await withDatabaseBarrier(
          // Execute the next setup or assertion step for this scenario.
          prisma,
          // Execute the next setup or assertion step for this scenario.
          (tx) =>
            // Execute the next setup or assertion step for this scenario.
            tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE`,
          // Execute the next setup or assertion step for this scenario.
          () =>
            // Run actors together to expose races and serialization bugs.
            Promise.allSettled([
              // Execute the next setup or assertion step for this scenario.
              markRoomDirty(world.locationAId, world.reception.employeeId),
              // Execute the next setup or assertion step for this scenario.
              startCleaningTask({
                // Execute the next setup or assertion step for this scenario.
                taskId: task.id,
                // Execute the next setup or assertion step for this scenario.
                employeeId: world.hk1.employeeId,
                // Execute the next setup or assertion step for this scenario.
                commandId,
              }),
            ]),
        );

        // Iterate to cover variants or wait until a condition holds.
        for (const result of settled) {
          // Guard optional cleanup or alternate assertion paths.
          if (result.status === "rejected") {
            // Assert the observed value matches the intended post-condition.
            assert.equal(
              // Concurrency/isolation step for the race under test.
              isPrismaDeadlock(result.reason),
              // Execute the next setup or assertion step for this scenario.
              false,
              // Concurrency/isolation step for the race under test.
              `must not deadlock: ${formatReject(result.reason)}`,
            );
          }
        }

        // Bind dirtyResult for later setup or assertions in this scope.
        const dirtyResult = settled[0]!;
        // Bind startResult for later setup or assertions in this scope.
        const startResult = settled[1]!;

        // Both operations are independently valid; neither may fail with a
        // deadlock. Structured 409 is acceptable only if business rules reject.
        if (dirtyResult.status === "rejected") {
          // Assert the observed value matches the intended post-condition.
          assert.ok(
            // Execute the next setup or assertion step for this scenario.
            isAppError(dirtyResult.reason),
            // Execute the next setup or assertion step for this scenario.
            `dirty loser must be AppError, got ${formatReject(dirtyResult.reason)}`,
          );
        }
        // Guard optional cleanup or alternate assertion paths.
        if (startResult.status === "rejected") {
          // Assert the observed value matches the intended post-condition.
          assert.ok(
            // Execute the next setup or assertion step for this scenario.
            isAppError(startResult.reason),
            // Execute the next setup or assertion step for this scenario.
            `start loser must be AppError, got ${formatReject(startResult.reason)}`,
          );
          // Assert the observed value matches the intended post-condition.
          assert.notEqual(
            // Execute the next setup or assertion step for this scenario.
            startResult.reason.status,
            // Execute the next setup or assertion step for this scenario.
            500,
            // Execute the next setup or assertion step for this scenario.
            "start must not fail as 500",
          );
        }

        // At least one must succeed; prefer both when no business conflict.
        const okCount = settled.filter((s) => s.status === "fulfilled").length;
        // Assert the observed value matches the intended post-condition.
        assert.ok(okCount >= 1, "at least one of dirty/start must commit");

        // Conditional path for setup, cleanup, or alternate outcomes.
        if (
          // Execute the next setup or assertion step for this scenario.
          dirtyResult.status === "fulfilled" &&
          // Execute the next setup or assertion step for this scenario.
          startResult.status === "fulfilled"
        // Execute the next setup or assertion step for this scenario.
        ) {
          // loc: synchronize actors so the race window is observable.
          const loc = await prisma.location.findUniqueOrThrow({
            // SQL fragment used to observe locks or assert DB state.
            where: { id: world.locationAId },
          });
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
          assert.ok(running, "session must remain running after both succeed");
          // Assert HTTP status matches the contract for this path.
          assert.equal(finalTask.status, TaskStatus.in_progress);
          // Assert the observed value matches the intended post-condition.
          assert.equal(finalTask.cleaningCycle, loc.cleaningCycle);
          // Assert the observed value matches the intended post-condition.
          assert.ok(
            // Execute the next setup or assertion step for this scenario.
            loc.cleaningStatus === CleaningStatus.dirty ||
              // Execute the next setup or assertion step for this scenario.
              loc.cleaningStatus === CleaningStatus.in_progress,
            // Execute the next setup or assertion step for this scenario.
            `unexpected cleaningStatus ${loc.cleaningStatus}`,
          );
        }

        // If only start succeeded, room should be in_progress with a session.
        if (
          // Execute the next setup or assertion step for this scenario.
          dirtyResult.status === "rejected" &&
          // Execute the next setup or assertion step for this scenario.
          startResult.status === "fulfilled"
        // Execute the next setup or assertion step for this scenario.
        ) {
          // running: synchronize actors so the race window is observable.
          const running = await prisma.cleaningSession.count({
            // SQL fragment used to observe locks or assert DB state.
            where: { taskId: task.id, status: SessionStatus.running },
          });
          // Assert the observed value matches the intended post-condition.
          assert.equal(running, 1);
        }

        // If only dirty succeeded, room is dirty and no running session.
        if (
          // Execute the next setup or assertion step for this scenario.
          dirtyResult.status === "fulfilled" &&
          // Execute the next setup or assertion step for this scenario.
          startResult.status === "rejected"
        // Execute the next setup or assertion step for this scenario.
        ) {
          // loc: synchronize actors so the race window is observable.
          const loc = await prisma.location.findUniqueOrThrow({
            // SQL fragment used to observe locks or assert DB state.
            where: { id: world.locationAId },
          });
          // Assert the observed value matches the intended post-condition.
          assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
        }
      });
    }
  });

  // ---------------------------------------------------------------------------
  // RISK-PLAN — daily plan vs reassign / priority
  // ---------------------------------------------------------------------------
  describe("RISK-PLAN assignment and priority", () => {
    // Case: control: reassign then priority plan keeps confirmed assignee A.
    it("control: reassign then priority plan keeps confirmed assignee A", async () => {
      // today: synchronize actors so the race window is observable.
      const today = await hotelTodayYmd();
      // task: seeded entity required before the mutation under test.
      const task = await createCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: today,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(task.assignedEmployeeId, null);

      // Await async work before asserting or releasing locks.
      await reassignCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk1.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "supervisor assigns A",
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        actorRole: Role.owner,
        // Execute the next setup or assertion step for this scenario.
        forceDespiteAvailability: true,
      });

      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await createDailyPlanEntry({
        // Execute the next setup or assertion step for this scenario.
        hotelDate: today,
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        category: DailyPlanCategory.priority,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        createdByEmployeeId: world.reception.employeeId,
      });

      // finalTask: synchronize actors so the race window is observable.
      const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: task.id },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(finalTask.assignedEmployeeId, world.hk1.employeeId);
      // Assert the observed value matches the intended post-condition.
      assert.equal(finalTask.priority, Priority.urgent);
      // Assert the observed value matches the intended post-condition.
      assert.equal(finalTask.reassignReason, "supervisor assigns A");
    });

    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let rep = 1; rep <= 2; rep++) {
      // Case probes concurrency/isolation: ordered race: reassign(A) then plan(B) must not silently overwrite A (rep ${rep}).
      it(`ordered race: reassign(A) then plan(B) must not silently overwrite A (rep ${rep})`, async () => {
        // today: synchronize actors so the race window is observable.
        const today = await hotelTodayYmd();
        // task: seeded entity required before the mutation under test.
        const task = await createCleaningTask({
          // Execute the next setup or assertion step for this scenario.
          locationId: world.locationAId,
          // Execute the next setup or assertion step for this scenario.
          hotelDate: today,
          // Execute the next setup or assertion step for this scenario.
          actorEmployeeId: world.owner.employeeId,
        });
        // Assert the observed value matches the intended post-condition.
        assert.equal(task.assignedEmployeeId, null);

        // Reassign acquires the task lock first; plan reads "unassigned" then
        // waits on UPDATE. Release order lets reassign commit A before plan write.
        const settled = await orderedDatabaseRace(
          // Execute the next setup or assertion step for this scenario.
          prisma,
          // Execute the next setup or assertion step for this scenario.
          (tx) =>
            // Execute the next setup or assertion step for this scenario.
            tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE`,
          // Execute the next setup or assertion step for this scenario.
          () =>
            // Execute the next setup or assertion step for this scenario.
            reassignCleaningTask({
              // Execute the next setup or assertion step for this scenario.
              taskId: task.id,
              // Execute the next setup or assertion step for this scenario.
              assignedEmployeeId: world.hk1.employeeId,
              // Execute the next setup or assertion step for this scenario.
              reason: "supervisor assigns A",
              // Execute the next setup or assertion step for this scenario.
              actorEmployeeId: world.owner.employeeId,
              // Execute the next setup or assertion step for this scenario.
              actorRole: Role.owner,
              // Execute the next setup or assertion step for this scenario.
              forceDespiteAvailability: true,
            }),
          // Execute the next setup or assertion step for this scenario.
          () =>
            // Seed prerequisite rows so the mutation under test has a realistic baseline.
            createDailyPlanEntry({
              // Execute the next setup or assertion step for this scenario.
              hotelDate: today,
              // Execute the next setup or assertion step for this scenario.
              locationId: world.locationAId,
              // Execute the next setup or assertion step for this scenario.
              category: DailyPlanCategory.priority,
              // Execute the next setup or assertion step for this scenario.
              assignedEmployeeId: world.hk2.employeeId,
              // Execute the next setup or assertion step for this scenario.
              createdByEmployeeId: world.reception.employeeId,
            }),
        );

        // Iterate to cover variants or wait until a condition holds.
        for (const result of settled) {
          // Guard optional cleanup or alternate assertion paths.
          if (result.status === "rejected") {
            // Assert the observed value matches the intended post-condition.
            assert.equal(
              // Concurrency/isolation step for the race under test.
              isPrismaDeadlock(result.reason),
              // Execute the next setup or assertion step for this scenario.
              false,
              // Concurrency/isolation step for the race under test.
              `must not deadlock: ${formatReject(result.reason)}`,
            );
          }
        }

        // Bind reassignResult for later setup or assertions in this scope.
        const reassignResult = settled[0]!;
        // Bind planResult for later setup or assertions in this scope.
        const planResult = settled[1]!;
        // finalTask: synchronize actors so the race window is observable.
        const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: task.id },
        });

        // Conditional path for setup, cleanup, or alternate outcomes.
        if (
          // Execute the next setup or assertion step for this scenario.
          reassignResult.status === "fulfilled" &&
          // Execute the next setup or assertion step for this scenario.
          planResult.status === "fulfilled"
        // Execute the next setup or assertion step for this scenario.
        ) {
          // Assert the observed value matches the intended post-condition.
          assert.equal(
            // Execute the next setup or assertion step for this scenario.
            finalTask.assignedEmployeeId,
            // Execute the next setup or assertion step for this scenario.
            world.hk1.employeeId,
            // Execute the next setup or assertion step for this scenario.
            `lost update: plan filled B over confirmed assignee A (got ${finalTask.assignedEmployeeId})`,
          );
          // Assert the observed value matches the intended post-condition.
          assert.equal(finalTask.priority, Priority.urgent);
          // Assert the observed value matches the intended post-condition.
          assert.equal(finalTask.reassignReason, "supervisor assigns A");
        // Execute the next setup or assertion step for this scenario.
        } else if (reassignResult.status === "fulfilled") {
          // Assert the observed value matches the intended post-condition.
          assert.equal(finalTask.assignedEmployeeId, world.hk1.employeeId);
        // Execute the next setup or assertion step for this scenario.
        } else if (planResult.status === "fulfilled") {
          // Assert the observed value matches the intended post-condition.
          assert.equal(finalTask.assignedEmployeeId, world.hk2.employeeId);
          // Assert the observed value matches the intended post-condition.
          assert.equal(finalTask.priority, Priority.urgent);
        // Execute the next setup or assertion step for this scenario.
        } else {
          // Fail fast when the expected race/waiter condition never appears.
          assert.fail("both reassign and plan failed");
        }
      });
    }

    // Case: control: priority then arrival keeps urgent.
    it("control: priority then arrival keeps urgent", async () => {
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
      // Assert the observed value matches the intended post-condition.
      assert.equal(task.priority, Priority.normal);

      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await createDailyPlanEntry({
        // Execute the next setup or assertion step for this scenario.
        hotelDate: today,
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        category: DailyPlanCategory.priority,
        // Execute the next setup or assertion step for this scenario.
        createdByEmployeeId: world.reception.employeeId,
      });
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await createDailyPlanEntry({
        // Execute the next setup or assertion step for this scenario.
        hotelDate: today,
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        category: DailyPlanCategory.arrival,
        // Execute the next setup or assertion step for this scenario.
        createdByEmployeeId: world.reception.employeeId,
      });

      // finalTask: synchronize actors so the race window is observable.
      const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: task.id },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(finalTask.priority, Priority.urgent);
    });

    // Case probes concurrency/isolation: ordered race: priority then arrival must keep urgent (not downgrade to high).
    it("ordered race: priority then arrival must keep urgent (not downgrade to high)", async () => {
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
      // Assert the observed value matches the intended post-condition.
      assert.equal(task.priority, Priority.normal);

      // Priority waits on UPDATE first; arrival reads stale "normal" then queues.
      // After release, priority commits urgent; arrival must not write high over it.
      const settled = await orderedDatabaseRace(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Execute the next setup or assertion step for this scenario.
        (tx) =>
          // Execute the next setup or assertion step for this scenario.
          tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE`,
        // Execute the next setup or assertion step for this scenario.
        () =>
          // Seed prerequisite rows so the mutation under test has a realistic baseline.
          createDailyPlanEntry({
            // Execute the next setup or assertion step for this scenario.
            hotelDate: today,
            // Execute the next setup or assertion step for this scenario.
            locationId: world.locationAId,
            // Execute the next setup or assertion step for this scenario.
            category: DailyPlanCategory.priority,
            // Execute the next setup or assertion step for this scenario.
            createdByEmployeeId: world.reception.employeeId,
          }),
        // Execute the next setup or assertion step for this scenario.
        () =>
          // Seed prerequisite rows so the mutation under test has a realistic baseline.
          createDailyPlanEntry({
            // Execute the next setup or assertion step for this scenario.
            hotelDate: today,
            // Execute the next setup or assertion step for this scenario.
            locationId: world.locationAId,
            // Execute the next setup or assertion step for this scenario.
            category: DailyPlanCategory.arrival,
            // Execute the next setup or assertion step for this scenario.
            createdByEmployeeId: world.owner.employeeId,
          }),
      );

      // Iterate to cover variants or wait until a condition holds.
      for (const result of settled) {
        // Guard optional cleanup or alternate assertion paths.
        if (result.status === "rejected") {
          // Assert the observed value matches the intended post-condition.
          assert.equal(
            // Concurrency/isolation step for the race under test.
            isPrismaDeadlock(result.reason),
            // Execute the next setup or assertion step for this scenario.
            false,
            // Concurrency/isolation step for the race under test.
            `must not deadlock: ${formatReject(result.reason)}`,
          );
        }
      }

      // Bind ok for later setup or assertions in this scope.
      const ok = settled.filter((s) => s.status === "fulfilled").length;
      // Assert the observed value matches the intended post-condition.
      assert.ok(ok >= 1, "at least one plan entry must succeed");

      // finalTask: synchronize actors so the race window is observable.
      const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: task.id },
      });

      // Conditional path for setup, cleanup, or alternate outcomes.
      if (ok === 2) {
        // Assert the observed value matches the intended post-condition.
        assert.equal(
          // Execute the next setup or assertion step for this scenario.
          finalTask.priority,
          // Execute the next setup or assertion step for this scenario.
          Priority.urgent,
          // Execute the next setup or assertion step for this scenario.
          `priority lost-update: expected urgent, got ${finalTask.priority}`,
        );
      // Execute the next setup or assertion step for this scenario.
      } else {
        // Assert the observed value matches the intended post-condition.
        assert.ok(
          // Execute the next setup or assertion step for this scenario.
          finalTask.priority === Priority.urgent ||
            // Execute the next setup or assertion step for this scenario.
            finalTask.priority === Priority.high,
          // Execute the next setup or assertion step for this scenario.
          `unexpected priority ${finalTask.priority}`,
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // RISK-ATTENDANCE — approve × late rebuild
  // ---------------------------------------------------------------------------
  describe("RISK-ATTENDANCE approve vs rebuild", () => {
    // Helper seedClosedShift: arrange fixture data for the case.
    async function seedClosedShift(
      // Execute the next setup or assertion step for this scenario.
      employeeId: string,
      // Execute the next setup or assertion step for this scenario.
      tag: string,
      // Execute the next setup or assertion step for this scenario.
      day: string,
    // Execute the next setup or assertion step for this scenario.
    ) {
      // stamp: unique stamp so parallel runs do not collide.
      const stamp = attWorld.stamp;
      // inRes: synchronize actors so the race window is observable.
      const inRes = await ingestEvent({
        // Execute the next setup or assertion step for this scenario.
        externalEventId: `aud-in-${tag}-${stamp}`,
        // Execute the next setup or assertion step for this scenario.
        source: "audit-20261105",
        // Execute the next setup or assertion step for this scenario.
        employeeId,
        // Concurrency/isolation step for the race under test.
        kind: AttendanceEventKind.clock_in,
        // Execute the next setup or assertion step for this scenario.
        deviceTime: `${day}T08:00:00.000Z`,
        // Execute the next setup or assertion step for this scenario.
        receivedAt: `${day}T08:00:05.000Z`,
      });
      // outRes: synchronize actors so the race window is observable.
      const outRes = await ingestEvent({
        // Execute the next setup or assertion step for this scenario.
        externalEventId: `aud-out-${tag}-${stamp}`,
        // Execute the next setup or assertion step for this scenario.
        source: "audit-20261105",
        // Execute the next setup or assertion step for this scenario.
        employeeId,
        // Concurrency/isolation step for the race under test.
        kind: AttendanceEventKind.clock_out,
        // Execute the next setup or assertion step for this scenario.
        deviceTime: `${day}T16:00:00.000Z`,
        // Execute the next setup or assertion step for this scenario.
        receivedAt: `${day}T16:00:05.000Z`,
      });
      // Assert the observed value matches the intended post-condition.
      assert.ok(inRes.created && outRes.created);
      // interval: synchronize actors so the race window is observable.
      const interval = await prisma.attendanceInterval.findFirstOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          employeeId,
          // Execute the next setup or assertion step for this scenario.
          startEventId: inRes.event.id,
          // Fixture field status for the seeded actor/entity.
          status: AttendanceIntervalStatus.closed,
        },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(interval.workedMinutes, 480);
      // Return the arranged value/result to the caller.
      return { interval, stamp, day };
    }

    // Case: control: approve then late punch keeps 450 worked minutes.
    it("control: approve then late punch keeps 450 worked minutes", async () => {
      // Bind emp for later setup or assertions in this scope.
      const emp = attWorld.technician.employeeId;
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      const { interval, stamp, day } = await seedClosedShift(
        // Execute the next setup or assertion step for this scenario.
        emp,
        // Execute the next setup or assertion step for this scenario.
        "ctrl",
        // Execute the next setup or assertion step for this scenario.
        "2026-04-10",
      );
      // adj: HTTP response captured for status/body checks.
      const adj = await requestAdjustment({
        // Execute the next setup or assertion step for this scenario.
        intervalId: interval.id,
        // Execute the next setup or assertion step for this scenario.
        requestedById: emp,
        // Execute the next setup or assertion step for this scenario.
        actorRole: Role.technician,
        // Execute the next setup or assertion step for this scenario.
        reason: "add break",
        // Execute the next setup or assertion step for this scenario.
        proposedBreakMinutes: 30,
      });
      // Await async work before asserting or releasing locks.
      await reviewAdjustment({
        // Execute the next setup or assertion step for this scenario.
        adjustmentId: adj.id,
        // Execute the next setup or assertion step for this scenario.
        reviewedById: attWorld.manager.employeeId,
        // Execute the next setup or assertion step for this scenario.
        decision: "approved",
      });

      // Await async work before asserting or releasing locks.
      await ingestEvent({
        // Execute the next setup or assertion step for this scenario.
        externalEventId: `aud-late-be-${stamp}`,
        // Execute the next setup or assertion step for this scenario.
        source: "audit-20261105",
        // Execute the next setup or assertion step for this scenario.
        employeeId: emp,
        // Execute the next setup or assertion step for this scenario.
        kind: AttendanceEventKind.break_end,
        // Execute the next setup or assertion step for this scenario.
        deviceTime: `${day}T12:30:00.000Z`,
        // Execute the next setup or assertion step for this scenario.
        receivedAt: `${day}T13:10:00.000Z`,
      });

      // after: synchronize actors so the race window is observable.
      const after = await prisma.attendanceInterval.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: interval.id },
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(after.status, AttendanceIntervalStatus.adjusted);
      // Assert the observed value matches the intended post-condition.
      assert.equal(after.workedMinutes, 450);
      // Assert the observed value matches the intended post-condition.
      assert.equal(after.breakMinutes, 30);

      // adjAfter: synchronize actors so the race window is observable.
      const adjAfter = await prisma.attendanceAdjustment.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: adj.id },
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(adjAfter.status, AttendanceAdjustmentStatus.approved);
    });

    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let rep = 1; rep <= 2; rep++) {
      // Case probes concurrency/isolation: ordered race: approve then late punch must preserve 450 minutes (rep ${rep}).
      it(`ordered race: approve then late punch must preserve 450 minutes (rep ${rep})`, async () => {
        // Bind emp for later setup or assertions in this scope.
        const emp =
          // Execute the next setup or assertion step for this scenario.
          rep === 1
            ? attWorld.housekeeper.employeeId
            : attWorld.otherHk.employeeId;
        // Bind actorRole for later setup or assertions in this scope.
        const actorRole = Role.housekeeper;
        // Bind day for later setup or assertions in this scope.
        const day = rep === 1 ? "2026-04-11" : "2026-04-12";
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        const { interval, stamp } = await seedClosedShift(emp, `race${rep}`, day);
        // adj: HTTP response captured for status/body checks.
        const adj = await requestAdjustment({
          // Execute the next setup or assertion step for this scenario.
          intervalId: interval.id,
          // Execute the next setup or assertion step for this scenario.
          requestedById: emp,
          // Execute the next setup or assertion step for this scenario.
          actorRole,
          // Concurrency/isolation step for the race under test.
          reason: "add break concurrent",
          // Execute the next setup or assertion step for this scenario.
          proposedBreakMinutes: 30,
        });

        // Hold the interval row so rebuild's deleteMany waits after snapshotting
        // the pre-approve non-adjusted id, while approve updates the same row.
        const settled = await orderedDatabaseRace(
          // Execute the next setup or assertion step for this scenario.
          prisma,
          // Execute the next setup or assertion step for this scenario.
          (tx) =>
            // Execute the next setup or assertion step for this scenario.
            tx.$queryRaw`SELECT id FROM "AttendanceInterval" WHERE id = ${interval.id} FOR UPDATE`,
          // Execute the next setup or assertion step for this scenario.
          () =>
            // Execute the next setup or assertion step for this scenario.
            reviewAdjustment({
              // Execute the next setup or assertion step for this scenario.
              adjustmentId: adj.id,
              // Execute the next setup or assertion step for this scenario.
              reviewedById: attWorld.manager.employeeId,
              // Execute the next setup or assertion step for this scenario.
              decision: "approved",
            }),
          // Execute the next setup or assertion step for this scenario.
          () =>
            // Execute the next setup or assertion step for this scenario.
            ingestEvent({
              // Concurrency/isolation step for the race under test.
              externalEventId: `aud-race-be-${rep}-${stamp}`,
              // Execute the next setup or assertion step for this scenario.
              source: "audit-20261105",
              // Execute the next setup or assertion step for this scenario.
              employeeId: emp,
              // Execute the next setup or assertion step for this scenario.
              kind: AttendanceEventKind.break_end,
              // Execute the next setup or assertion step for this scenario.
              deviceTime: `${day}T12:30:00.000Z`,
              // Execute the next setup or assertion step for this scenario.
              receivedAt: `${day}T13:10:00.000Z`,
            }),
        );

        // Iterate to cover variants or wait until a condition holds.
        for (const result of settled) {
          // Guard optional cleanup or alternate assertion paths.
          if (result.status === "rejected") {
            // Assert the observed value matches the intended post-condition.
            assert.equal(
              // Concurrency/isolation step for the race under test.
              isPrismaDeadlock(result.reason),
              // Execute the next setup or assertion step for this scenario.
              false,
              // Concurrency/isolation step for the race under test.
              `must not deadlock: ${formatReject(result.reason)}`,
            );
          }
        }

        // Bind reviewResult for later setup or assertions in this scope.
        const reviewResult = settled[0]!;
        // Bind ingestResult for later setup or assertions in this scope.
        const ingestResult = settled[1]!;

        // intervals: synchronize actors so the race window is observable.
        const intervals = await prisma.attendanceInterval.findMany({
          // SQL fragment used to observe locks or assert DB state.
          where: { employeeId: emp, hotelDate: interval.hotelDate },
          // Execute the next setup or assertion step for this scenario.
          orderBy: { startedAt: "asc" },
        });
        // adjustments: synchronize actors so the race window is observable.
        const adjustments = await prisma.attendanceAdjustment.findMany({
          // SQL fragment used to observe locks or assert DB state.
          where: {
            // SQL fragment used to observe locks or assert DB state.
            OR: [
              // Execute the next setup or assertion step for this scenario.
              { id: adj.id },
              // Execute the next setup or assertion step for this scenario.
              { interval: { employeeId: emp, hotelDate: interval.hotelDate } },
            ],
          },
        });
        // audits: synchronize actors so the race window is observable.
        const audits = await prisma.auditEvent.findMany({
          // SQL fragment used to observe locks or assert DB state.
          where: {
            // Execute the next setup or assertion step for this scenario.
            entityType: "attendance_adjustment",
            // Execute the next setup or assertion step for this scenario.
            entityId: adj.id,
          },
          // Execute the next setup or assertion step for this scenario.
          orderBy: { occurredAt: "asc" },
        });

        // Guard optional cleanup or alternate assertion paths.
        if (reviewResult.status === "fulfilled") {
          // approvedAdj: in-process HTTP server handle for this suite.
          const approvedAdj = adjustments.find((a) => a.id === adj.id);
          // Assert the observed value matches the intended post-condition.
          assert.ok(
            // Execute the next setup or assertion step for this scenario.
            approvedAdj,
            // Execute the next setup or assertion step for this scenario.
            `approved adjustment row missing; adjustments=${JSON.stringify(
              adjustments.map((a) => ({ id: a.id, status: a.status })),
            )} intervals=${JSON.stringify(
              intervals.map((i) => ({
                id: i.id,
                status: i.status,
                worked: i.workedMinutes,
              })),
            // Execute the next setup or assertion step for this scenario.
            )}`,
          );
          // Assert the observed value matches the intended post-condition.
          assert.equal(
            // Execute the next setup or assertion step for this scenario.
            approvedAdj.status,
            // Execute the next setup or assertion step for this scenario.
            AttendanceAdjustmentStatus.approved,
            // Execute the next setup or assertion step for this scenario.
            "approved adjustment must remain approved",
          );
          // Bind frozen for later setup or assertions in this scope.
          const frozen = intervals.find(
            // Execute the next setup or assertion step for this scenario.
            (iv) => iv.status === AttendanceIntervalStatus.adjusted,
          );
          // Assert the observed value matches the intended post-condition.
          assert.ok(frozen, "adjusted interval must survive rebuild");
          // Assert the observed value matches the intended post-condition.
          assert.equal(frozen.workedMinutes, 450);
          // Assert the observed value matches the intended post-condition.
          assert.equal(frozen.breakMinutes, 30);
          // Assert the observed value matches the intended post-condition.
          assert.ok(
            // Execute the next setup or assertion step for this scenario.
            audits.some((a) => a.action === "adjustment.review"),
            // Execute the next setup or assertion step for this scenario.
            "approval audit must remain",
          );
        // Execute the next setup or assertion step for this scenario.
        } else {
          // Assert the observed value matches the intended post-condition.
          assert.ok(
            // Execute the next setup or assertion step for this scenario.
            isAppError(reviewResult.reason),
            // Execute the next setup or assertion step for this scenario.
            `review loser must be AppError, got ${formatReject(reviewResult.reason)}`,
          );
          // Assert the observed value matches the intended post-condition.
          assert.ok(
            // Execute the next setup or assertion step for this scenario.
            reviewResult.reason.status === 404 ||
              // Execute the next setup or assertion step for this scenario.
              reviewResult.reason.status === 409,
            // Execute the next setup or assertion step for this scenario.
            `unexpected review failure ${formatReject(reviewResult.reason)}`,
          );
        }

        // Conditional path for setup, cleanup, or alternate outcomes.
        if (
          // Execute the next setup or assertion step for this scenario.
          reviewResult.status === "fulfilled" &&
          // Execute the next setup or assertion step for this scenario.
          ingestResult.status === "fulfilled"
        // Execute the next setup or assertion step for this scenario.
        ) {
          // Bind frozen for later setup or assertions in this scope.
          const frozen = intervals.find(
            // Execute the next setup or assertion step for this scenario.
            (iv) => iv.status === AttendanceIntervalStatus.adjusted,
          );
          // Assert the observed value matches the intended post-condition.
          assert.ok(
            // Execute the next setup or assertion step for this scenario.
            frozen && frozen.workedMinutes === 450,
            // Execute the next setup or assertion step for this scenario.
            `lost approved correction: intervals=${JSON.stringify(
              intervals.map((i) => ({
                id: i.id,
                status: i.status,
                worked: i.workedMinutes,
                brk: i.breakMinutes,
              })),
            )} adjustments=${JSON.stringify(
              adjustments.map((a) => ({ id: a.id, status: a.status })),
            // Execute the next setup or assertion step for this scenario.
            )}`,
          );
        }
      });
    }

    // Case probes concurrency/isolation: ordered race: ingest-first then approve settles without silent data loss.
    it("ordered race: ingest-first then approve settles without silent data loss", async () => {
      // Bind emp for later setup or assertions in this scope.
      const emp = attWorld.otherHk.employeeId;
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      const { interval, stamp, day } = await seedClosedShift(
        // Execute the next setup or assertion step for this scenario.
        emp,
        // Execute the next setup or assertion step for this scenario.
        "ord",
        // Execute the next setup or assertion step for this scenario.
        "2026-04-13",
      );
      // adj: HTTP response captured for status/body checks.
      const adj = await requestAdjustment({
        // Execute the next setup or assertion step for this scenario.
        intervalId: interval.id,
        // Execute the next setup or assertion step for this scenario.
        requestedById: emp,
        // Execute the next setup or assertion step for this scenario.
        actorRole: Role.housekeeper,
        // Concurrency/isolation step for the race under test.
        reason: "ordered race break",
        // Execute the next setup or assertion step for this scenario.
        proposedBreakMinutes: 30,
      });

      // settled: synchronize actors so the race window is observable.
      const settled = await orderedDatabaseRace(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Execute the next setup or assertion step for this scenario.
        (tx) =>
          // Execute the next setup or assertion step for this scenario.
          tx.$queryRaw`SELECT id FROM "AttendanceAdjustment" WHERE id = ${adj.id} FOR UPDATE`,
        // Execute the next setup or assertion step for this scenario.
        () =>
          // Execute the next setup or assertion step for this scenario.
          ingestEvent({
            // Execute the next setup or assertion step for this scenario.
            externalEventId: `aud-ord-be-${stamp}`,
            // Execute the next setup or assertion step for this scenario.
            source: "audit-20261105",
            // Execute the next setup or assertion step for this scenario.
            employeeId: emp,
            // Execute the next setup or assertion step for this scenario.
            kind: AttendanceEventKind.break_end,
            // Execute the next setup or assertion step for this scenario.
            deviceTime: `${day}T12:30:00.000Z`,
            // Execute the next setup or assertion step for this scenario.
            receivedAt: `${day}T13:10:00.000Z`,
          }),
        // Execute the next setup or assertion step for this scenario.
        () =>
          // Execute the next setup or assertion step for this scenario.
          reviewAdjustment({
            // Execute the next setup or assertion step for this scenario.
            adjustmentId: adj.id,
            // Execute the next setup or assertion step for this scenario.
            reviewedById: attWorld.manager.employeeId,
            // Execute the next setup or assertion step for this scenario.
            decision: "approved",
          }),
      );

      // Iterate to cover variants or wait until a condition holds.
      for (const result of settled) {
        // Guard optional cleanup or alternate assertion paths.
        if (result.status === "rejected") {
          // Assert the observed value matches the intended post-condition.
          assert.equal(isPrismaDeadlock(result.reason), false);
        }
      }

      // intervals: synchronize actors so the race window is observable.
      const intervals = await prisma.attendanceInterval.findMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { employeeId: emp, hotelDate: interval.hotelDate },
      });
      // adjustments: synchronize actors so the race window is observable.
      const adjustments = await prisma.attendanceAdjustment.findMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // SQL fragment used to observe locks or assert DB state.
          OR: [
            // Execute the next setup or assertion step for this scenario.
            { id: adj.id },
            // Execute the next setup or assertion step for this scenario.
            { interval: { employeeId: emp, hotelDate: interval.hotelDate } },
          ],
        },
      });

      // approved: in-process HTTP server handle for this suite.
      const approved = adjustments.find(
        // Execute the next setup or assertion step for this scenario.
        (a) => a.status === AttendanceAdjustmentStatus.approved,
      );
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (approved) {
        // Bind frozen for later setup or assertions in this scope.
        const frozen = intervals.find(
          // Execute the next setup or assertion step for this scenario.
          (iv) => iv.status === AttendanceIntervalStatus.adjusted,
        );
        // Assert the observed value matches the intended post-condition.
        assert.ok(frozen);
        // Assert the observed value matches the intended post-condition.
        assert.equal(frozen!.workedMinutes, 450);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Additional existing-style guarantees
  // ---------------------------------------------------------------------------
  describe("additional concurrency guarantees", () => {
    // Case probes concurrency/isolation: identical concurrent starts → one running session.
    it("identical concurrent starts → one running session", async () => {
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
      // commandId: unique stamp so parallel runs do not collide.
      const commandId = randomUUID();
      // settled: synchronize actors so the race window is observable.
      const settled = await withDatabaseBarrier(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Execute the next setup or assertion step for this scenario.
        (tx) =>
          // Execute the next setup or assertion step for this scenario.
          tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE`,
        // Execute the next setup or assertion step for this scenario.
        () =>
          // Run actors together to expose races and serialization bugs.
          Promise.allSettled([
            // Execute the next setup or assertion step for this scenario.
            startCleaningTask({
              // Execute the next setup or assertion step for this scenario.
              taskId: task.id,
              // Execute the next setup or assertion step for this scenario.
              employeeId: world.hk1.employeeId,
              // Execute the next setup or assertion step for this scenario.
              commandId,
            }),
            // Execute the next setup or assertion step for this scenario.
            startCleaningTask({
              // Execute the next setup or assertion step for this scenario.
              taskId: task.id,
              // Execute the next setup or assertion step for this scenario.
              employeeId: world.hk1.employeeId,
              // Execute the next setup or assertion step for this scenario.
              commandId,
            }),
          ]),
      );
      // Bind ok for later setup or assertions in this scope.
      const ok = settled.filter((s) => s.status === "fulfilled");
      // Assert collection size matches the expected post-condition.
      assert.equal(ok.length, 2);
      // running: synchronize actors so the race window is observable.
      const running = await prisma.cleaningSession.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { taskId: task.id, status: SessionStatus.running },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(running, 1);
    });

    // Case: complete∥cancel → one coherent terminal outcome.
    it("complete∥cancel → one coherent terminal outcome", async () => {
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
      // started: synchronize actors so the race window is observable.
      const started = await startCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk1.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
      });

      // settled: synchronize actors so the race window is observable.
      const settled = await withDatabaseBarrier(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Execute the next setup or assertion step for this scenario.
        (tx) =>
          // Session/CSRF step exercising auth lifecycle.
          tx.$queryRaw`SELECT id FROM "CleaningSession" WHERE id = ${started.session.id} FOR UPDATE`,
        // Execute the next setup or assertion step for this scenario.
        () =>
          // Run actors together to expose races and serialization bugs.
          Promise.allSettled([
            // Session/CSRF step exercising auth lifecycle.
            completeCleaningSession({
              // Session/CSRF step exercising auth lifecycle.
              sessionId: started.session.id,
              // Execute the next setup or assertion step for this scenario.
              employeeId: world.hk1.employeeId,
              // Execute the next setup or assertion step for this scenario.
              notes: "done",
              // Execute the next setup or assertion step for this scenario.
              commandId: randomUUID(),
              // Execute the next setup or assertion step for this scenario.
              expectedVersion: started.task.version,
            }),
            // Session/CSRF step exercising auth lifecycle.
            cancelCleaningSession({
              // Session/CSRF step exercising auth lifecycle.
              sessionId: started.session.id,
              // Execute the next setup or assertion step for this scenario.
              employeeId: world.hk1.employeeId,
              // Execute the next setup or assertion step for this scenario.
              notes: "abort",
              // Execute the next setup or assertion step for this scenario.
              commandId: randomUUID(),
              // Execute the next setup or assertion step for this scenario.
              expectedVersion: started.task.version,
            }),
          ]),
      );

      // Bind ok for later setup or assertions in this scope.
      const ok = settled.filter((s) => s.status === "fulfilled");
      // Bind fail for later setup or assertions in this scope.
      const fail = settled.filter((s) => s.status === "rejected");
      // Assert collection size matches the expected post-condition.
      assert.equal(ok.length, 1);
      // Assert collection size matches the expected post-condition.
      assert.equal(fail.length, 1);
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError((fail[0] as PromiseRejectedResult).reason));

      // session: session cookie jar for authenticated requests.
      const session = await prisma.cleaningSession.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: started.session.id },
      });
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Session/CSRF step exercising auth lifecycle.
        session.status === SessionStatus.completed ||
          // Session/CSRF step exercising auth lifecycle.
          session.status === SessionStatus.cancelled,
      );
      // finalTask: synchronize actors so the race window is observable.
      const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: task.id },
      });
      // Guard optional cleanup or alternate assertion paths.
      if (session.status === SessionStatus.completed) {
        // Assert HTTP status matches the contract for this path.
        assert.equal(finalTask.status, TaskStatus.awaiting_inspection);
      // Execute the next setup or assertion step for this scenario.
      } else {
        // Assert the observed value matches the intended post-condition.
        assert.ok(
          // Execute the next setup or assertion step for this scenario.
          finalTask.status === TaskStatus.assigned ||
            // Execute the next setup or assertion step for this scenario.
            finalTask.status === TaskStatus.rework,
        );
      }
    });

    // Case: stale approve after dirty bump does not re-verify clean.
    it("stale approve after dirty bump does not re-verify clean", async () => {
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
      // started: synchronize actors so the race window is observable.
      const started = await startCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk1.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
      });
      // completed: synchronize actors so the race window is observable.
      const completed = await completeCleaningSession({
        // Session/CSRF step exercising auth lifecycle.
        sessionId: started.session.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk1.employeeId,
        // Execute the next setup or assertion step for this scenario.
        notes: "done",
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: started.task.version,
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(completed.task.status, TaskStatus.awaiting_inspection);

      // Await async work before asserting or releasing locks.
      await appPrisma.$transaction(async (tx) => {
        // Await async work before asserting or releasing locks.
        await bumpDirtyAndRebindWork(tx, world.locationAId);
      });
      // locAfterBump: synchronize actors so the race window is observable.
      const locAfterBump = await prisma.location.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: world.locationAId },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(locAfterBump.cleaningStatus, CleaningStatus.dirty);

      // Approve on a superseded cycle is soft-guarded: task may complete, but
      // location must stay dirty (not verified_clean).
      await inspectCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        inspectorEmployeeId: world.manager.employeeId,
        // Execute the next setup or assertion step for this scenario.
        result: "approved",
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
      });

      // loc: synchronize actors so the race window is observable.
      const loc = await prisma.location.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: world.locationAId },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
      // Assert the observed value matches the intended post-condition.
      assert.equal(loc.cleaningCycle, locAfterBump.cleaningCycle);
    });

    // Case probes concurrency/isolation: concurrent roster replaces do not mix employees across winning sets.
    it("concurrent roster replaces do not mix employees across winning sets", async () => {
      // Bind hotelDate for later setup or assertions in this scope.
      const hotelDate = "2099-07-20";
      // Bind hotelDateDt for later setup or assertions in this scope.
      const hotelDateDt = new Date(`${hotelDate}T00:00:00.000Z`);
      // Bind setA for later setup or assertions in this scope.
      const setA = [
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: shiftsWorld.employeeA.employeeId,
          // Execute the next setup or assertion step for this scenario.
          shiftId: shiftsWorld.shiftMorningId,
        },
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: shiftsWorld.employeeB.employeeId,
          // Execute the next setup or assertion step for this scenario.
          shiftId: shiftsWorld.shiftMorningId,
        },
      ];
      // Bind setB for later setup or assertions in this scope.
      const setB = [
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: shiftsWorld.employeeA.employeeId,
          // Execute the next setup or assertion step for this scenario.
          shiftId: shiftsWorld.shiftEveningId,
        },
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: shiftsWorld.employeeC.employeeId,
          // Execute the next setup or assertion step for this scenario.
          shiftId: shiftsWorld.shiftEveningId,
        },
      ];

      // Await async work before asserting or releasing locks.
      await prisma.employeeShiftRoster.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { hotelDate: hotelDateDt },
      });

      // settled: synchronize actors so the race window is observable.
      const settled = await withDatabaseBarrier(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Concurrency/isolation step for the race under test.
        (tx) => tx.$executeRaw`LOCK TABLE "EmployeeShiftRoster" IN SHARE ROW EXCLUSIVE MODE`,
        // Execute the next setup or assertion step for this scenario.
        () =>
          // Run actors together to expose races and serialization bugs.
          Promise.allSettled([
            // Seed prerequisite rows so the mutation under test has a realistic baseline.
            upsertShiftRoster({ hotelDate, entries: setA }),
            // Seed prerequisite rows so the mutation under test has a realistic baseline.
            upsertShiftRoster({ hotelDate, entries: setB }),
          ]),
        2,
      );

      // Iterate to cover variants or wait until a condition holds.
      for (const result of settled) {
        // Guard optional cleanup or alternate assertion paths.
        if (result.status === "rejected") {
          // Assert the observed value matches the intended post-condition.
          assert.equal(isPrismaDeadlock(result.reason), false);
        }
      }

      // final: synchronize actors so the race window is observable.
      const final = await listShiftRoster(hotelDate);
      // Bind pairs for later setup or assertions in this scope.
      const pairs = (
        // Execute the next setup or assertion step for this scenario.
        final.entries as Array<{
          // Execute the next setup or assertion step for this scenario.
          employee: { id: string };
          // Execute the next setup or assertion step for this scenario.
          shift: { id: string };
        }>
      )
        // Continue the call chain for setup or assertion detail.
        .map((e) => `${e.employee.id}:${e.shift.id}`)
        // Continue the call chain for setup or assertion detail.
        .sort()
        // Continue the call chain for setup or assertion detail.
        .join("|");
      // Bind aKey for later setup or assertions in this scope.
      const aKey = setA
        // Continue the call chain for setup or assertion detail.
        .map((e) => `${e.employeeId}:${e.shiftId}`)
        // Continue the call chain for setup or assertion detail.
        .sort()
        // Continue the call chain for setup or assertion detail.
        .join("|");
      // Bind bKey for later setup or assertions in this scope.
      const bKey = setB
        // Continue the call chain for setup or assertion detail.
        .map((e) => `${e.employeeId}:${e.shiftId}`)
        // Continue the call chain for setup or assertion detail.
        .sort()
        // Continue the call chain for setup or assertion detail.
        .join("|");
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        pairs === aKey || pairs === bKey,
        // Execute the next setup or assertion step for this scenario.
        `hybrid roster mix detected: ${pairs}`,
      );
    });
  });
});
