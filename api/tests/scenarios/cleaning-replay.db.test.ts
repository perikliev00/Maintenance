// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, it } from "node:test";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { withDatabaseBarrier } from "../dbBarrier";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createCleaningWorld, cleanupCleaningWorld, createAndStartToday, type CleaningWorld } from "../cleaning/fixtures";
// Import bindings from ../../src/services/cleaning.
import { cancelCleaningSession, completeCleaningSession, inspectCleaningTask, createCleaningTask, startCleaningTask } from "../../src/services/cleaning";
// Shared test fixtures for seeding users, locations, and domain entities.
import { hotelTodayYmd } from "../cleaning/fixtures";
// Import bindings from ../../src/events/bus.
import { subscribe } from "../../src/events/bus";
// Import bindings from ../../src/services/notifications.
import { recipientsForLocationOps } from "../../src/services/notifications";

// Execute the next setup or assertion step for this scenario.
let world: CleaningWorld;
// Arrange shared preconditions before cases run.
before(async () => { await assertTestDatabase(prisma); world = await createCleaningWorld(prisma); });
// Release servers/DB clients so later suites stay isolated.
after(async () => { if (world) await cleanupCleaningWorld(prisma, world); await prisma.$disconnect(); });
// Local helper graph used by cases in this file.
async function graph(taskId: string) {
  // Return the arranged value/result to the caller.
  return {
    // Await async work before asserting or releasing locks.
    task: await prisma.cleaningTask.findUniqueOrThrow({ where: { id: taskId } }),
    // Await async work before asserting or releasing locks.
    location: await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } }),
    // Await async work before asserting or releasing locks.
    sessions: await prisma.cleaningSession.findMany({ where: { taskId }, orderBy: { id: "asc" } }),
    // Await async work before asserting or releasing locks.
    inspections: await prisma.inspection.findMany({ where: { taskId }, orderBy: { id: "asc" } }),
    // Await async work before asserting or releasing locks.
    audit: await prisma.auditEvent.findMany({ where: { locationId: world.locationAId }, orderBy: { id: "asc" } }),
    // Await async work before asserting or releasing locks.
    notifications: await prisma.notification.findMany({ where: { locationId: world.locationAId }, orderBy: { id: "asc" } }),
  };
}
// Iterate to cover variants or wait until a condition holds.
for (const action of ["start", "complete", "cancel", "approve", "reject"] as const) {
  // Case: overlapping identical ${action} commands return one committed graph and sequential replay has no effects.
  it(`overlapping identical ${action} commands return one committed graph and sequential replay has no effects`, async () => {
    // A fresh world avoids state contamination between terminal and rework outcomes.
    if (world) await cleanupCleaningWorld(prisma, world);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma);
    // Bind started for later setup or assertions in this scope.
    const started = action === "start"
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      ? { task: await createCleaningTask({ locationId: world.locationAId, hotelDate: await hotelTodayYmd(), assignedEmployeeId: world.hk1.employeeId }), session: { id: "" } }
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      : (await createAndStartToday(world, world.locationAId, world.hk1.employeeId)).started;
    // Bind version for later setup or assertions in this scope.
    let version = started.task.version;
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (action === "approve" || action === "reject") {
      // complete: unique stamp so parallel runs do not collide.
      const complete = await completeCleaningSession({ sessionId: started.session.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: version });
      // Assert HTTP status matches the contract for this path.
      assert.equal(complete.task.status, "awaiting_inspection");
      // Execute the next setup or assertion step for this scenario.
      version = complete.task.version;
    }
    // commandId: unique stamp so parallel runs do not collide.
    const commandId = randomUUID();
    // before: synchronize actors so the race window is observable.
    const before = await graph(started.task.id);
    // Bind expectedRecipients for later setup or assertions in this scope.
    const expectedRecipients = action === "complete"
      ? [...new Set([
          // Await async work before asserting or releasing locks.
          ...await recipientsForLocationOps(world.locationAId, "cleaning.inspect"),
          // Continue the call chain for setup or assertion detail.
          ...(started.task.sectorSupervisorEmployeeId ? [started.task.sectorSupervisorEmployeeId] : []),
        // Execute the next setup or assertion step for this scenario.
        ])].sort()
      : action === "approve" || action === "reject" ? [world.hk1.employeeId] : [];
    // Bind operation for later setup or assertions in this scope.
    const operation = () => action === "start"
      ? startCleaningTask({ taskId: started.task.id, employeeId: world.hk1.employeeId, commandId, expectedVersion: version })
      : action === "complete"
      ? completeCleaningSession({ sessionId: started.session.id, employeeId: world.hk1.employeeId, commandId, expectedVersion: version })
      : action === "cancel"
        ? cancelCleaningSession({ sessionId: started.session.id, employeeId: world.hk1.employeeId, commandId, expectedVersion: version })
        : inspectCleaningTask({ taskId: started.task.id, inspectorEmployeeId: world.manager.employeeId, commandId, result: action === "approve" ? "approved" : "rejected", findings: "replay test", expectedVersion: version });
    // Bind events for later setup or assertions in this scope.
    let events = 0;
    // Bind unsubscribe for later setup or assertions in this scope.
    const unsubscribe = subscribe(event => { if (event.type === "cleaning.changed" && event.taskId === started.task.id) events++; });
    // Try path where partial failure must not leak suite state.
    try {
      // results: synchronize actors so the race window is observable.
      const results = await withDatabaseBarrier(prisma,
        // Execute the next setup or assertion step for this scenario.
        tx => tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${started.task.id} FOR UPDATE`,
        // Run actors together to expose races and serialization bugs.
        () => Promise.allSettled([operation(), operation()]));
      // Assert HTTP status matches the contract for this path.
      for (const result of results) assert.equal(result.status, "fulfilled", result.status === "rejected" ? String(result.reason) : "");
      // Bind values for later setup or assertions in this scope.
      const values = results.map(result => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof operation>>>).value);
      // Assert replay/idempotent path did not create duplicates.
      assert.deepEqual(values.map(value => value.idempotent).sort(), [false, true]);
      // Assert the observed value matches the intended post-condition.
      assert.equal(events, 1, "only the winner publishes");
      // committed: synchronize actors so the race window is observable.
      const committed = await graph(started.task.id);
      // Bind auditActions for later setup or assertions in this scope.
      const auditActions = { start: "cleaning.task.start", complete: "cleaning.session.complete", cancel: "cleaning.session.cancel", approve: "cleaning.inspect", reject: "cleaning.inspect" };
      // Bind newAudit for later setup or assertions in this scope.
      const newAudit = committed.audit.filter(row => !before.audit.some(old => old.id === row.id));
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(newAudit.map(row => row.action), [auditActions[action]]);
      // Bind newNotifications for later setup or assertions in this scope.
      const newNotifications = committed.notifications.filter(row => !before.notifications.some(old => old.id === row.id));
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.deepEqual(newNotifications.map(row => row.recipientEmployeeId).sort(), expectedRecipients);
      // Assert the observed value matches the intended post-condition.
      if (action === "complete") assert.ok(newNotifications.every(row => row.dedupeKey === `cleaning.needs_inspection:${started.task.id}`));
      // Assert the observed value matches the intended post-condition.
      if (action === "approve" || action === "reject") assert.ok(newNotifications.every(row => row.dedupeKey === `cleaning.inspected:${committed.inspections[0]!.id}`));
      // Assert the observed value matches the intended post-condition.
      assert.equal(committed.task.version, version + 1);
      // Assert collection size matches the expected post-condition.
      assert.equal(committed.sessions.length, 1);
      // Assert collection size matches the expected post-condition.
      assert.equal(committed.inspections.length, action === "approve" || action === "reject" ? 1 : 0);
      // replay: synchronize actors so the race window is observable.
      const replay = await operation();
      // Assert replay/idempotent path did not create duplicates.
      assert.equal(replay.idempotent, true);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await graph(started.task.id), committed);
      // Assert the observed value matches the intended post-condition.
      assert.equal(events, 1);
    // Execute the next setup or assertion step for this scenario.
    } finally { unsubscribe(); }
  });
}
