// Load isolated P1 test env before any Prisma/DB clients connect.
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
// Shared test fixtures for seeding users, locations, and domain entities.
import { createCleaningWorld, cleanupCleaningWorld, type CleaningWorld } from "../cleaning/fixtures";
// Import bindings from ../../src/services/settings.
import { getSetting, updateSetting } from "../../src/services/settings";
// Import bindings from ../../src/services/jobs/overdueSessions.
import { runOverdueSessions } from "../../src/services/jobs/overdueSessions";
// Import bindings from ../../src/services/jobs/ticketSlaBreach.
import { runTicketSlaBreach } from "../../src/services/jobs/ticketSlaBreach";
// Import bindings from ../../src/services/jobs/lockInactive.
import { runLockInactiveUsers } from "../../src/services/jobs/lockInactive";
// Import bindings from ../../src/services/jobs/orchestrator.
import { runAllJobs } from "../../src/services/jobs/orchestrator";
// Shared test fixtures for seeding users, locations, and domain entities.
import { waitForBackendsBlockedByHolderChain } from "../attendance/fixtures";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, listenApp, loginBearer } from "../httpHarness";
// Import bindings from ../../src/services/operationsLive.
import { getOperationsLive } from "../../src/services/operationsLive";

// Execute the next setup or assertion step for this scenario.
let world: CleaningWorld;
// Bind now for later setup or assertions in this scope.
const now = Date.parse("2026-01-15T12:00:00Z");
// Execute the next setup or assertion step for this scenario.
let operations: Awaited<ReturnType<typeof getSetting<"operations">>>;
// Execute the next setup or assertion step for this scenario.
let access: Awaited<ReturnType<typeof getSetting<"access">>>;
// Execute the next setup or assertion step for this scenario.
const runIds: string[] = [];
// Local helper session used by cases in this file.
async function session(employeeId = world.hk1.employeeId, delta = 61, status: "running" | "completed" = "running") {
  // task: seeded entity required before the mutation under test.
  const task = await prisma.cleaningTask.create({ data: { locationId: world.locationAId, hotelDate: new Date("2026-01-15"), status: "cancelled", cleaningCycle: 0, assignedEmployeeId: employeeId } });
  // Return the arranged value/result to the caller.
  return prisma.cleaningSession.create({ data: { taskId: task.id, employeeId, status, startedAt: new Date(now - delta * 60000), ...(status === "completed" ? { finishedAt: new Date(now - 1000) } : {}), startCommandId: randomUUID(), anomalyFlags: ["clock_skew"] } });
}
// Suite: real background jobs.
describe("real background jobs", () => {
  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma); process.env.E2E_DISABLE_RATE_LIMIT = "1";
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma); operations = await getSetting("operations"); access = await getSetting("access");
    // Await async work before asserting or releasing locks.
    await updateSetting({ key: "operations", value: { ...operations, overdueSessionMinutes: 60 }, actorEmployeeId: world.owner.employeeId, reason: "jobs baseline" });
  });
  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) {
      // Await async work before asserting or releasing locks.
      await updateSetting({ key: "operations", value: operations, actorEmployeeId: world.owner.employeeId, reason: "restore" });
      // Await async work before asserting or releasing locks.
      await updateSetting({ key: "access", value: access, actorEmployeeId: world.owner.employeeId, reason: "restore" });
      // Await async work before asserting or releasing locks.
      await prisma.notification.deleteMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } } });
      // Await async work before asserting or releasing locks.
      await prisma.ticketEvent.deleteMany({ where: { ticket: { locationId: { in: [world.locationAId, world.locationBId] } } } });
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.deleteMany({ where: { OR: [{ actorEmployeeId: { in: world.employeeIds } }, { occurredAt: new Date(now) }] } });
      // Await async work before asserting or releasing locks.
      await prisma.jobRun.deleteMany({ where: { id: { in: runIds } } });
      // Await async work before asserting or releasing locks.
      await cleanupCleaningWorld(prisma, world);
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });
  // Case: cutoff boundary preserves flags and repeat run emits one warning.
  it("cutoff boundary preserves flags and repeat run emits one warning", async t => {
    // Execute the next setup or assertion step for this scenario.
    t.mock.timers.enable({ apis: ["Date"], now });
    // Try path where partial failure must not leak suite state.
    try {
      // overdue: synchronize actors so the race window is observable.
      const overdue = await session(world.hk1.employeeId, 60);
      // recent: synchronize actors so the race window is observable.
      const recent = await session(world.hk2.employeeId, 59);
      // closed: synchronize actors so the race window is observable.
      const closed = await session(world.technician.employeeId, 70, "completed");
      // result: synchronize actors so the race window is observable.
      const result = await runOverdueSessions(); assert.equal(result.flagged, 1);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual((await prisma.cleaningSession.findUniqueOrThrow({ where: { id: overdue.id } })).anomalyFlags, ["clock_skew", "overdue"]);
      // Iterate to cover variants or wait until a condition holds.
      for (const row of [recent, closed]) assert.deepEqual((await prisma.cleaningSession.findUniqueOrThrow({ where: { id: row.id } })).anomalyFlags, ["clock_skew"]);
      // warnings: synchronize actors so the race window is observable.
      const warnings = await prisma.notification.findMany({ where: { entityId: overdue.id } }); assert.ok(warnings.length > 0);
      // Assert the observed value matches the intended post-condition.
      assert.equal((await runOverdueSessions()).flagged, 0);
      // Assert collection size matches the expected post-condition.
      assert.equal(await prisma.auditEvent.count({ where: { entityId: overdue.id, action: "session.overdue_detected" } }), 1);
      // overdue audit must carry locationId for sector/location scope filters.
      const overdueAudit = await prisma.auditEvent.findFirstOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityId: overdue.id, action: "session.overdue_detected" },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(overdueAudit.locationId, world.locationAId);
      // Assert the observed value matches the intended post-condition.
      assert.match(overdueAudit.summary ?? "", /Overdue cleaning/);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await prisma.notification.findMany({ where: { entityId: overdue.id } }), warnings);
      // Await async work before asserting or releasing locks.
      await prisma.cleaningSession.updateMany({ where: { id: { in: [overdue.id, recent.id] } }, data: { status: "completed", finishedAt: new Date(now) } });
    // Execute the next setup or assertion step for this scenario.
    } finally { t.mock.timers.reset(); }
  });
  // Iterate to cover variants or wait until a condition holds.
  for (const close of [true, false]) it(`real update waiter preserves concurrent ${close ? "completion": "flags"} after job scan`, async t => {
    // Execute the next setup or assertion step for this scenario.
    t.mock.timers.enable({ apis: ["Date"], now });
    // row: synchronize actors so the race window is observable.
    const row = await session();
    // Execute the next setup or assertion step for this scenario.
    let release!: () => void; let held!: (pid: number) => void;
    // Bind gate for later setup or assertions in this scope.
    const gate = new Promise<void>(r => { release = r; }); const ready = new Promise<number>(r => { held = r; });
    // Bind holder for later setup or assertions in this scope.
    const holder = prisma.$transaction(async tx => {
      // Await async work before asserting or releasing locks.
      await tx.$queryRaw`SELECT id FROM "CleaningSession" WHERE id = ${row.id} FOR UPDATE`;
      // Await async work before asserting or releasing locks.
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; held(pid!); await gate;
      // Await async work before asserting or releasing locks.
      await tx.cleaningSession.update({ where: { id: row.id }, data: { anomalyFlags: ["new_concurrent_flag"], ...(close ? { status: "completed", finishedAt: new Date(now) } : {}) } });
    // Runner option controlling stability or isolation of the suite.
    }, { timeout: 20000 });
    // pid: unique stamp so parallel runs do not collide.
    const pid = await ready; const job = runOverdueSessions();
    // Try path where partial failure must not leak suite state.
    try { await waitForBackendsBlockedByHolderChain(prisma, pid, 1); }
    // Always run cleanup to preserve DB/server isolation across cases.
    finally { release(); }
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await holder; await job;
      // current: synchronize actors so the race window is observable.
      const current = await prisma.cleaningSession.findUniqueOrThrow({ where: { id: row.id } });
      // Assert the observed value matches the intended post-condition.
      assert.ok((current.anomalyFlags as string[]).includes("new_concurrent_flag"), "job must not overwrite flags changed after scan");
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (close) {
        // Assert HTTP status matches the contract for this path.
        assert.equal(current.status, "completed"); assert.deepEqual(current.anomalyFlags, ["new_concurrent_flag"]);
        // Assert collection size matches the expected post-condition.
        assert.equal(await prisma.notification.count({ where: { entityId: row.id } }), 0);
        // Assert collection size matches the expected post-condition.
        assert.equal(await prisma.auditEvent.count({ where: { entityId: row.id, action: "session.overdue_detected" } }), 0);
      // Concurrency/isolation step for the race under test.
      } else assert.deepEqual(current.anomalyFlags, ["new_concurrent_flag", "overdue"]);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.cleaningSession.update({ where: { id: row.id }, data: { status: "completed", finishedAt: new Date(now) } });
      // Execute the next setup or assertion step for this scenario.
      t.mock.timers.reset();
    }
  });
  // Case: real SLA job excludes paused/terminal/boundary and observes 12h warning window.
  it("real SLA job excludes paused/terminal/boundary and observes 12h warning window", async t => {
    // Execute the next setup or assertion step for this scenario.
    t.mock.timers.enable({ apis: ["Date"], now });
    // Try path where partial failure must not leak suite state.
    try {
      // Bind inputs for later setup or assertions in this scope.
      const inputs = [
        // Execute the next setup or assertion step for this scenario.
        { status: "new", dueAt: new Date(now - 1) },
        // Execute the next setup or assertion step for this scenario.
        { status: "new", dueAt: new Date(now) },
        // Execute the next setup or assertion step for this scenario.
        { status: "waiting", dueAt: new Date(now - 1), slaPausedAt: new Date(now - 2) },
        // Execute the next setup or assertion step for this scenario.
        { status: "resolved", dueAt: new Date(now - 1), resolvedAt: new Date(now) },
        // Execute the next setup or assertion step for this scenario.
        { status: "new", dueAt: null },
      // Execute the next setup or assertion step for this scenario.
      ] as const;
      // Execute the next setup or assertion step for this scenario.
      const ids: string[] = [];
      // Repeat/poll to widen the race window or wait for lock waiters.
      for (const data of inputs) ids.push((await prisma.maintenanceTicket.create({ data: { ...data, locationId: world.locationBId, title: "SLA control", categoryKey: "other", categoryLabelBg: "Друго", categoryLabelEn: "Other", reportedByEmployeeId: world.owner.employeeId, assigneeId: world.technician.employeeId } })).id);
      // Await async work before asserting or releasing locks.
      await runTicketSlaBreach();
      // Bind audits for later setup or assertions in this scope.
      const audits = () => prisma.auditEvent.findMany({ where: { entityId: { in: ids }, action: "ticket.sla_breach" } });
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual((await audits()).map(a => a.entityId), [ids[0]]);
      // SLA audit must include locationId + identifiable summary.
      const slaAudit = await prisma.auditEvent.findFirstOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityId: ids[0], action: "ticket.sla_breach" },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(slaAudit.locationId, world.locationBId);
      // Assert the observed value matches the intended post-condition.
      assert.match(slaAudit.summary ?? "", /SLA:/);
      // Assert the observed value matches the intended post-condition.
      assert.match(slaAudit.summary ?? "", /SLA control/);
      // Bind after for later setup or assertions in this scope.
      const after = slaAudit.after as Record<string, unknown>;
      // Assert the observed value matches the intended post-condition.
      assert.equal(after.ticketId, ids[0]);
      // Assert the observed value matches the intended post-condition.
      assert.equal(after.locationNumber, (await prisma.location.findUniqueOrThrow({ where: { id: world.locationBId } })).number);
      // Audit defaults use the real PostgreSQL clock; anchor this fixture to the
      // controlled application clock before testing the 12-hour window.
      await prisma.auditEvent.updateMany({ where: { entityId: ids[0], action: "ticket.sla_breach" }, data: { occurredAt: new Date(now) } });
      // Assert collection size matches the expected post-condition.
      await runTicketSlaBreach(); assert.equal((await audits()).length, 1);
      // Move boundary control away before advancing the dedupe clock.
      await prisma.maintenanceTicket.update({ where: { id: ids[1] }, data: { dueAt: new Date(now + 86400000) } });
      // Execute the next setup or assertion step for this scenario.
      t.mock.timers.tick(12 * 3600000 + 1);
      // Assert collection size matches the expected post-condition.
      await runTicketSlaBreach(); assert.equal((await audits()).filter(a => a.entityId === ids[0]).length, 2);
    // Execute the next setup or assertion step for this scenario.
    } finally { t.mock.timers.reset(); }
  });
  // Case: real inactivity signals, JobRun and HTTP denial.
  it("real inactivity signals, JobRun and HTTP denial", async t => {
    // Start or stop the in-process API server for this suite.
    const { api, server } = await listenApp();
    // auth: synchronize actors so the race window is observable.
    const auth = await loginBearer(api, world.hk1.email, "test-password-cln");
    // Execute the next setup or assertion step for this scenario.
    t.mock.timers.enable({ apis: ["Date"], now });
    // Try path where partial failure must not leak suite state.
    try {
      // Bind stale for later setup or assertions in this scope.
      const stale = new Date(now - 40 * 86400000);
      // Await async work before asserting or releasing locks.
      await prisma.user.updateMany({ where: { id: { in: [world.hk1.userId, world.hk2.userId] } }, data: { createdAt: stale, activatedAt: stale, lastLoginAt: stale } });
      // Await async work before asserting or releasing locks.
      await prisma.device.create({ data: { userId: world.hk2.userId, employeeId: world.hk2.employeeId, label: "active", fingerprint: randomUUID(), lastSeenAt: new Date(now) } });
      // Await async work before asserting or releasing locks.
      await prisma.device.create({ data: { userId: world.hk1.userId, employeeId: world.hk1.employeeId, label: "revoked", fingerprint: randomUUID(), lastSeenAt: new Date(now), revokedAt: new Date(now) } });
      // Await async work before asserting or releasing locks.
      await updateSetting({ key: "access", value: { ...access, lockInactiveUsers: false, sessionIdleDays: 30 }, actorEmployeeId: world.owner.employeeId, reason: "disabled" });
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await runLockInactiveUsers(), {
        // Concurrency/isolation step for the race under test.
        locked: 0,
        // Execute the next setup or assertion step for this scenario.
        skipped: true,
        // Execute the next setup or assertion step for this scenario.
        reason: "disabled",
      });
      // Await async work before asserting or releasing locks.
      await updateSetting({ key: "access", value: { ...access, lockInactiveUsers: true, sessionIdleDays: 30 }, actorEmployeeId: world.owner.employeeId, reason: "enabled" });
      // lockedResult: synchronize actors so the race window is observable.
      const lockedResult = await runLockInactiveUsers();
      // Assert the observed value matches the intended post-condition.
      assert.equal(lockedResult.skipped, false);
      // Assert the observed value matches the intended post-condition.
      assert.equal(lockedResult.locked, 1);
      // Assert the observed value matches the intended post-condition.
      assert.equal(typeof lockedResult.cutoff, "string");
      // Assert the observed value matches the intended post-condition.
      assert.ok(!Number.isNaN(Date.parse(lockedResult.cutoff)));
      // Assert the observed value matches the intended post-condition.
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: world.hk1.userId } })).isActive, false);
      // Assert the observed value matches the intended post-condition.
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: world.hk2.userId } })).isActive, true);
      // res: HTTP response captured for status/body checks.
      const res = await fetch(`${api}/auth/me`, { headers: { Authorization: `Bearer ${auth.token}` } }); assert.equal(res.status, 401);
      // run: synchronize actors so the race window is observable.
      const run = await prisma.jobRun.findFirstOrThrow({ where: { jobKey: "lock_inactive_users" }, orderBy: { startedAt: "desc" } });
      // Assert HTTP status matches the contract for this path.
      assert.equal(run.status, "ok"); assert.ok(run.finishedAt); assert.equal((run.summary as any).locked, 1);
    // Start or stop the in-process API server for this suite.
    } finally { t.mock.timers.reset(); await closeServer(server); await prisma.user.update({ where: { id: world.hk1.userId }, data: { isActive: true } }); }
  });
  // Case: DB error after JobRun start is persisted while subsequent real jobs finish.
  it("DB error after JobRun start is persisted while subsequent real jobs finish", async t => {
    // Execute the next setup or assertion step for this scenario.
    t.mock.timers.enable({ apis: ["Date"], now });
    // row: synchronize actors so the race window is observable.
    const row = await session(world.manager.employeeId);
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION scenario_job_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${row.id}' THEN RAISE EXCEPTION 'scenario_overdue_write_failure'; END IF; RETURN NEW; END $$`);
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe('CREATE TRIGGER scenario_job_fail BEFORE UPDATE ON "CleaningSession" FOR EACH ROW EXECUTE FUNCTION scenario_job_fail()');
    // before: synchronize actors so the race window is observable.
    const before = new Set((await prisma.jobRun.findMany()).map(r => r.id));
    // Try path where partial failure must not leak suite state.
    try {
      // results: synchronize actors so the race window is observable.
      const results = await runAllJobs(); assert.match((results.overdue_sessions as any).error, /scenario_overdue_write_failure/);
      // Assert the observed value matches the intended post-condition.
      for (const key of ["lock_inactive_users", "ticket_sla_breach", "stale_open_attendance"]) assert.equal((results[key] as any).error, undefined);
      // runs: synchronize actors so the race window is observable.
      const runs = (await prisma.jobRun.findMany()).filter(r => !before.has(r.id));
      // Assert collection size matches the expected post-condition.
      assert.equal(runs.length, 4); runIds.push(...runs.map(r => r.id));
      // Bind failed for later setup or assertions in this scope.
      const failed = runs.find(r => r.jobKey === "overdue_sessions")!;
      // Assert HTTP status matches the contract for this path.
      assert.equal(failed.status, "error"); assert.match(failed.error!, /scenario_overdue_write_failure/); assert.ok(failed.finishedAt);
      // Assert HTTP status matches the contract for this path.
      assert.ok(runs.filter(r => r !== failed).every(r => r.status === "ok" && r.finishedAt));
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.$executeRawUnsafe('DROP TRIGGER scenario_job_fail ON "CleaningSession"'); await prisma.$executeRawUnsafe('DROP FUNCTION scenario_job_fail()');
      // Await async work before asserting or releasing locks.
      await prisma.cleaningSession.update({ where: { id: row.id }, data: { status: "completed", finishedAt: new Date(now) } }); t.mock.timers.reset();
    }
  });
  // Case probes concurrency/isolation: BUG concurrent SLA scans within 12h still leave a single audit marker.
  it("BUG concurrent SLA scans within 12h still leave a single audit marker", async t => {
    // Execute the next setup or assertion step for this scenario.
    t.mock.timers.enable({ apis: ["Date"], now });
    // Try path where partial failure must not leak suite state.
    try {
      // ticket: seeded entity required before the mutation under test.
      const ticket = await prisma.maintenanceTicket.create({
        // Execute the next setup or assertion step for this scenario.
        data: {
          // Fixture field status for the seeded actor/entity.
          status: "new",
          // Execute the next setup or assertion step for this scenario.
          dueAt: new Date(now - 1),
          // Execute the next setup or assertion step for this scenario.
          locationId: world.locationAId,
          // Concurrency/isolation step for the race under test.
          title: "Concurrent SLA",
          // Execute the next setup or assertion step for this scenario.
          categoryKey: "other",
          // Execute the next setup or assertion step for this scenario.
          categoryLabelBg: "Друго",
          // Execute the next setup or assertion step for this scenario.
          categoryLabelEn: "Other",
          // Execute the next setup or assertion step for this scenario.
          reportedByEmployeeId: world.owner.employeeId,
          // Execute the next setup or assertion step for this scenario.
          assigneeId: world.technician.employeeId,
        },
      });
      // Run actors together to expose races and serialization bugs.
      await Promise.all([runTicketSlaBreach(), runTicketSlaBreach()]);
      // rows: synchronize actors so the race window is observable.
      const rows = await prisma.auditEvent.findMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityId: ticket.id, action: "ticket.sla_breach" },
      });
      // Assert collection size matches the expected post-condition.
      assert.equal(rows.length, 1, "ticket FOR UPDATE must serialize SLA audit inserts");
      // Assert the observed value matches the intended post-condition.
      assert.equal(rows[0]!.locationId, world.locationAId);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Execute the next setup or assertion step for this scenario.
      t.mock.timers.reset();
    }
  });

  // Case: attention deduplicates awaiting+overdue task and drops terminal ticket/task.
  it("attention deduplicates awaiting+overdue task and drops terminal ticket/task", async () => {
    // terminal: seeded entity required before the mutation under test.
    const terminal = await prisma.maintenanceTicket.create({ data: { locationId: world.locationBId, title: "Terminal control", categoryKey: "other", categoryLabelBg: "Друго", categoryLabelEn: "Other", status: "resolved", blocksRoom: true, reportedByEmployeeId: world.owner.employeeId } });
    // task: seeded entity required before the mutation under test.
    const task = await prisma.cleaningTask.create({ data: { locationId: world.locationBId, hotelDate: new Date("2026-01-16"), cleaningCycle: 0, status: "awaiting_inspection", dueAt: new Date(now - 1000) } });
    // Bind scope for later setup or assertions in this scope.
    const scope = { task: { id: task.id }, ticket: { locationId: world.locationBId }, session: { taskId: task.id }, location: { id: world.locationBId } };
    // first: HTTP response captured for status/body checks.
    const first = await getOperationsLive(scope);
    // Assert collection size matches the expected post-condition.
    assert.equal(first.needsAttention.filter(n => n.id === task.id).length, 1);
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.update({ where: { id: task.id }, data: { status: "completed", completedAt: new Date() } });
    // second: HTTP response captured for status/body checks.
    const second = await getOperationsLive(scope); assert.equal(second.needsAttention.some(n => n.id === task.id), false);
    // resolved: synchronize actors so the race window is observable.
    const resolved = await prisma.maintenanceTicket.findMany({ where: { id: terminal.id, status: "resolved" } }); assert.ok(resolved.length > 0);
    // Assert the observed value matches the intended post-condition.
    assert.ok(resolved.every(ticket => !second.needsAttention.some(n => n.id === ticket.id)));
  });
});
