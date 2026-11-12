/**
 * 15d, — assignee eligibility + reassign constraints.
 */
import assert from "node:assert/strict";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import bindings from node:path.
import path from "node:path";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient, Role, TaskStatus } from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CLEANING_ASSIGNEE_MESSAGE,
  // Execute the next setup or assertion step for this scenario.
  MAINTENANCE_ASSIGNEE_MESSAGE,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/assignees";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  createCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  reassignCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  startCleaningTask,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/cleaning";
// Import bindings from ../../src/services/cleaning/locks.
import { lockLocation } from "../../src/services/cleaning/locks";
// Import bindings from ../../src/services/maintenance.
import { assignMaintenanceTicket } from "../../src/services/maintenance";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  countActiveTasks,
  // Execute the next setup or assertion step for this scenario.
  createCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  createOpenMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  isAppError,
  // Execute the next setup or assertion step for this scenario.
  resetCleaningWork,
  // Concurrency/isolation step for the race under test.
  runEligibilityChangeBeforeRace,
  // Concurrency/isolation step for the race under test.
  runWhileRowLocked,
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

// Suite: cleaning lifecycle reassign (15b–d/27).
describe("cleaning lifecycle reassign (15b–d/27)", () => {
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
    // Reactivate / restore roles that may have mutated.
    await prisma.user.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.hk1.userId },
      // Execute the next setup or assertion step for this scenario.
      data: { isActive: true, role: Role.housekeeper },
    });
    // Await async work before asserting or releasing locks.
    await prisma.user.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.hk2.userId },
      // Execute the next setup or assertion step for this scenario.
      data: { isActive: true, role: Role.housekeeper },
    });
    // Await async work before asserting or releasing locks.
    await prisma.user.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.technician.userId },
      // Execute the next setup or assertion step for this scenario.
      data: { isActive: true, role: Role.technician },
    });
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) {
      // Await async work before asserting or releasing locks.
      await prisma.user.updateMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { employeeId: { in: world.employeeIds } },
        // Execute the next setup or assertion step for this scenario.
        data: { isActive: true },
      });
      // Await async work before asserting or releasing locks.
      await cleanupCleaningWorld(prisma, world);
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: create/reassign/assign reject deactivated assignees.
  it("create/reassign/assign reject deactivated assignees", async () => {
    // today: synchronize actors so the race window is observable.
    const today = await hotelTodayYmd();

    // Await async work before asserting or releasing locks.
    await prisma.user.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.hk2.userId },
      // Execute the next setup or assertion step for this scenario.
      data: { isActive: false },
    });

    // Try path where partial failure must not leak suite state.
    try {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await createCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: today,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected validation on create with blocked HK");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert HTTP status matches the contract for this path.
      assert.equal(err.status, 400);
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "validation");
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.message, CLEANING_ASSIGNEE_MESSAGE);
    }

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
      await reassignCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk2.employeeId,
        // Concurrency/isolation step for the race under test.
        reason: "try blocked",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.manager.employeeId,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected validation on reassign to blocked HK");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "validation");
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.message, CLEANING_ASSIGNEE_MESSAGE);
    }

    // Await async work before asserting or releasing locks.
    await prisma.user.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.technician.userId },
      // Execute the next setup or assertion step for this scenario.
      data: { isActive: false },
    });
    // ticket: seeded entity required before the mutation under test.
    const ticket = await createOpenMaintenanceTicket(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
    );
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await assignMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        assigneeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.manager.employeeId,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected validation on assign to blocked technician");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "validation");
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.message, MAINTENANCE_ASSIGNEE_MESSAGE);
    }
  });

  // Case probes concurrency/isolation: concurrent block/role-change vs reassign after eligibility check.
  it("concurrent block/role-change vs reassign after eligibility check", async () => {
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

    // Queue the eligibility mutation before the in-transaction user recheck.
    try {
      // Await async work before asserting or releasing locks.
      await runEligibilityChangeBeforeRace({
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Concurrency/isolation step for the race under test.
        acquireLock: (tx) => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${world.hk2.userId} FOR SHARE`,
        // Execute the next setup or assertion step for this scenario.
        startMutation: () => prisma.user.update({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: world.hk2.userId },
          // Execute the next setup or assertion step for this scenario.
          data: { isActive: false },
        }),
        // Concurrency/isolation step for the race under test.
        startRace: () =>
          // Execute the next setup or assertion step for this scenario.
          reassignCleaningTask({
            // Execute the next setup or assertion step for this scenario.
            taskId: task.id,
            // Execute the next setup or assertion step for this scenario.
            assignedEmployeeId: world.hk2.employeeId,
            // Concurrency/isolation step for the race under test.
            reason: "race against block",
            // Execute the next setup or assertion step for this scenario.
            expectedVersion: task.version,
            // Execute the next setup or assertion step for this scenario.
            actorEmployeeId: world.manager.employeeId,
          }),
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected validation after mid-flight deactivate");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "validation");
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.message, CLEANING_ASSIGNEE_MESSAGE);
    }

    // afterBlock: synchronize actors so the race window is observable.
    const afterBlock = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: task.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(afterBlock.assignedEmployeeId, world.hk1.employeeId);

    // Role demotion race (same lock-hold pattern).
    await prisma.user.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.hk2.userId },
      // Execute the next setup or assertion step for this scenario.
      data: { isActive: true, role: Role.housekeeper },
    });

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await runEligibilityChangeBeforeRace({
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Concurrency/isolation step for the race under test.
        acquireLock: (tx) => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${world.hk2.userId} FOR SHARE`,
        // Execute the next setup or assertion step for this scenario.
        startMutation: () => prisma.user.update({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: world.hk2.userId },
          // Execute the next setup or assertion step for this scenario.
          data: { role: Role.reception },
        }),
        // Concurrency/isolation step for the race under test.
        startRace: () =>
          // Execute the next setup or assertion step for this scenario.
          reassignCleaningTask({
            // Execute the next setup or assertion step for this scenario.
            taskId: task.id,
            // Execute the next setup or assertion step for this scenario.
            assignedEmployeeId: world.hk2.employeeId,
            // Concurrency/isolation step for the race under test.
            reason: "race against role change",
            // Concurrency/isolation step for the race under test.
            expectedVersion: afterBlock.version,
            // Execute the next setup or assertion step for this scenario.
            actorEmployeeId: world.manager.employeeId,
          }),
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected validation after mid-flight role demotion");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "validation");
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.message, CLEANING_ASSIGNEE_MESSAGE);
    }

    // afterRole: synchronize actors so the race window is observable.
    const afterRole = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: task.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(afterRole.assignedEmployeeId, world.hk1.employeeId);
  });

  // Case probes concurrency/isolation: concurrent block/role-change vs createCleaningTask.
  it("concurrent block/role-change vs createCleaningTask", async () => {
    // today: synchronize actors so the race window is observable.
    const today = await hotelTodayYmd();

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await runWhileRowLocked({
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Concurrency/isolation step for the race under test.
        acquireLock: (tx) => lockLocation(tx, world.locationAId),
        // Concurrency/isolation step for the race under test.
        startRace: () =>
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
        // Concurrency/isolation step for the race under test.
        whileBlocked: async () => {
          // Await async work before asserting or releasing locks.
          await prisma.user.update({
            // SQL fragment used to observe locks or assert DB state.
            where: { id: world.hk2.userId },
            // Execute the next setup or assertion step for this scenario.
            data: { isActive: false },
          });
        },
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected validation after mid-flight deactivate on create");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "validation");
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.message, CLEANING_ASSIGNEE_MESSAGE);
    }
    // Assert collection size matches the expected post-condition.
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 0);

    // Await async work before asserting or releasing locks.
    await prisma.user.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.hk2.userId },
      // Execute the next setup or assertion step for this scenario.
      data: { isActive: true, role: Role.housekeeper },
    });

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await runWhileRowLocked({
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Concurrency/isolation step for the race under test.
        acquireLock: (tx) => lockLocation(tx, world.locationAId),
        // Concurrency/isolation step for the race under test.
        startRace: () =>
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
        // Concurrency/isolation step for the race under test.
        whileBlocked: async () => {
          // Await async work before asserting or releasing locks.
          await prisma.user.update({
            // SQL fragment used to observe locks or assert DB state.
            where: { id: world.hk2.userId },
            // Execute the next setup or assertion step for this scenario.
            data: { role: Role.reception },
          });
        },
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected validation after mid-flight role demotion on create");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "validation");
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.message, CLEANING_ASSIGNEE_MESSAGE);
    }
    // Assert collection size matches the expected post-condition.
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 0);
  });

  // Case probes concurrency/isolation: concurrent block/role-change vs assignMaintenanceTicket.
  it("concurrent block/role-change vs assignMaintenanceTicket", async () => {
    // ticket: seeded entity required before the mutation under test.
    const ticket = await createOpenMaintenanceTicket(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
    );

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await runEligibilityChangeBeforeRace({
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Concurrency/isolation step for the race under test.
        acquireLock: (tx) => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${world.technician.userId} FOR SHARE`,
        // Execute the next setup or assertion step for this scenario.
        startMutation: () => prisma.user.update({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: world.technician.userId },
          // Execute the next setup or assertion step for this scenario.
          data: { isActive: false },
        }),
        // Concurrency/isolation step for the race under test.
        startRace: () =>
          // Execute the next setup or assertion step for this scenario.
          assignMaintenanceTicket({
            // Execute the next setup or assertion step for this scenario.
            ticketId: ticket.id,
            // Execute the next setup or assertion step for this scenario.
            assigneeId: world.technician.employeeId,
            // Execute the next setup or assertion step for this scenario.
            actorEmployeeId: world.manager.employeeId,
          }),
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected validation after mid-flight deactivate on assign");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "validation");
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.message, MAINTENANCE_ASSIGNEE_MESSAGE);
    }

    // afterBlock: synchronize actors so the race window is observable.
    const afterBlock = await prisma.maintenanceTicket.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: ticket.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(afterBlock.assigneeId, null);

    // Await async work before asserting or releasing locks.
    await prisma.user.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.technician.userId },
      // Execute the next setup or assertion step for this scenario.
      data: { isActive: true, role: Role.technician },
    });

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await runEligibilityChangeBeforeRace({
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Concurrency/isolation step for the race under test.
        acquireLock: (tx) => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${world.technician.userId} FOR SHARE`,
        // Execute the next setup or assertion step for this scenario.
        startMutation: () => prisma.user.update({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: world.technician.userId },
          // Execute the next setup or assertion step for this scenario.
          data: { role: Role.reception },
        }),
        // Concurrency/isolation step for the race under test.
        startRace: () =>
          // Execute the next setup or assertion step for this scenario.
          assignMaintenanceTicket({
            // Execute the next setup or assertion step for this scenario.
            ticketId: ticket.id,
            // Execute the next setup or assertion step for this scenario.
            assigneeId: world.technician.employeeId,
            // Execute the next setup or assertion step for this scenario.
            actorEmployeeId: world.manager.employeeId,
          }),
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected validation after mid-flight role demotion on assign");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "validation");
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.message, MAINTENANCE_ASSIGNEE_MESSAGE);
    }

    // afterRole: synchronize actors so the race window is observable.
    const afterRole = await prisma.maintenanceTicket.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: ticket.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(afterRole.assigneeId, null);
  });

  // Case probes concurrency/isolation: reassign requires reason, blocks running, version conflict, success.
  it("reassign requires reason, blocks running, version conflict, success", async () => {
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
      await reassignCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "   ",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.manager.employeeId,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected validation on empty reason");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "validation");
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
      await reassignCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "while running",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: started.task.version,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.manager.employeeId,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected failure while session running / in_progress");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // in_progress → invalid_state before running-session check; running on
      // assigned/rework/awaiting_inspection → conflict.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        err.code === "invalid_state" || err.code === "conflict",
        // Execute the next setup or assertion step for this scenario.
        `unexpected code ${err.code}`,
      );
    }

    // Await async work before asserting or releasing locks.
    await resetCleaningWork(prisma, world);
    // task2: seeded entity required before the mutation under test.
    const task2 = await createCleaningTask({
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
      await reassignCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: task2.id,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "stale version",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task2.version - 1,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.manager.employeeId,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected version_conflict");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(isAppError(err));
      // Assert the observed value matches the intended post-condition.
      assert.equal(err.code, "version_conflict");
    }

    // updated: synchronize actors so the race window is observable.
    const updated = await reassignCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: task2.id,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk2.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "coverage swap",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: task2.version,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(updated.assignedEmployeeId, world.hk2.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(updated.reassignReason, "coverage swap");
    // Assert the observed value matches the intended post-condition.
    assert.equal(updated.version, task2.version + 1);
    // Assert HTTP status matches the contract for this path.
    assert.equal(updated.status, TaskStatus.assigned);
  });

  // Iterate to cover variants or wait until a condition holds.
  for (const status of [TaskStatus.completed, TaskStatus.cancelled, TaskStatus.rework, TaskStatus.awaiting_inspection]) {
    // Case: reassign matrix for ${status} preserves unrelated state.
    it(`reassign matrix for ${status} preserves unrelated state`, async () => {
      // task: seeded entity required before the mutation under test.
      const task = await createCleaningTask({
        // Await async work before asserting or releasing locks.
        locationId: world.locationAId, hotelDate: await hotelTodayYmd(),
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk1.employeeId, actorEmployeeId: world.owner.employeeId,
      });
      // Isolate the state policy from lifecycle preparation (covered separately).
      const before = await prisma.cleaningTask.update({ where: { id: task.id }, data: { status } });
      // location: synchronize actors so the race window is observable.
      const location = await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } });
      // audits: synchronize actors so the race window is observable.
      const audits = await prisma.auditEvent.findMany({ where: { entityId: task.id }, orderBy: { id: "asc" } });
      // notifications: synchronize actors so the race window is observable.
      const notifications = await prisma.notification.findMany({ where: { entityId: task.id }, orderBy: { id: "asc" } });
      // Bind operation for later setup or assertions in this scope.
      const operation = () => reassignCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id, assignedEmployeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "  coverage  ", expectedVersion: before.version, actorEmployeeId: world.manager.employeeId,
      });
      // Guard optional cleanup or alternate assertion paths.
      if (status === TaskStatus.completed || status === TaskStatus.cancelled) {
        // Await async work before asserting or releasing locks.
        await assert.rejects(operation(), (err: unknown) => isAppError(err) && err.code === "invalid_state");
        // Assert the observed value matches the intended post-condition.
        assert.deepEqual(await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } }), before);
        // Assert the observed value matches the intended post-condition.
        assert.deepEqual(await prisma.auditEvent.findMany({ where: { entityId: task.id }, orderBy: { id: "asc" } }), audits);
        // Assert the observed value matches the intended post-condition.
        assert.deepEqual(await prisma.notification.findMany({ where: { entityId: task.id }, orderBy: { id: "asc" } }), notifications);
      // Execute the next setup or assertion step for this scenario.
      } else {
        // updated: synchronize actors so the race window is observable.
        const updated = await operation();
        // Assert HTTP status matches the contract for this path.
        assert.equal(updated.status, status);
        // Assert the observed value matches the intended post-condition.
        assert.equal(updated.assignedEmployeeId, world.hk2.employeeId);
        // Assert the observed value matches the intended post-condition.
        assert.equal(updated.version, before.version + 1);
        // Assert the observed value matches the intended post-condition.
        assert.equal(updated.reassignReason, "coverage");
        // Assert collection size matches the expected post-condition.
        assert.equal(await prisma.auditEvent.count({ where: { entityId: task.id, action: "cleaning.task.reassign" } }), 1);
      }
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } }), location);
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.cleaningSession.count({ where: { taskId: task.id } }), 0);
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.inspection.count({ where: { taskId: task.id } }), 0);
    });
  }

  // Case probes concurrency/isolation: running session blocks reassignment even when task appears idle.
  it("running session blocks reassignment even when task appears idle", async () => {
    // task: seeded entity required before the mutation under test.
    const task = await createCleaningTask({
      // Await async work before asserting or releasing locks.
      locationId: world.locationAId, hotelDate: await hotelTodayYmd(), assignedEmployeeId: world.hk1.employeeId,
    });
    // started: unique stamp so parallel runs do not collide.
    const started = await startCleaningTask({ taskId: task.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: task.version });
    // before: synchronize actors so the race window is observable.
    const before = await prisma.cleaningTask.update({ where: { id: task.id }, data: { status: TaskStatus.assigned } });
    // Await async work before asserting or releasing locks.
    await assert.rejects(reassignCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      taskId: task.id, assignedEmployeeId: world.hk2.employeeId, reason: "idle-looking task", expectedVersion: before.version,
    // Execute the next setup or assertion step for this scenario.
    }), (err: unknown) => isAppError(err) && err.code === "conflict");
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } }), before);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await prisma.cleaningSession.findUniqueOrThrow({ where: { id: started.session.id } }), started.session);
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.auditEvent.count({ where: { entityId: task.id, action: "cleaning.task.reassign" } }), 0);
  });
});
