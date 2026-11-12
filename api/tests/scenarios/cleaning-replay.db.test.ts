// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, it } from "node:test";
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { withDatabaseBarrier } from "../dbBarrier";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createCleaningWorld, cleanupCleaningWorld, createAndStartToday, type CleaningWorld } from "../cleaning/fixtures";
import { cancelCleaningSession, completeCleaningSession, inspectCleaningTask, createCleaningTask, startCleaningTask } from "../../src/services/cleaning";
// Shared test fixtures for seeding users, locations, and domain entities.
import { hotelTodayYmd } from "../cleaning/fixtures";
import { subscribe } from "../../src/events/bus";
import { recipientsForLocationOps } from "../../src/services/notifications";

let world: CleaningWorld;
before(async () => { await assertTestDatabase(prisma); world = await createCleaningWorld(prisma); });
after(async () => { if (world) await cleanupCleaningWorld(prisma, world); await prisma.$disconnect(); });
// Local helper graph used by cases in this file.
async function graph(taskId: string) {
  return {
    task: await prisma.cleaningTask.findUniqueOrThrow({ where: { id: taskId } }),
    location: await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } }),
    sessions: await prisma.cleaningSession.findMany({ where: { taskId }, orderBy: { id: "asc" } }),
    inspections: await prisma.inspection.findMany({ where: { taskId }, orderBy: { id: "asc" } }),
    audit: await prisma.auditEvent.findMany({ where: { locationId: world.locationAId }, orderBy: { id: "asc" } }),
    notifications: await prisma.notification.findMany({ where: { locationId: world.locationAId }, orderBy: { id: "asc" } }),
  };
}
for (const action of ["start", "complete", "cancel", "approve", "reject"] as const) {
  // Case: overlapping identical ${action} commands return one committed graph and sequential replay has no effects.
  it(`overlapping identical ${action} commands return one committed graph and sequential replay has no effects`, async () => {
    // A fresh world avoids state contamination between terminal and rework outcomes.
    if (world) await cleanupCleaningWorld(prisma, world);
    world = await createCleaningWorld(prisma);
    const started = action === "start"
      ? { task: await createCleaningTask({ locationId: world.locationAId, hotelDate: await hotelTodayYmd(), assignedEmployeeId: world.hk1.employeeId }), session: { id: "" } }
      : (await createAndStartToday(world, world.locationAId, world.hk1.employeeId)).started;
    let version = started.task.version;
    if (action === "approve" || action === "reject") {
      const complete = await completeCleaningSession({ sessionId: started.session.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: version });
      assert.equal(complete.task.status, "awaiting_inspection");
      version = complete.task.version;
    }
    const commandId = randomUUID();
    const before = await graph(started.task.id);
    const expectedRecipients = action === "complete"
      ? [...new Set([
          ...await recipientsForLocationOps(world.locationAId, "cleaning.inspect"),
          ...(started.task.sectorSupervisorEmployeeId ? [started.task.sectorSupervisorEmployeeId] : []),
        ])].sort()
      : action === "approve" || action === "reject" ? [world.hk1.employeeId] : [];
    const operation = () => action === "start"
      ? startCleaningTask({ taskId: started.task.id, employeeId: world.hk1.employeeId, commandId, expectedVersion: version })
      : action === "complete"
      ? completeCleaningSession({ sessionId: started.session.id, employeeId: world.hk1.employeeId, commandId, expectedVersion: version })
      : action === "cancel"
        ? cancelCleaningSession({ sessionId: started.session.id, employeeId: world.hk1.employeeId, commandId, expectedVersion: version })
        : inspectCleaningTask({ taskId: started.task.id, inspectorEmployeeId: world.manager.employeeId, commandId, result: action === "approve" ? "approved" : "rejected", findings: "replay test", expectedVersion: version });
    let events = 0;
    const unsubscribe = subscribe(event => { if (event.type === "cleaning.changed" && event.taskId === started.task.id) events++; });
    try {
      const results = await withDatabaseBarrier(prisma,
        tx => tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${started.task.id} FOR UPDATE`,
        // Run actors together to expose races and serialization bugs.
        () => Promise.allSettled([operation(), operation()]));
      for (const result of results) assert.equal(result.status, "fulfilled", result.status === "rejected" ? String(result.reason) : "");
      const values = results.map(result => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof operation>>>).value);
      // Assert replay/idempotent path did not create duplicates.
      assert.deepEqual(values.map(value => value.idempotent).sort(), [false, true]);
      assert.equal(events, 1, "only the winner publishes");
      const committed = await graph(started.task.id);
      const auditActions = { start: "cleaning.task.start", complete: "cleaning.session.complete", cancel: "cleaning.session.cancel", approve: "cleaning.inspect", reject: "cleaning.inspect" };
      const newAudit = committed.audit.filter(row => !before.audit.some(old => old.id === row.id));
      assert.deepEqual(newAudit.map(row => row.action), [auditActions[action]]);
      const newNotifications = committed.notifications.filter(row => !before.notifications.some(old => old.id === row.id));
      assert.deepEqual(newNotifications.map(row => row.recipientEmployeeId).sort(), expectedRecipients);
      if (action === "complete") assert.ok(newNotifications.every(row => row.dedupeKey === `cleaning.needs_inspection:${started.task.id}`));
      if (action === "approve" || action === "reject") assert.ok(newNotifications.every(row => row.dedupeKey === `cleaning.inspected:${committed.inspections[0]!.id}`));
      assert.equal(committed.task.version, version + 1);
      assert.equal(committed.sessions.length, 1);
      assert.equal(committed.inspections.length, action === "approve" || action === "reject" ? 1 : 0);
      const replay = await operation();
      // Assert replay/idempotent path did not create duplicates.
      assert.equal(replay.idempotent, true);
      assert.deepEqual(await graph(started.task.id), committed);
      assert.equal(events, 1);
    } finally { unsubscribe(); }
  });
}
