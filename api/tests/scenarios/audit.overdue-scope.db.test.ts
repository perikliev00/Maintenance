/**
 * remainder: overdue-session audit events with locationId are visible
 * under sector/location scope; foreign rooms stay hidden.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  createCleaningWorld,
  // Shape CleaningWorld documents the fixture/response fields this suite touches.
  type CleaningWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../cleaning/fixtures";
// Import bindings from ../../src/services/jobs/overdueSessions.
import { runOverdueSessions } from "../../src/services/jobs/overdueSessions";
// Import bindings from ../../src/services/audit.
import { listAuditEvents } from "../../src/services/audit";
// Import bindings from ../../src/services/settings.
import { getSetting, updateSetting } from "../../src/services/settings";

// Suite: audit overdue location scope.
describe("audit overdue location scope", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: CleaningWorld;
  // Execute the next setup or assertion step for this scenario.
  let operations: Awaited<ReturnType<typeof getSetting<"operations">>>;
  // Bind now for later setup or assertions in this scope.
  const now = Date.parse("2026-02-02T12:00:00Z");

  // Local helper overdueSession used by cases in this file.
  async function overdueSession(locationId: string, employeeId: string) {
    // task: seeded entity required before the mutation under test.
    const task = await prisma.cleaningTask.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        locationId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date("2026-02-02"),
        // Fixture field status for the seeded actor/entity.
        status: "cancelled",
        // Execute the next setup or assertion step for this scenario.
        cleaningCycle: 0,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: employeeId,
      },
    });
    // Return the arranged value/result to the caller.
    return prisma.cleaningSession.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        employeeId,
        // Fixture field status for the seeded actor/entity.
        status: "running",
        // Execute the next setup or assertion step for this scenario.
        startedAt: new Date(now - 61 * 60_000),
        // Execute the next setup or assertion step for this scenario.
        startCommandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        anomalyFlags: [],
      },
    });
  }

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma);
    // Await async work before asserting or releasing locks.
    operations = await getSetting("operations");
    // Await async work before asserting or releasing locks.
    await updateSetting({
      // Execute the next setup or assertion step for this scenario.
      key: "operations",
      // Session/CSRF step exercising auth lifecycle.
      value: { ...operations, overdueSessionMinutes: 60 },
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "audit overdue scope baseline",
    });
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) {
      // Await async work before asserting or releasing locks.
      await updateSetting({
        // Execute the next setup or assertion step for this scenario.
        key: "operations",
        // Execute the next setup or assertion step for this scenario.
        value: operations,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "restore",
      });
      // Await async work before asserting or releasing locks.
      await prisma.notification.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { locationId: { in: [world.locationAId, world.locationBId] } },
      });
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          locationId: { in: [world.locationAId, world.locationBId] },
          // Session/CSRF step exercising auth lifecycle.
          action: "session.overdue_detected",
        },
      });
      // Await async work before asserting or releasing locks.
      await prisma.cleaningSession.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          task: { locationId: { in: [world.locationAId, world.locationBId] } },
        },
      });
      // Await async work before asserting or releasing locks.
      await prisma.cleaningTask.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { locationId: { in: [world.locationAId, world.locationBId] } },
      });
      // Await async work before asserting or releasing locks.
      await cleanupCleaningWorld(prisma, world);
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: scoped list includes own-room overdue and excludes foreign-room overdue.
  it("scoped list includes own-room overdue and excludes foreign-room overdue", async (t) => {
    // Execute the next setup or assertion step for this scenario.
    t.mock.timers.enable({ apis: ["Date"], now });
    // Try path where partial failure must not leak suite state.
    try {
      // own: synchronize actors so the race window is observable.
      const own = await overdueSession(world.locationAId, world.hk1.employeeId);
      // foreign: synchronize actors so the race window is observable.
      const foreign = await overdueSession(
        // Execute the next setup or assertion step for this scenario.
        world.locationBId,
        // Execute the next setup or assertion step for this scenario.
        world.hk2.employeeId,
      );

      // result: synchronize actors so the race window is observable.
      const result = await runOverdueSessions();
      // Assert the observed value matches the intended post-condition.
      assert.ok(result.flagged >= 2);

      // ownScoped: synchronize actors so the race window is observable.
      const ownScoped = await listAuditEvents({
        // Session/CSRF step exercising auth lifecycle.
        action: "session.overdue_detected",
        // Execute the next setup or assertion step for this scenario.
        scopeLocationIds: [world.locationAId],
        // Pagination step for list/contract coverage.
        limit: 50,
      });
      // Assert the observed value matches the intended post-condition.
      assert.ok(ownScoped.some((row) => row.entityId === own.id));
      // Assert the observed value matches the intended post-condition.
      assert.ok(ownScoped.every((row) => row.locationId === world.locationAId));
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        ownScoped.some((row) => row.entityId === foreign.id),
        // Execute the next setup or assertion step for this scenario.
        false,
      );

      // byLocation: synchronize actors so the race window is observable.
      const byLocation = await listAuditEvents({
        // Session/CSRF step exercising auth lifecycle.
        action: "session.overdue_detected",
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Pagination step for list/contract coverage.
        limit: 50,
      });
      // Assert the observed value matches the intended post-condition.
      assert.ok(byLocation.some((row) => row.entityId === own.id));
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        byLocation.some((row) => row.entityId === foreign.id),
        // Execute the next setup or assertion step for this scenario.
        false,
      );

      // Await async work before asserting or releasing locks.
      await prisma.cleaningSession.updateMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: { in: [own.id, foreign.id] } },
        // Execute the next setup or assertion step for this scenario.
        data: { status: "completed", finishedAt: new Date(now) },
      });
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Execute the next setup or assertion step for this scenario.
      t.mock.timers.reset();
    }
  });
});
