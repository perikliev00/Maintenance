/**
 * 14,22–26,30 — dates, cancel, stale soft-guard, idempotency, markDirty.
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
  createDualDayRunningSetup,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  hotelYmdAt,
  // Execute the next setup or assertion step for this scenario.
  isAppError,
  // Execute the next setup or assertion step for this scenario.
  resetCleaningWork,
  // Execute the next setup or assertion step for this scenario.
  withHotelNowForTests,
  // Execute the next setup or assertion step for this scenario.
  withOperationsPatch,
  // Pagination step for list/contract coverage.
  ymdOffset,
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

// Suite: cleaning lifecycle sessions (14/22–26/30).
describe("cleaning lifecycle sessions (14/22–26/30)", () => {
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

  // Case: cannot start future hotelDate task.
  it("cannot start future hotelDate task", async () => {
    // today: synchronize actors so the race window is observable.
    const today = await hotelTodayYmd();
    // Bind future for later setup or assertions in this scope.
    const future = ymdOffset(today, 2);
    // task: seeded entity required before the mutation under test.
    const task = await createCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: future,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.cleaningCycle, 0);

    // locBefore: synchronize actors so the race window is observable.
    const locBefore = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await startCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk1.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected invalid_state for future start");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "invalid_state");
      // Assert the observed value matches the intended post-condition.
      assert.match(err.message, /hotel date/i);
    }

    // sessions: session cookie jar for authenticated requests.
    const sessions = await prisma.cleaningSession.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { taskId: task.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(sessions, 0);

    // locAfter: synchronize actors so the race window is observable.
    const locAfter = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(locAfter.cleaningStatus, locBefore.cleaningStatus);
    // Assert the observed value matches the intended post-condition.
    assert.equal(locAfter.cleaningCycle, locBefore.cleaningCycle);
  });

  // Case: hotel TZ midnight — startCleaningTask uses hotel today.
  it("hotel TZ midnight — startCleaningTask uses hotel today", async () => {
    // 2026-03-15 03:00 UTC = still 2026-03-14 in America/New_York.
    const instant = new Date("2026-03-15T03:00:00.000Z");
    // Bind zone for later setup or assertions in this scope.
    const zone = "America/New_York";
    // Bind hotelToday for later setup or assertions in this scope.
    const hotelToday = hotelYmdAt(instant, zone);
    // Bind utcToday for later setup or assertions in this scope.
    const utcToday = instant.toISOString().slice(0, 10);
    // Assert the observed value matches the intended post-condition.
    assert.equal(hotelToday, "2026-03-14");
    // Assert the observed value matches the intended post-condition.
    assert.equal(utcToday, "2026-03-15");
    // A naive UTC-date check would treat utcToday as startable; hotel TZ must not.

    await withOperationsPatch(
      // Execute the next setup or assertion step for this scenario.
      world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      { hotelTimezone: zone },
      // Execute the next setup or assertion step for this scenario.
      async () => {
        // Await async work before asserting or releasing locks.
        await withHotelNowForTests(instant, async () => {
          // hotelDate = UTC calendar today, still future in hotel TZ.
          const task = await createCleaningTask({
            // Execute the next setup or assertion step for this scenario.
            locationId: world.locationAId,
            // Execute the next setup or assertion step for this scenario.
            hotelDate: utcToday,
            // Execute the next setup or assertion step for this scenario.
            assignedEmployeeId: world.hk1.employeeId,
            // Execute the next setup or assertion step for this scenario.
            actorEmployeeId: world.owner.employeeId,
          });
          // Assert the observed value matches the intended post-condition.
          assert.equal(task.cleaningCycle, 0);

          // locBefore: synchronize actors so the race window is observable.
          const locBefore = await prisma.location.findUniqueOrThrow({
            // SQL fragment used to observe locks or assert DB state.
            where: { id: world.locationAId },
          });

          // Try path where partial failure must not leak suite state.
          try {
            // Await async work before asserting or releasing locks.
            await startCleaningTask({
              // Execute the next setup or assertion step for this scenario.
              taskId: task.id,
              // Execute the next setup or assertion step for this scenario.
              employeeId: world.hk1.employeeId,
              // Execute the next setup or assertion step for this scenario.
              commandId: randomUUID(),
              // Execute the next setup or assertion step for this scenario.
              expectedVersion: task.version,
            });
            // Assert we are on the isolated test DB, not a seed/prod database.
            assert.fail("expected future hotel-date start to fail at NY midnight");
          // Execute the next setup or assertion step for this scenario.
          } catch (err) {
            // Assert the observed value matches the intended post-condition.
            assert.ok(isAppError(err));
            // Assert the observed value matches the intended post-condition.
            assert.equal(err.code, "invalid_state");
            // Assert the observed value matches the intended post-condition.
            assert.match(err.message, /hotel date/i);
          }

          // sessions: session cookie jar for authenticated requests.
          const sessions = await prisma.cleaningSession.count({
            // SQL fragment used to observe locks or assert DB state.
            where: { taskId: task.id },
          });
          // Assert the observed value matches the intended post-condition.
          assert.equal(sessions, 0);

          // locAfter: synchronize actors so the race window is observable.
          const locAfter = await prisma.location.findUniqueOrThrow({
            // SQL fragment used to observe locks or assert DB state.
            where: { id: world.locationAId },
          });
          // Assert the observed value matches the intended post-condition.
          assert.equal(locAfter.cleaningStatus, locBefore.cleaningStatus);
          // Assert the observed value matches the intended post-condition.
          assert.equal(locAfter.cleaningCycle, locBefore.cleaningCycle);
        });
      },
    );

    // Reverse boundary: Europe/Sofia evening UTC is already hotel next day.
    await resetCleaningWork(prisma, world);
    // Bind sofiaInstant for later setup or assertions in this scope.
    const sofiaInstant = new Date("2026-03-14T22:30:00.000Z");
    // Bind sofiaZone for later setup or assertions in this scope.
    const sofiaZone = "Europe/Sofia";
    // Bind sofiaToday for later setup or assertions in this scope.
    const sofiaToday = hotelYmdAt(sofiaInstant, sofiaZone);
    // Assert the observed value matches the intended post-condition.
    assert.equal(sofiaToday, "2026-03-15");
    // Assert the observed value matches the intended post-condition.
    assert.equal(sofiaInstant.toISOString().slice(0, 10), "2026-03-14");

    // Await async work before asserting or releasing locks.
    await withOperationsPatch(
      // Execute the next setup or assertion step for this scenario.
      world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      { hotelTimezone: sofiaZone },
      // Execute the next setup or assertion step for this scenario.
      async () => {
        // Await async work before asserting or releasing locks.
        await withHotelNowForTests(sofiaInstant, async () => {
          // task: seeded entity required before the mutation under test.
          const task = await createCleaningTask({
            // Execute the next setup or assertion step for this scenario.
            locationId: world.locationAId,
            // Execute the next setup or assertion step for this scenario.
            hotelDate: sofiaToday,
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
            // Execute the next setup or assertion step for this scenario.
            expectedVersion: task.version,
          });
          // Assert HTTP status matches the contract for this path.
          assert.equal(started.task.status, TaskStatus.in_progress);
          // Assert the observed value matches the intended post-condition.
          assert.ok(
            // Execute the next setup or assertion step for this scenario.
            started.task.cleaningCycle > 0,
            // Execute the next setup or assertion step for this scenario.
            "hotel-today task must bind cycle when TZ says today",
          );
        });
      },
    );
  });

  // Case: unbound cycle binds on start for today.
  it("unbound cycle binds on start for today", async () => {
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
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: task.id },
      // Execute the next setup or assertion step for this scenario.
      data: { cleaningCycle: 0 },
    });

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

    // Assert HTTP status matches the contract for this path.
    assert.equal(started.task.status, TaskStatus.in_progress);
    // Assert the observed value matches the intended post-condition.
    assert.ok(started.task.cleaningCycle > 0);
    // loc: synchronize actors so the race window is observable.
    const loc = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(started.task.cleaningCycle, loc.cleaningCycle);
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningStatus, CleaningStatus.in_progress);
    // Assert HTTP status matches the contract for this path.
    assert.equal(started.session.status, SessionStatus.running);
  });

  // Case: cancel returns task to assigned and room dirty.
  it("cancel returns task to assigned and room dirty", async () => {
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    const { started } = await createAndStartToday(
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      world.hk1.employeeId,
    );
    // cancelled: synchronize actors so the race window is observable.
    const cancelled = await cancelCleaningSession({
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
    // Assert HTTP status matches the contract for this path.
    assert.equal(cancelled.session.status, SessionStatus.cancelled);
    // Assert HTTP status matches the contract for this path.
    assert.equal(cancelled.task.status, TaskStatus.assigned);
    // loc: synchronize actors so the race window is observable.
    const loc = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
  });

  // Case: cancel old session does not stomp newer room.
  it("cancel old session does not stomp newer room", async () => {
    // setup: seeded entity required before the mutation under test.
    const setup = await createDualDayRunningSetup(prisma, world);

    // locBefore: synchronize actors so the race window is observable.
    const locBefore = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(locBefore.cleaningStatus, CleaningStatus.in_progress);

    // Await async work before asserting or releasing locks.
    await cancelCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: setup.day1SessionId,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: setup.day1Version,
      // Session/CSRF step exercising auth lifecycle.
      bypassSessionOwnerCheck: true,
    });

    // locAfter: synchronize actors so the race window is observable.
    const locAfter = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(locAfter.cleaningStatus, CleaningStatus.in_progress);

    // day2Session: session cookie jar for authenticated requests.
    const day2Session = await prisma.cleaningSession.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: setup.day2SessionId },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(day2Session.status, SessionStatus.running);
  });

  // Case: complete old session does not verify newer room.
  it("complete old session does not verify newer room", async () => {
    // Assert the observed value matches the intended post-condition.
    assert.equal((await getFlags()).require_inspection, true);
    // setup: seeded entity required before the mutation under test.
    const setup = await createDualDayRunningSetup(prisma, world);

    // completed: synchronize actors so the race window is observable.
    const completed = await completeCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: setup.day1SessionId,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: setup.day1Version,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(completed.task.status, TaskStatus.awaiting_inspection);

    // loc: synchronize actors so the race window is observable.
    const loc = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningStatus, CleaningStatus.in_progress);

    // day2Session: session cookie jar for authenticated requests.
    const day2Session = await prisma.cleaningSession.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: setup.day2SessionId },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(day2Session.status, SessionStatus.running);

    // day2Task: synchronize actors so the race window is observable.
    const day2Task = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: setup.day2TaskId },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(day2Task.status, TaskStatus.in_progress);
  });

  // Case checks idempotent replay safety: matching commandId replay is idempotent.
  it("matching commandId replay is idempotent", async () => {
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
    // startCmd: unique stamp so parallel runs do not collide.
    const startCmd = randomUUID();
    // firstStart: synchronize actors so the race window is observable.
    const firstStart = await startCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: task.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: startCmd,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: task.version,
    });
    // Assert replay/idempotent path did not create duplicates.
    assert.equal(firstStart.idempotent, false);
    // secondStart: synchronize actors so the race window is observable.
    const secondStart = await startCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: task.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: startCmd,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: task.version,
    });
    // Assert replay/idempotent path did not create duplicates.
    assert.equal(secondStart.idempotent, true);
    // Assert the observed value matches the intended post-condition.
    assert.equal(secondStart.session.id, firstStart.session.id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.cleaningSession.count({ where: { taskId: task.id } }),
      1,
      // Session/CSRF step exercising auth lifecycle.
      "start replay must not create a second session",
    );

    // completeCmd: unique stamp so parallel runs do not collide.
    const completeCmd = randomUUID();
    // firstComplete: synchronize actors so the race window is observable.
    const firstComplete = await completeCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: firstStart.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: completeCmd,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: firstStart.task.version,
    });
    // Assert replay/idempotent path did not create duplicates.
    assert.equal(firstComplete.idempotent, false);
    // secondComplete: synchronize actors so the race window is observable.
    const secondComplete = await completeCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: firstStart.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: completeCmd,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: firstStart.task.version,
    });
    // Assert replay/idempotent path did not create duplicates.
    assert.equal(secondComplete.idempotent, true);
    // Assert the observed value matches the intended post-condition.
    assert.equal(secondComplete.session.id, firstComplete.session.id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.cleaningSession.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { taskId: task.id, status: SessionStatus.completed },
      }),
      1,
      // Session/CSRF step exercising auth lifecycle.
      "complete replay must not create a second completed session",
    );

    // inspectCmd: unique stamp so parallel runs do not collide.
    const inspectCmd = randomUUID();
    // firstInspect: synchronize actors so the race window is observable.
    const firstInspect = await inspectCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: firstComplete.task.id,
      // Execute the next setup or assertion step for this scenario.
      inspectorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: inspectCmd,
      // Execute the next setup or assertion step for this scenario.
      result: "approved",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: firstComplete.task.version,
    });
    // Assert replay/idempotent path did not create duplicates.
    assert.equal(firstInspect.idempotent, false);
    // secondInspect: synchronize actors so the race window is observable.
    const secondInspect = await inspectCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: firstComplete.task.id,
      // Execute the next setup or assertion step for this scenario.
      inspectorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: inspectCmd,
      // Execute the next setup or assertion step for this scenario.
      result: "approved",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: firstComplete.task.version,
    });
    // Assert replay/idempotent path did not create duplicates.
    assert.equal(secondInspect.idempotent, true);
    // Assert the observed value matches the intended post-condition.
    assert.equal(secondInspect.inspection.id, firstInspect.inspection.id);

    // inspectCount: synchronize actors so the race window is observable.
    const inspectCount = await prisma.inspection.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { taskId: firstComplete.task.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(inspectCount, 1);

    // Cancel path: fresh session
    await resetCleaningWork(prisma, world);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    const { started: forCancel } = await createAndStartToday(
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      world.hk1.employeeId,
    );
    // cancelCmd: unique stamp so parallel runs do not collide.
    const cancelCmd = randomUUID();
    // firstCancel: synchronize actors so the race window is observable.
    const firstCancel = await cancelCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: forCancel.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: cancelCmd,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: forCancel.task.version,
      // Session/CSRF step exercising auth lifecycle.
      bypassSessionOwnerCheck: true,
    });
    // Assert replay/idempotent path did not create duplicates.
    assert.equal(firstCancel.idempotent, false);
    // secondCancel: synchronize actors so the race window is observable.
    const secondCancel = await cancelCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: forCancel.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: cancelCmd,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: forCancel.task.version,
      // Session/CSRF step exercising auth lifecycle.
      bypassSessionOwnerCheck: true,
    });
    // Assert replay/idempotent path did not create duplicates.
    assert.equal(secondCancel.idempotent, true);
    // Assert the observed value matches the intended post-condition.
    assert.equal(secondCancel.session.id, firstCancel.session.id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.cleaningSession.count({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Session/CSRF step exercising auth lifecycle.
          id: forCancel.session.id,
          // Fixture field status for the seeded actor/entity.
          status: SessionStatus.cancelled,
        },
      }),
      1,
    );
  });

  // Case: same commandId with different task/employee/decision conflicts.
  it("same commandId with different task/employee/decision conflicts", async () => {
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
      assignedEmployeeId: world.hk2.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
    });

    // startCmd: unique stamp so parallel runs do not collide.
    const startCmd = randomUUID();
    // startedA: synchronize actors so the race window is observable.
    const startedA = await startCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: taskA.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: startCmd,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: taskA.version,
    });

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await startCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: taskB.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: startCmd,
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: taskB.version,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected conflict for start commandId on different task");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "conflict");
      // Assert the observed value matches the intended post-condition.
      assert.match(err.message, /commandId reused/i);
    }

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await startCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: taskA.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: startCmd,
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: startedA.task.version,
        // Execute the next setup or assertion step for this scenario.
        bypassAssigneeCheck: true,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected conflict for start commandId with different employee");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "conflict");
    }

    // startedB: synchronize actors so the race window is observable.
    const startedB = await startCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: taskB.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk2.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: taskB.version,
    });

    // completeCmd: unique stamp so parallel runs do not collide.
    const completeCmd = randomUUID();
    // completedA: synchronize actors so the race window is observable.
    const completedA = await completeCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: startedA.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: completeCmd,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: startedA.task.version,
    });

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await completeCleaningSession({
        // Session/CSRF step exercising auth lifecycle.
        sessionId: startedB.session.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: completeCmd,
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: startedB.task.version,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected conflict for complete commandId on different session");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "conflict");
    }

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await completeCleaningSession({
        // Session/CSRF step exercising auth lifecycle.
        sessionId: startedA.session.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: completeCmd,
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: completedA.task.version,
        // Session/CSRF step exercising auth lifecycle.
        bypassSessionOwnerCheck: true,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected conflict for complete commandId with different actor");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "conflict");
    }

    // cancelCmd: unique stamp so parallel runs do not collide.
    const cancelCmd = randomUUID();
    // cancelledB: synchronize actors so the race window is observable.
    const cancelledB = await cancelCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: startedB.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk2.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: cancelCmd,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: startedB.task.version,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(cancelledB.session.status, SessionStatus.cancelled);

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await cancelCleaningSession({
        // Session/CSRF step exercising auth lifecycle.
        sessionId: startedB.session.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: cancelCmd,
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: cancelledB.task.version,
        // Session/CSRF step exercising auth lifecycle.
        bypassSessionOwnerCheck: true,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected conflict for cancel commandId with different actor");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "conflict");
    }

    // Restart B and reuse cancelCmd against the new session → conflict.
    const startedB2 = await startCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: cancelledB.task.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk2.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: cancelledB.task.version,
    });
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await cancelCleaningSession({
        // Session/CSRF step exercising auth lifecycle.
        sessionId: startedB2.session.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: cancelCmd,
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: startedB2.task.version,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected conflict for cancel commandId on different session");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "conflict");
    }

    // inspectCmd: unique stamp so parallel runs do not collide.
    const inspectCmd = randomUUID();
    // Await async work before asserting or releasing locks.
    await inspectCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: completedA.task.id,
      // Execute the next setup or assertion step for this scenario.
      inspectorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: inspectCmd,
      // Execute the next setup or assertion step for this scenario.
      result: "approved",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: completedA.task.version,
    });

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await inspectCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: completedA.task.id,
        // Execute the next setup or assertion step for this scenario.
        inspectorEmployeeId: world.manager.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: inspectCmd,
        // Execute the next setup or assertion step for this scenario.
        result: "rejected",
        // Execute the next setup or assertion step for this scenario.
        findings: "should not flip decision",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: completedA.task.version,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected conflict for inspect commandId with different decision");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "conflict");
    }

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await inspectCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: completedA.task.id,
        // Execute the next setup or assertion step for this scenario.
        inspectorEmployeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: inspectCmd,
        // Execute the next setup or assertion step for this scenario.
        result: "approved",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: completedA.task.version,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected conflict for inspect commandId with different inspector");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "conflict");
    }

    // Original outcomes must remain unchanged after rejected collisions.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.cleaningSession.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { startCommandId: startCmd },
      }),
      1,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.cleaningSession.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { completeCommandId: completeCmd },
      }),
      1,
    );
    // inspection: synchronize actors so the race window is observable.
    const inspection = await prisma.inspection.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { commandId: inspectCmd },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(inspection.result, "approved");
    // Assert the observed value matches the intended post-condition.
    assert.equal(inspection.inspectorEmployeeId, world.manager.employeeId);

    // taskAAfter: synchronize actors so the race window is observable.
    const taskAAfter = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: taskA.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(taskAAfter.status, TaskStatus.completed);

    // sessionB: session cookie jar for authenticated requests.
    const sessionB = await prisma.cleaningSession.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: startedB.session.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(sessionB.status, SessionStatus.cancelled);
    // Assert the observed value matches the intended post-condition.
    assert.equal(sessionB.cancelActorEmployeeId, world.hk2.employeeId);
    // sessionB2: session cookie jar for authenticated requests.
    const sessionB2 = await prisma.cleaningSession.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: startedB2.session.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(sessionB2.status, SessionStatus.running);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.cleaningSession.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { cancelCommandId: cancelCmd },
      }),
      1,
    );
  });

  // Case: markDirty during running rebinds and complete updates room.
  it("markDirty during running rebinds and complete updates room", async () => {
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
    // Bind cycleBefore for later setup or assertions in this scope.
    const cycleBefore = started.task.cleaningCycle;

    // Await async work before asserting or releasing locks.
    await markRoomDirty(world.locationAId, world.owner.employeeId);

    // taskAfterDirty: synchronize actors so the race window is observable.
    const taskAfterDirty = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: started.task.id },
    });
    // locAfterDirty: synchronize actors so the race window is observable.
    const locAfterDirty = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(locAfterDirty.cleaningStatus, CleaningStatus.dirty);
    // Assert the observed value matches the intended post-condition.
    assert.equal(taskAfterDirty.cleaningCycle, locAfterDirty.cleaningCycle);
    // Assert the observed value matches the intended post-condition.
    assert.ok(taskAfterDirty.cleaningCycle > cycleBefore);

    // completed: synchronize actors so the race window is observable.
    const completed = await completeCleaningSession({
      // Session/CSRF step exercising auth lifecycle.
      sessionId: started.session.id,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: taskAfterDirty.version,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(completed.task.status, TaskStatus.awaiting_inspection);

    // locAfterComplete: synchronize actors so the race window is observable.
    const locAfterComplete = await prisma.location.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.locationAId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(locAfterComplete.cleaningStatus, CleaningStatus.pending_inspection);
  });
});
