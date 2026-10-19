import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, it } from "node:test";
import { prisma } from "../../src/db";
import { assertTestDatabase } from "../assertTestDatabase";
import { createCleaningWorld, cleanupCleaningWorld, resetCleaningWork, hotelTodayYmd, type CleaningWorld } from "../cleaning/fixtures";
import { createCleaningTask, startCleaningTask, completeCleaningSession, inspectCleaningTask } from "../../src/services/cleaning";
import { createMaintenanceTicket, startMaintenanceTicket } from "../../src/services/maintenance";
import { getSetting, updateSetting } from "../../src/services/settings";
let world: CleaningWorld;
let flags: Awaited<ReturnType<typeof getSetting<"flags">>>;
async function snapshot() {
  const locationId = world.locationAId;
  return {
    location: await prisma.location.findUniqueOrThrow({ where: { id: locationId } }),
    tasks: await prisma.cleaningTask.findMany({ where: { locationId }, orderBy: { id: "asc" } }),
    sessions: await prisma.cleaningSession.findMany({ where: { task: { locationId } }, orderBy: { id: "asc" } }),
    inspections: await prisma.inspection.findMany({ where: { task: { locationId } }, orderBy: { id: "asc" } }),
    tickets: await prisma.maintenanceTicket.findMany({ where: { locationId }, orderBy: { id: "asc" } }),
    events: await prisma.ticketEvent.findMany({ where: { ticket: { locationId } }, orderBy: { id: "asc" } }),
    audit: await prisma.auditEvent.findMany({ where: { locationId }, orderBy: { id: "asc" } }),
  };
}
async function failLate(action: string, proofSql: string, operation: () => Promise<unknown>) {
  const before = await snapshot();
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION scenario_rollback_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' AND NEW."locationId" = '${world.locationAId}' THEN IF ${proofSql} THEN RAISE EXCEPTION 'scenario_late_failure_writes_observed'; ELSE RAISE EXCEPTION 'scenario_proof_not_reached'; END IF; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER scenario_rollback_fail BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION scenario_rollback_fail()');
  try { await assert.rejects(operation(), /scenario_late_failure_writes_observed/); assert.deepEqual(await snapshot(), before); }
  finally { await prisma.$executeRawUnsafe('DROP TRIGGER scenario_rollback_fail ON "AuditEvent"'); await prisma.$executeRawUnsafe('DROP FUNCTION scenario_rollback_fail()'); }
}
before(async () => { await assertTestDatabase(prisma); world = await createCleaningWorld(prisma); flags = await getSetting("flags"); await updateSetting({ key: "flags", value: { ...flags, require_inspection: true }, actorEmployeeId: world.owner.employeeId }); });
after(async () => {
  if (world) {
    await updateSetting({ key: "flags", value: flags, actorEmployeeId: world.owner.employeeId });
    const locationIds = [world.locationAId, world.locationBId];
    await prisma.notification.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.ticketEvent.deleteMany({ where: { ticket: { locationId: { in: locationIds } } } });
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorEmployeeId: { in: world.employeeIds } }, { locationId: { in: locationIds } }] } });
    await cleanupCleaningWorld(prisma, world);
  }
  await prisma.$disconnect();
});
it("P1-127 real late audit failures roll back create/start/complete/inspect and ticket transition", async () => {
  const today = await hotelTodayYmd();
  await failLate("cleaning.task.create", 'EXISTS (SELECT 1 FROM "CleaningTask" WHERE id = NEW."entityId")', () => createCleaningTask({ locationId: world.locationAId, hotelDate: today, assignedEmployeeId: world.hk1.employeeId }));
  const task = await createCleaningTask({ locationId: world.locationAId, hotelDate: today, assignedEmployeeId: world.hk1.employeeId });
  await failLate("cleaning.task.start", `EXISTS (SELECT 1 FROM "CleaningSession" WHERE "taskId" = '${task.id}' AND status = 'running')`, () => startCleaningTask({ taskId: task.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: task.version }));
  const started = await startCleaningTask({ taskId: task.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: task.version });
  await failLate("cleaning.session.complete", `EXISTS (SELECT 1 FROM "CleaningSession" WHERE id = '${started.session.id}' AND status = 'completed')`, () => completeCleaningSession({ sessionId: started.session.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: started.task.version }));
  const completed = await completeCleaningSession({ sessionId: started.session.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: started.task.version });
  await failLate("cleaning.inspect", 'EXISTS (SELECT 1 FROM "Inspection" WHERE id = NEW."entityId")', () => inspectCleaningTask({ taskId: task.id, inspectorEmployeeId: world.manager.employeeId, commandId: randomUUID(), result: "approved", expectedVersion: completed.task.version }));
  const option = await prisma.issueOption.findFirstOrThrow({ where: { isActive: true, maintenanceCategory: { isActive: true } } });
  await failLate("ticket.create", 'EXISTS (SELECT 1 FROM "MaintenanceTicket" WHERE id = NEW."entityId") AND EXISTS (SELECT 1 FROM "TicketEvent" WHERE "ticketId" = NEW."entityId")', () => createMaintenanceTicket({ locationId: world.locationAId, issueOptionId: option.id, blocksRoom: true, reportedByEmployeeId: world.owner.employeeId, commandId: randomUUID() }));
  const created = await createMaintenanceTicket({ locationId: world.locationAId, issueOptionId: option.id, blocksRoom: true, reportedByEmployeeId: world.owner.employeeId, commandId: randomUUID() });
  await prisma.maintenanceTicket.update({ where: { id: created.ticket.id }, data: { status: "assigned", assigneeId: world.technician.employeeId } });
  await failLate("ticket.start", `EXISTS (SELECT 1 FROM "TicketEvent" WHERE "ticketId" = '${created.ticket.id}' AND "toStatus" = 'in_progress')`, () => startMaintenanceTicket({ ticketId: created.ticket.id, actorEmployeeId: world.technician.employeeId, commandId: randomUUID() }));
});
it("P1-96 notification failure occurs after committed domain graph; same command replay preserves it exactly", async () => {
  const option = await prisma.issueOption.findFirstOrThrow({ where: { isActive: true, maintenanceCategory: { isActive: true } } });
  const input = { locationId: world.locationBId, issueOptionId: option.id, blocksRoom: false, reportedByEmployeeId: world.owner.employeeId, commandId: randomUUID() };
  await prisma.$executeRawUnsafe(`CREATE FUNCTION scenario_postcommit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."locationId" = '${world.locationBId}' THEN IF EXISTS (SELECT 1 FROM "MaintenanceTicket" WHERE "commandId" = '${input.commandId}') THEN RAISE EXCEPTION 'scenario_notification_after_commit'; ELSE RAISE EXCEPTION 'scenario_no_commit'; END IF; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER scenario_postcommit_fail BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION scenario_postcommit_fail()');
  try { await assert.rejects(createMaintenanceTicket(input), /scenario_notification_after_commit/); }
  finally { await prisma.$executeRawUnsafe('DROP TRIGGER scenario_postcommit_fail ON "Notification"'); await prisma.$executeRawUnsafe('DROP FUNCTION scenario_postcommit_fail()'); }
  const ticket = await prisma.maintenanceTicket.findUniqueOrThrow({ where: { commandId: input.commandId } });
  const events = await prisma.ticketEvent.findMany({ where: { ticketId: ticket.id } }); const audit = await prisma.auditEvent.findMany({ where: { entityId: ticket.id } });
  assert.equal(events.length, 1); assert.ok(audit.length > 0);
  const replay = await createMaintenanceTicket(input); assert.equal(replay.idempotent, true); assert.equal(replay.ticket.id, ticket.id);
  assert.deepEqual(await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticket.id } }), ticket);
  assert.deepEqual(await prisma.ticketEvent.findMany({ where: { ticketId: ticket.id } }), events); assert.deepEqual(await prisma.auditEvent.findMany({ where: { entityId: ticket.id } }), audit);
});
