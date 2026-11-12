// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, it } from "node:test";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createScopeSmokeFixture, cleanupScopeSmokeFixture, type ScopeSmokeFixture } from "../fixtures";
// Import bindings from ../../src/services/maintenance.
import { resolveMaintenanceTicket, closeMaintenanceTicket } from "../../src/services/maintenance";
// Import bindings from ../../src/services/maintenance/notificationOutbox.
import { flushTicketNotificationOutbox } from "../../src/services/maintenance/notificationOutbox";
// Import bindings from ../../src/services/settings.
import { getSetting, updateSetting } from "../../src/services/settings";

// Execute the next setup or assertion step for this scenario.
let fx: ScopeSmokeFixture;
// Delivery/replay step for async notification paths.
let settings: Awaited<ReturnType<typeof getSetting<"notifications">>>;
// Arrange shared preconditions before cases run.
before(async () => {
  // Refuse to mutate unless connected to the isolated test database.
  await assertTestDatabase(prisma); fx = await createScopeSmokeFixture(prisma);
  // Await async work before asserting or releasing locks.
  settings = await getSetting("notifications");
  // Await async work before asserting or releasing locks.
  await updateSetting({ key: "notifications", value: { ...settings, in_app: { ...settings.in_app, enabled: true } }, actorEmployeeId: fx.manager.employeeId });
});
// Arrange shared preconditions before cases run.
beforeEach(async () => {
  // Await async work before asserting or releasing locks.
  await prisma.notification.deleteMany({ where: { entityId: fx.ticketAId } });
  // Await async work before asserting or releasing locks.
  await prisma.ticketEvent.deleteMany({ where: { ticketId: fx.ticketAId } });
  // Await async work before asserting or releasing locks.
  await prisma.maintenanceTicket.update({ where: { id: fx.ticketAId }, data: { status: "in_progress", assigneeId: fx.housekeeper.employeeId, reportedByEmployeeId: fx.otherHk.employeeId } });
});
// Release servers/DB clients so later suites stay isolated.
after(async () => {
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (fx) {
    // Await async work before asserting or releasing locks.
    await updateSetting({ key: "notifications", value: settings, actorEmployeeId: fx.manager.employeeId });
    // Await async work before asserting or releasing locks.
    await prisma.notification.deleteMany({ where: { locationId: { in: [fx.locAId, fx.locBId] } } });
    // Await async work before asserting or releasing locks.
    await prisma.ticketEvent.deleteMany({ where: { ticketId: { in: [fx.ticketAId, fx.ticketBId] } } });
    // Await async work before asserting or releasing locks.
    await prisma.auditEvent.deleteMany({ where: { actorEmployeeId: fx.manager.employeeId } });
    // Await async work before asserting or releasing locks.
    await cleanupScopeSmokeFixture(prisma, fx);
  }
  // Disconnect Prisma so the pool does not leak across suites.
  await prisma.$disconnect();
});
// Local helper failSecondRecipient used by cases in this file.
async function failSecondRecipient(type: string, action: () => Promise<unknown>) {
  // name: unique stamp so parallel runs do not collide.
  const name = `notice_fail_${randomUUID().replaceAll("-", "")}`;
  // Await async work before asserting or releasing locks.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId" = '${fx.ticketAId}' AND NEW.type = '${type}' AND NEW."recipientEmployeeId" = '${fx.otherHk.employeeId}' THEN RAISE EXCEPTION 'notification_recovery_test'; END IF; RETURN NEW; END $$`);
  // Try path where partial failure must not leak suite state.
  try {
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    // Try path where partial failure must not leak suite state.
    try { await assert.rejects(action(), /notification_recovery_test/); }
    // Always run cleanup to preserve DB/server isolation across cases.
    finally { await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "Notification"`); }
  // Await async work before asserting or releasing locks.
  } finally { await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`); }
}
// Local helper graph used by cases in this file.
async function graph() {
  // Return the arranged value/result to the caller.
  return {
    // Await async work before asserting or releasing locks.
    ticket: await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: fx.ticketAId } }),
    // Await async work before asserting or releasing locks.
    events: await prisma.ticketEvent.findMany({ where: { ticketId: fx.ticketAId }, orderBy: { id: "asc" } }),
    // Await async work before asserting or releasing locks.
    audit: await prisma.auditEvent.findMany({ where: { entityId: fx.ticketAId }, orderBy: { id: "asc" } }),
  };
}
// Iterate to cover variants or wait until a condition holds.
for (const outcome of ["resolved", "closed"] as const) {
  // Case: ${outcome}: replay repairs partial post-commit notices without repeating the domain graph.
  it(`${outcome}: replay repairs partial post-commit notices without repeating the domain graph`, async () => {
    // resolve: unique stamp so parallel runs do not collide.
    const resolve = { ticketId: fx.ticketAId, resolvedByEmployeeId: fx.manager.employeeId, bypassAssigneeCheck: true, commandId: randomUUID() };
    // close: unique stamp so parallel runs do not collide.
    const close = { ticketId: fx.ticketAId, closedByEmployeeId: fx.manager.employeeId, commandId: randomUUID() };
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (outcome === "closed") await resolveMaintenanceTicket(resolve);
    // Bind action for later setup or assertions in this scope.
    const action = () => outcome === "resolved" ? resolveMaintenanceTicket(resolve) : closeMaintenanceTicket(close);
    // Await async work before asserting or releasing locks.
    await failSecondRecipient(`ticket.${outcome}`, action);
    // committed: synchronize actors so the race window is observable.
    const committed = await graph(); assert.equal(committed.ticket.status, outcome);
    // before: synchronize actors so the race window is observable.
    const before = await prisma.notification.findMany({ where: { entityId: fx.ticketAId, type: `ticket.${outcome}` } });
    // Assert collection size matches the expected post-condition.
    assert.equal(before.length, 1); assert.equal(before[0]!.recipientEmployeeId, fx.housekeeper.employeeId);
    // Run actors together to expose races and serialization bugs.
    await Promise.all([action(), action()]);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await graph(), committed);
    // rows: synchronize actors so the race window is observable.
    const rows = await prisma.notification.findMany({ where: { entityId: fx.ticketAId, type: `ticket.${outcome}` } });
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(rows.map(r => r.recipientEmployeeId).sort(), [fx.housekeeper.employeeId, fx.otherHk.employeeId].sort());
    // Assert the observed value matches the intended post-condition.
    assert.equal(rows.find(r => r.recipientEmployeeId === fx.housekeeper.employeeId)!.id, before[0]!.id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(new Set(rows.map(r => r.dedupeKey)).size, 1);
  });
}
// Case: background recovery handles no-commandId calls and keeps original recipient snapshots.
it("background recovery handles no-commandId calls and keeps original recipient snapshots", async () => {
  // Await async work before asserting or releasing locks.
  await failSecondRecipient("ticket.resolved", () => resolveMaintenanceTicket({ ticketId: fx.ticketAId, resolvedByEmployeeId: fx.manager.employeeId, bypassAssigneeCheck: true }));
  // Await async work before asserting or releasing locks.
  await prisma.maintenanceTicket.update({ where: { id: fx.ticketAId }, data: { assigneeId: fx.supervisorB.employeeId, reportedByEmployeeId: fx.manager.employeeId } });
  // committed: synchronize actors so the race window is observable.
  const committed = await graph();
  // result: synchronize actors so the race window is observable.
  const result = await flushTicketNotificationOutbox(); assert.equal(result.pending, 0);
  // Assert the observed value matches the intended post-condition.
  assert.deepEqual(await graph(), committed);
  // rows: synchronize actors so the race window is observable.
  const rows = await prisma.notification.findMany({ where: { entityId: fx.ticketAId, type: "ticket.resolved" } });
  // Assert the observed value matches the intended post-condition.
  assert.deepEqual(rows.map(r => r.recipientEmployeeId).sort(), [fx.housekeeper.employeeId, fx.otherHk.employeeId].sort());
  // Assert the observed value matches the intended post-condition.
  assert.equal((await flushTicketNotificationOutbox()).delivered, 0);
});
