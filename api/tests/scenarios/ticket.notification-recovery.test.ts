// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, it } from "node:test";
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createScopeSmokeFixture, cleanupScopeSmokeFixture, type ScopeSmokeFixture } from "../fixtures";
import { resolveMaintenanceTicket, closeMaintenanceTicket } from "../../src/services/maintenance";
import { flushTicketNotificationOutbox } from "../../src/services/maintenance/notificationOutbox";
import { getSetting, updateSetting } from "../../src/services/settings";

let fx: ScopeSmokeFixture;
let settings: Awaited<ReturnType<typeof getSetting<"notifications">>>;
before(async () => {
  // Refuse to mutate unless connected to the isolated test database.
  await assertTestDatabase(prisma); fx = await createScopeSmokeFixture(prisma);
  settings = await getSetting("notifications");
  await updateSetting({ key: "notifications", value: { ...settings, in_app: { ...settings.in_app, enabled: true } }, actorEmployeeId: fx.manager.employeeId });
});
beforeEach(async () => {
  await prisma.notification.deleteMany({ where: { entityId: fx.ticketAId } });
  await prisma.ticketEvent.deleteMany({ where: { ticketId: fx.ticketAId } });
  await prisma.maintenanceTicket.update({ where: { id: fx.ticketAId }, data: { status: "in_progress", assigneeId: fx.housekeeper.employeeId, reportedByEmployeeId: fx.otherHk.employeeId } });
});
after(async () => {
  if (fx) {
    await updateSetting({ key: "notifications", value: settings, actorEmployeeId: fx.manager.employeeId });
    await prisma.notification.deleteMany({ where: { locationId: { in: [fx.locAId, fx.locBId] } } });
    await prisma.ticketEvent.deleteMany({ where: { ticketId: { in: [fx.ticketAId, fx.ticketBId] } } });
    await prisma.auditEvent.deleteMany({ where: { actorEmployeeId: fx.manager.employeeId } });
    await cleanupScopeSmokeFixture(prisma, fx);
  }
  await prisma.$disconnect();
});
// Local helper failSecondRecipient used by cases in this file.
async function failSecondRecipient(type: string, action: () => Promise<unknown>) {
  const name = `notice_fail_${randomUUID().replaceAll("-", "")}`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId" = '${fx.ticketAId}' AND NEW.type = '${type}' AND NEW."recipientEmployeeId" = '${fx.otherHk.employeeId}' THEN RAISE EXCEPTION 'notification_recovery_test'; END IF; RETURN NEW; END $$`);
  try {
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    try { await assert.rejects(action(), /notification_recovery_test/); }
    // Always run cleanup to preserve DB/server isolation across cases.
    finally { await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "Notification"`); }
  } finally { await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`); }
}
// Local helper graph used by cases in this file.
async function graph() {
  return {
    ticket: await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: fx.ticketAId } }),
    events: await prisma.ticketEvent.findMany({ where: { ticketId: fx.ticketAId }, orderBy: { id: "asc" } }),
    audit: await prisma.auditEvent.findMany({ where: { entityId: fx.ticketAId }, orderBy: { id: "asc" } }),
  };
}
for (const outcome of ["resolved", "closed"] as const) {
  // Case: ${outcome}: replay repairs partial post-commit notices without repeating the domain graph.
  it(`${outcome}: replay repairs partial post-commit notices without repeating the domain graph`, async () => {
    const resolve = { ticketId: fx.ticketAId, resolvedByEmployeeId: fx.manager.employeeId, bypassAssigneeCheck: true, commandId: randomUUID() };
    const close = { ticketId: fx.ticketAId, closedByEmployeeId: fx.manager.employeeId, commandId: randomUUID() };
    if (outcome === "closed") await resolveMaintenanceTicket(resolve);
    const action = () => outcome === "resolved" ? resolveMaintenanceTicket(resolve) : closeMaintenanceTicket(close);
    await failSecondRecipient(`ticket.${outcome}`, action);
    const committed = await graph(); assert.equal(committed.ticket.status, outcome);
    const before = await prisma.notification.findMany({ where: { entityId: fx.ticketAId, type: `ticket.${outcome}` } });
    assert.equal(before.length, 1); assert.equal(before[0]!.recipientEmployeeId, fx.housekeeper.employeeId);
    // Run actors together to expose races and serialization bugs.
    await Promise.all([action(), action()]);
    assert.deepEqual(await graph(), committed);
    const rows = await prisma.notification.findMany({ where: { entityId: fx.ticketAId, type: `ticket.${outcome}` } });
    assert.deepEqual(rows.map(r => r.recipientEmployeeId).sort(), [fx.housekeeper.employeeId, fx.otherHk.employeeId].sort());
    assert.equal(rows.find(r => r.recipientEmployeeId === fx.housekeeper.employeeId)!.id, before[0]!.id);
    assert.equal(new Set(rows.map(r => r.dedupeKey)).size, 1);
  });
}
// Case: background recovery handles no-commandId calls and keeps original recipient snapshots.
it("background recovery handles no-commandId calls and keeps original recipient snapshots", async () => {
  await failSecondRecipient("ticket.resolved", () => resolveMaintenanceTicket({ ticketId: fx.ticketAId, resolvedByEmployeeId: fx.manager.employeeId, bypassAssigneeCheck: true }));
  await prisma.maintenanceTicket.update({ where: { id: fx.ticketAId }, data: { assigneeId: fx.supervisorB.employeeId, reportedByEmployeeId: fx.manager.employeeId } });
  const committed = await graph();
  const result = await flushTicketNotificationOutbox(); assert.equal(result.pending, 0);
  assert.deepEqual(await graph(), committed);
  const rows = await prisma.notification.findMany({ where: { entityId: fx.ticketAId, type: "ticket.resolved" } });
  assert.deepEqual(rows.map(r => r.recipientEmployeeId).sort(), [fx.housekeeper.employeeId, fx.otherHk.employeeId].sort());
  assert.equal((await flushTicketNotificationOutbox()).delivered, 0);
});
