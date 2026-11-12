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
// Shared test fixtures for seeding users, locations, and domain entities.
import { createCleaningWorld, cleanupCleaningWorld, resetCleaningWork, hotelTodayYmd, type CleaningWorld } from "../cleaning/fixtures";
// Import bindings from ../../src/services/cleaning.
import { createCleaningTask, startCleaningTask, completeCleaningSession, inspectCleaningTask, cancelCleaningSession, reassignCleaningTask } from "../../src/services/cleaning";
// Import bindings from ../../src/services/maintenance.
import { createMaintenanceTicket, startMaintenanceTicket, assignMaintenanceTicket, waitMaintenanceTicket, resumeMaintenanceTicket, resolveMaintenanceTicket, closeMaintenanceTicket, reopenMaintenanceTicket } from "../../src/services/maintenance";
// Import bindings from ../../src/services/settings.
import { getSetting, updateSetting } from "../../src/services/settings";
// Execute the next setup or assertion step for this scenario.
let world: CleaningWorld;
// Execute the next setup or assertion step for this scenario.
let flags: Awaited<ReturnType<typeof getSetting<"flags">>>;
// Local helper snapshot used by cases in this file.
async function snapshot() {
  // locationId: unique stamp so parallel runs do not collide.
  const locationId = world.locationAId;
  // Return the arranged value/result to the caller.
  return {
    // Await async work before asserting or releasing locks.
    location: await prisma.location.findUniqueOrThrow({ where: { id: locationId } }),
    // Await async work before asserting or releasing locks.
    tasks: await prisma.cleaningTask.findMany({ where: { locationId }, orderBy: { id: "asc" } }),
    // Await async work before asserting or releasing locks.
    sessions: await prisma.cleaningSession.findMany({ where: { task: { locationId } }, orderBy: { id: "asc" } }),
    // Await async work before asserting or releasing locks.
    inspections: await prisma.inspection.findMany({ where: { task: { locationId } }, orderBy: { id: "asc" } }),
    // Await async work before asserting or releasing locks.
    tickets: await prisma.maintenanceTicket.findMany({ where: { locationId }, orderBy: { id: "asc" } }),
    // Await async work before asserting or releasing locks.
    events: await prisma.ticketEvent.findMany({ where: { ticket: { locationId } }, orderBy: { id: "asc" } }),
    // Await async work before asserting or releasing locks.
    reopens: await prisma.ticketReopenEvent.findMany({ where: { ticket: { locationId } }, orderBy: { id: "asc" } }),
    // Await async work before asserting or releasing locks.
    audit: await prisma.auditEvent.findMany({ where: { locationId }, orderBy: { id: "asc" } }),
    // Await async work before asserting or releasing locks.
    notifications: await prisma.notification.findMany({ where: { locationId }, orderBy: { id: "asc" } }),
  };
}
// Local helper failLate used by cases in this file.
async function failLate(action: string, proofSql: string, operation: () => Promise<unknown>) {
  // before: synchronize actors so the race window is observable.
  const before = await snapshot();
  // Await async work before asserting or releasing locks.
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION scenario_rollback_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' AND NEW."locationId" = '${world.locationAId}' THEN IF ${proofSql} THEN RAISE EXCEPTION 'scenario_late_failure_writes_observed'; ELSE RAISE EXCEPTION 'scenario_proof_not_reached'; END IF; END IF; RETURN NEW; END $$`);
  // Await async work before asserting or releasing locks.
  await prisma.$executeRawUnsafe('CREATE TRIGGER scenario_rollback_fail BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION scenario_rollback_fail()');
  // Try path where partial failure must not leak suite state.
  try { await assert.rejects(operation(), /scenario_late_failure_writes_observed/); assert.deepEqual(await snapshot(), before); }
  // Always run cleanup to preserve DB/server isolation across cases.
  finally { await prisma.$executeRawUnsafe('DROP TRIGGER scenario_rollback_fail ON "AuditEvent"'); await prisma.$executeRawUnsafe('DROP FUNCTION scenario_rollback_fail()'); }
}
// Arrange shared preconditions before cases run.
before(async () => { await assertTestDatabase(prisma); world = await createCleaningWorld(prisma); flags = await getSetting("flags"); await updateSetting({ key: "flags", value: { ...flags, require_inspection: true }, actorEmployeeId: world.owner.employeeId }); });
// Release servers/DB clients so later suites stay isolated.
after(async () => {
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (world) {
    // Await async work before asserting or releasing locks.
    await updateSetting({ key: "flags", value: flags, actorEmployeeId: world.owner.employeeId });
    // Bind locationIds for later setup or assertions in this scope.
    const locationIds = [world.locationAId, world.locationBId];
    // Await async work before asserting or releasing locks.
    await prisma.notification.deleteMany({ where: { locationId: { in: locationIds } } });
    // Await async work before asserting or releasing locks.
    await prisma.ticketEvent.deleteMany({ where: { ticket: { locationId: { in: locationIds } } } });
    // Await async work before asserting or releasing locks.
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorEmployeeId: { in: world.employeeIds } }, { locationId: { in: locationIds } }] } });
    // Await async work before asserting or releasing locks.
    await cleanupCleaningWorld(prisma, world);
  }
  // Disconnect Prisma so the pool does not leak across suites.
  await prisma.$disconnect();
});
// Case: real late audit failures roll back create/start/complete/inspect and ticket transition.
it("real late audit failures roll back create/start/complete/inspect and ticket transition", async () => {
  // today: synchronize actors so the race window is observable.
  const today = await hotelTodayYmd();
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  await failLate("cleaning.task.create", 'EXISTS (SELECT 1 FROM "CleaningTask" WHERE id = NEW."entityId")', () => createCleaningTask({ locationId: world.locationAId, hotelDate: today, assignedEmployeeId: world.hk1.employeeId }));
  // task: seeded entity required before the mutation under test.
  const task = await createCleaningTask({ locationId: world.locationAId, hotelDate: today, assignedEmployeeId: world.hk1.employeeId });
  // Await async work before asserting or releasing locks.
  await failLate("cleaning.task.start", `EXISTS (SELECT 1 FROM "CleaningSession" WHERE "taskId" = '${task.id}' AND status = 'running')`, () => startCleaningTask({ taskId: task.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: task.version }));
  // started: unique stamp so parallel runs do not collide.
  const started = await startCleaningTask({ taskId: task.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: task.version });
  // Await async work before asserting or releasing locks.
  await failLate("cleaning.session.complete", `EXISTS (SELECT 1 FROM "CleaningSession" WHERE id = '${started.session.id}' AND status = 'completed')`, () => completeCleaningSession({ sessionId: started.session.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: started.task.version }));
  // completed: unique stamp so parallel runs do not collide.
  const completed = await completeCleaningSession({ sessionId: started.session.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: started.task.version });
  // Await async work before asserting or releasing locks.
  await failLate("cleaning.inspect", 'EXISTS (SELECT 1 FROM "Inspection" WHERE id = NEW."entityId")', () => inspectCleaningTask({ taskId: task.id, inspectorEmployeeId: world.manager.employeeId, commandId: randomUUID(), result: "approved", expectedVersion: completed.task.version }));
  // option: synchronize actors so the race window is observable.
  const option = await prisma.issueOption.findFirstOrThrow({ where: { isActive: true, maintenanceCategory: { isActive: true } } });
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  await failLate("ticket.create", 'EXISTS (SELECT 1 FROM "MaintenanceTicket" WHERE id = NEW."entityId") AND EXISTS (SELECT 1 FROM "TicketEvent" WHERE "ticketId" = NEW."entityId")', () => createMaintenanceTicket({ locationId: world.locationAId, issueOptionId: option.id, blocksRoom: true, reportedByEmployeeId: world.owner.employeeId, commandId: randomUUID() }));
  // created: unique stamp so parallel runs do not collide.
  const created = await createMaintenanceTicket({ locationId: world.locationAId, issueOptionId: option.id, blocksRoom: true, reportedByEmployeeId: world.owner.employeeId, commandId: randomUUID() });
  // Await async work before asserting or releasing locks.
  await prisma.maintenanceTicket.update({ where: { id: created.ticket.id }, data: { status: "assigned", assigneeId: world.technician.employeeId } });
  // Await async work before asserting or releasing locks.
  await failLate("ticket.start", `EXISTS (SELECT 1 FROM "TicketEvent" WHERE "ticketId" = '${created.ticket.id}' AND "toStatus" = 'in_progress')`, () => startMaintenanceTicket({ ticketId: created.ticket.id, actorEmployeeId: world.technician.employeeId, commandId: randomUUID() }));
});
// Case: late failure matrix preserves cancel/reassign/reject and every repair transition graph.
it("late failure matrix preserves cancel/reassign/reject and every repair transition graph", async () => {
  // Await async work before asserting or releasing locks.
  await resetCleaningWork(prisma, world);
  // task: seeded entity required before the mutation under test.
  const task = await createCleaningTask({ locationId: world.locationAId, hotelDate: await hotelTodayYmd(), assignedEmployeeId: world.hk1.employeeId });
  // Await async work before asserting or releasing locks.
  await failLate("cleaning.task.reassign", `EXISTS (SELECT 1 FROM "CleaningTask" WHERE id = '${task.id}' AND "assignedEmployeeId" = '${world.hk2.employeeId}' AND version = ${task.version + 1})`, () => reassignCleaningTask({ taskId: task.id, assignedEmployeeId: world.hk2.employeeId, reason: "rollback", expectedVersion: task.version, actorEmployeeId: world.manager.employeeId }));
  // started: unique stamp so parallel runs do not collide.
  const started = await startCleaningTask({ taskId: task.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: task.version });
  // Await async work before asserting or releasing locks.
  await failLate("cleaning.session.cancel", `EXISTS (SELECT 1 FROM "CleaningSession" WHERE id = '${started.session.id}' AND status = 'cancelled')`, () => cancelCleaningSession({ sessionId: started.session.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: started.task.version }));
  // completed: unique stamp so parallel runs do not collide.
  const completed = await completeCleaningSession({ sessionId: started.session.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: started.task.version });
  // Await async work before asserting or releasing locks.
  await failLate("cleaning.inspect", `EXISTS (SELECT 1 FROM "Inspection" WHERE id = NEW."entityId" AND result = 'rejected') AND EXISTS (SELECT 1 FROM "CleaningTask" WHERE id = '${task.id}' AND status = 'rework')`, () => inspectCleaningTask({ taskId: task.id, inspectorEmployeeId: world.manager.employeeId, commandId: randomUUID(), result: "rejected", findings: "rollback rejection", expectedVersion: completed.task.version }));

  // option: synchronize actors so the race window is observable.
  const option = await prisma.issueOption.findFirstOrThrow({ where: { isActive: true, maintenanceCategory: { isActive: true } } });
  // created: unique stamp so parallel runs do not collide.
  const created = await createMaintenanceTicket({ locationId: world.locationAId, issueOptionId: option.id, blocksRoom: true, reportedByEmployeeId: world.owner.employeeId, commandId: randomUUID() });
  // ticketId: unique stamp so parallel runs do not collide.
  const ticketId = created.ticket.id;
  // actorEmployeeId: unique stamp so parallel runs do not collide.
  const actorEmployeeId = world.technician.employeeId;
  // Bind assign for later setup or assertions in this scope.
  const assign = () => assignMaintenanceTicket({ ticketId, assigneeId: actorEmployeeId, actorEmployeeId: world.manager.employeeId });
  // Bind eventProof for later setup or assertions in this scope.
  const eventProof = (status: string) => `EXISTS (SELECT 1 FROM "TicketEvent" WHERE "ticketId" = '${ticketId}' AND "toStatus" = '${status}') AND EXISTS (SELECT 1 FROM "MaintenanceTicket" WHERE id = '${ticketId}' AND status = '${status}')`;
  // Await async work before asserting or releasing locks.
  await failLate("ticket.assign", eventProof("assigned"), assign);
  // Await async work before asserting or releasing locks.
  await assign();
  // Await async work before asserting or releasing locks.
  await startMaintenanceTicket({ ticketId, actorEmployeeId, commandId: randomUUID() });
  // wait: unique stamp so parallel runs do not collide.
  const wait = () => waitMaintenanceTicket({ ticketId, actorEmployeeId, commandId: randomUUID(), reason: "parts" });
  // Await async work before asserting or releasing locks.
  await failLate("ticket.wait", eventProof("waiting"), wait);
  // Await async work before asserting or releasing locks.
  await wait();
  // resume: unique stamp so parallel runs do not collide.
  const resume = () => resumeMaintenanceTicket({ ticketId, actorEmployeeId, commandId: randomUUID() });
  // Await async work before asserting or releasing locks.
  await failLate("ticket.resume", eventProof("in_progress"), resume);
  // Await async work before asserting or releasing locks.
  await resume();
  // resolve: unique stamp so parallel runs do not collide.
  const resolve = () => resolveMaintenanceTicket({ ticketId, resolvedByEmployeeId: actorEmployeeId, commandId: randomUUID(), resolutionNotes: "fixed" });
  // Await async work before asserting or releasing locks.
  await failLate("ticket.resolve", eventProof("resolved"), resolve);
  // Await async work before asserting or releasing locks.
  await resolve();
  // Bind close for later setup or assertions in this scope.
  const close = () => closeMaintenanceTicket({ ticketId, closedByEmployeeId: world.manager.employeeId });
  // Await async work before asserting or releasing locks.
  await failLate("ticket.close", eventProof("closed"), close);
  // Await async work before asserting or releasing locks.
  await close();
  // Await async work before asserting or releasing locks.
  await failLate("ticket.reopen", `${eventProof("in_progress")} AND EXISTS (SELECT 1 FROM "TicketReopenEvent" WHERE "ticketId" = '${ticketId}')`, () => reopenMaintenanceTicket({ ticketId, reopenedByEmployeeId: world.manager.employeeId, reason: "again" }));
});
// Case: notification failure occurs after committed domain graph; same command replay preserves it exactly.
it("notification failure occurs after committed domain graph; same command replay preserves it exactly", async () => {
  // option: synchronize actors so the race window is observable.
  const option = await prisma.issueOption.findFirstOrThrow({ where: { isActive: true, maintenanceCategory: { isActive: true } } });
  // input: unique stamp so parallel runs do not collide.
  const input = { locationId: world.locationBId, issueOptionId: option.id, blocksRoom: false, reportedByEmployeeId: world.owner.employeeId, commandId: randomUUID() };
  // Await async work before asserting or releasing locks.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION scenario_postcommit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."locationId" = '${world.locationBId}' THEN IF EXISTS (SELECT 1 FROM "MaintenanceTicket" WHERE "commandId" = '${input.commandId}') THEN RAISE EXCEPTION 'scenario_notification_after_commit'; ELSE RAISE EXCEPTION 'scenario_no_commit'; END IF; END IF; RETURN NEW; END $$`);
  // Await async work before asserting or releasing locks.
  await prisma.$executeRawUnsafe('CREATE TRIGGER scenario_postcommit_fail BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION scenario_postcommit_fail()');
  // Try path where partial failure must not leak suite state.
  try { await assert.rejects(createMaintenanceTicket(input), /scenario_notification_after_commit/); }
  // Always run cleanup to preserve DB/server isolation across cases.
  finally { await prisma.$executeRawUnsafe('DROP TRIGGER scenario_postcommit_fail ON "Notification"'); await prisma.$executeRawUnsafe('DROP FUNCTION scenario_postcommit_fail()'); }
  // ticket: HTTP response captured for status/body checks.
  const ticket = await prisma.maintenanceTicket.findUniqueOrThrow({ where: { commandId: input.commandId } });
  // events: synchronize actors so the race window is observable.
  const events = await prisma.ticketEvent.findMany({ where: { ticketId: ticket.id } }); const audit = await prisma.auditEvent.findMany({ where: { entityId: ticket.id } });
  // Assert collection size matches the expected post-condition.
  assert.equal(events.length, 1); assert.ok(audit.length > 0);
  // replay: seeded entity required before the mutation under test.
  const replay = await createMaintenanceTicket(input); assert.equal(replay.idempotent, true); assert.equal(replay.ticket.id, ticket.id);
  // Assert the observed value matches the intended post-condition.
  assert.deepEqual(await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticket.id } }), ticket);
  // Assert the observed value matches the intended post-condition.
  assert.deepEqual(await prisma.ticketEvent.findMany({ where: { ticketId: ticket.id } }), events); assert.deepEqual(await prisma.auditEvent.findMany({ where: { entityId: ticket.id } }), audit);
});
