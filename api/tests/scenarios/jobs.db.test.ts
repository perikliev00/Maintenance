// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createCleaningWorld, cleanupCleaningWorld, type CleaningWorld } from "../cleaning/fixtures";
import { getSetting, updateSetting } from "../../src/services/settings";
import { runOverdueSessions } from "../../src/services/jobs/overdueSessions";
import { runTicketSlaBreach } from "../../src/services/jobs/ticketSlaBreach";
import { runLockInactiveUsers } from "../../src/services/jobs/lockInactive";
import { runAllJobs } from "../../src/services/jobs/orchestrator";
// Shared test fixtures for seeding users, locations, and domain entities.
import { waitForBackendsBlockedByHolderChain } from "../attendance/fixtures";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, listenApp, loginBearer } from "../httpHarness";
import { getOperationsLive } from "../../src/services/operationsLive";

let world: CleaningWorld;
const now = Date.parse("2026-01-15T12:00:00Z");
let operations: Awaited<ReturnType<typeof getSetting<"operations">>>;
let access: Awaited<ReturnType<typeof getSetting<"access">>>;
const runIds: string[] = [];
// Local helper session used by cases in this file.
async function session(employeeId = world.hk1.employeeId, delta = 61, status: "running" | "completed" = "running") {
  const task = await prisma.cleaningTask.create({ data: { locationId: world.locationAId, hotelDate: new Date("2026-01-15"), status: "cancelled", cleaningCycle: 0, assignedEmployeeId: employeeId } });
  return prisma.cleaningSession.create({ data: { taskId: task.id, employeeId, status, startedAt: new Date(now - delta * 60000), ...(status === "completed" ? { finishedAt: new Date(now - 1000) } : {}), startCommandId: randomUUID(), anomalyFlags: ["clock_skew"] } });
}
// Suite: real background jobs.
describe("real background jobs", () => {
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma); process.env.E2E_DISABLE_RATE_LIMIT = "1";
    world = await createCleaningWorld(prisma); operations = await getSetting("operations"); access = await getSetting("access");
    await updateSetting({ key: "operations", value: { ...operations, overdueSessionMinutes: 60 }, actorEmployeeId: world.owner.employeeId, reason: "jobs baseline" });
  });
  after(async () => {
    if (world) {
      await updateSetting({ key: "operations", value: operations, actorEmployeeId: world.owner.employeeId, reason: "restore" });
      await updateSetting({ key: "access", value: access, actorEmployeeId: world.owner.employeeId, reason: "restore" });
      await prisma.notification.deleteMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } } });
      await prisma.ticketEvent.deleteMany({ where: { ticket: { locationId: { in: [world.locationAId, world.locationBId] } } } });
      await prisma.auditEvent.deleteMany({ where: { OR: [{ actorEmployeeId: { in: world.employeeIds } }, { occurredAt: new Date(now) }] } });
      await prisma.jobRun.deleteMany({ where: { id: { in: runIds } } });
      await cleanupCleaningWorld(prisma, world);
    }
    await prisma.$disconnect();
  });
  // Case: cutoff boundary preserves flags and repeat run emits one warning.
  it("cutoff boundary preserves flags and repeat run emits one warning", async t => {
    t.mock.timers.enable({ apis: ["Date"], now });
    try {
      const overdue = await session(world.hk1.employeeId, 60);
      const recent = await session(world.hk2.employeeId, 59);
      const closed = await session(world.technician.employeeId, 70, "completed");
      const result = await runOverdueSessions(); assert.equal(result.flagged, 1);
      assert.deepEqual((await prisma.cleaningSession.findUniqueOrThrow({ where: { id: overdue.id } })).anomalyFlags, ["clock_skew", "overdue"]);
      for (const row of [recent, closed]) assert.deepEqual((await prisma.cleaningSession.findUniqueOrThrow({ where: { id: row.id } })).anomalyFlags, ["clock_skew"]);
      const warnings = await prisma.notification.findMany({ where: { entityId: overdue.id } }); assert.ok(warnings.length > 0);
      assert.equal((await runOverdueSessions()).flagged, 0);
      assert.equal(await prisma.auditEvent.count({ where: { entityId: overdue.id, action: "session.overdue_detected" } }), 1);
      // overdue audit must carry locationId for sector/location scope filters.
      const overdueAudit = await prisma.auditEvent.findFirstOrThrow({
        where: { entityId: overdue.id, action: "session.overdue_detected" },
      });
      assert.equal(overdueAudit.locationId, world.locationAId);
      assert.match(overdueAudit.summary ?? "", /Overdue cleaning/);
      assert.deepEqual(await prisma.notification.findMany({ where: { entityId: overdue.id } }), warnings);
      await prisma.cleaningSession.updateMany({ where: { id: { in: [overdue.id, recent.id] } }, data: { status: "completed", finishedAt: new Date(now) } });
    } finally { t.mock.timers.reset(); }
  });
  for (const close of [true, false]) it(`real update waiter preserves concurrent ${close ? "completion": "flags"} after job scan`, async t => {
    t.mock.timers.enable({ apis: ["Date"], now });
    const row = await session();
    let release!: () => void; let held!: (pid: number) => void;
    const gate = new Promise<void>(r => { release = r; }); const ready = new Promise<number>(r => { held = r; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "CleaningSession" WHERE id = ${row.id} FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; held(pid!); await gate;
      await tx.cleaningSession.update({ where: { id: row.id }, data: { anomalyFlags: ["new_concurrent_flag"], ...(close ? { status: "completed", finishedAt: new Date(now) } : {}) } });
    // Runner option controlling stability or isolation of the suite.
    }, { timeout: 20000 });
    const pid = await ready; const job = runOverdueSessions();
    try { await waitForBackendsBlockedByHolderChain(prisma, pid, 1); }
    // Always run cleanup to preserve DB/server isolation across cases.
    finally { release(); }
    try {
      await holder; await job;
      const current = await prisma.cleaningSession.findUniqueOrThrow({ where: { id: row.id } });
      assert.ok((current.anomalyFlags as string[]).includes("new_concurrent_flag"), "job must not overwrite flags changed after scan");
      if (close) {
        assert.equal(current.status, "completed"); assert.deepEqual(current.anomalyFlags, ["new_concurrent_flag"]);
        assert.equal(await prisma.notification.count({ where: { entityId: row.id } }), 0);
        assert.equal(await prisma.auditEvent.count({ where: { entityId: row.id, action: "session.overdue_detected" } }), 0);
      } else assert.deepEqual(current.anomalyFlags, ["new_concurrent_flag", "overdue"]);
    } finally {
      await prisma.cleaningSession.update({ where: { id: row.id }, data: { status: "completed", finishedAt: new Date(now) } });
      t.mock.timers.reset();
    }
  });
  // Case: real SLA job excludes paused/terminal/boundary and observes 12h warning window.
  it("real SLA job excludes paused/terminal/boundary and observes 12h warning window", async t => {
    t.mock.timers.enable({ apis: ["Date"], now });
    try {
      const inputs = [
        { status: "new", dueAt: new Date(now - 1) },
        { status: "new", dueAt: new Date(now) },
        { status: "waiting", dueAt: new Date(now - 1), slaPausedAt: new Date(now - 2) },
        { status: "resolved", dueAt: new Date(now - 1), resolvedAt: new Date(now) },
        { status: "new", dueAt: null },
      ] as const;
      const ids: string[] = [];
      // Repeat/poll to widen the race window or wait for lock waiters.
      for (const data of inputs) ids.push((await prisma.maintenanceTicket.create({ data: { ...data, locationId: world.locationBId, title: "SLA control", categoryKey: "other", categoryLabelBg: "Друго", categoryLabelEn: "Other", reportedByEmployeeId: world.owner.employeeId, assigneeId: world.technician.employeeId } })).id);
      await runTicketSlaBreach();
      const audits = () => prisma.auditEvent.findMany({ where: { entityId: { in: ids }, action: "ticket.sla_breach" } });
      assert.deepEqual((await audits()).map(a => a.entityId), [ids[0]]);
      // SLA audit must include locationId + identifiable summary.
      const slaAudit = await prisma.auditEvent.findFirstOrThrow({
        where: { entityId: ids[0], action: "ticket.sla_breach" },
      });
      assert.equal(slaAudit.locationId, world.locationBId);
      assert.match(slaAudit.summary ?? "", /SLA:/);
      assert.match(slaAudit.summary ?? "", /SLA control/);
      const after = slaAudit.after as Record<string, unknown>;
      assert.equal(after.ticketId, ids[0]);
      assert.equal(after.locationNumber, (await prisma.location.findUniqueOrThrow({ where: { id: world.locationBId } })).number);
      // Audit defaults use the real PostgreSQL clock; anchor this fixture to the
      // controlled application clock before testing the 12-hour window.
      await prisma.auditEvent.updateMany({ where: { entityId: ids[0], action: "ticket.sla_breach" }, data: { occurredAt: new Date(now) } });
      await runTicketSlaBreach(); assert.equal((await audits()).length, 1);
      // Move boundary control away before advancing the dedupe clock.
      await prisma.maintenanceTicket.update({ where: { id: ids[1] }, data: { dueAt: new Date(now + 86400000) } });
      t.mock.timers.tick(12 * 3600000 + 1);
      await runTicketSlaBreach(); assert.equal((await audits()).filter(a => a.entityId === ids[0]).length, 2);
    } finally { t.mock.timers.reset(); }
  });
  // Case: real inactivity signals, JobRun and HTTP denial.
  it("real inactivity signals, JobRun and HTTP denial", async t => {
    const { api, server } = await listenApp();
    const auth = await loginBearer(api, world.hk1.email, "test-password-cln");
    t.mock.timers.enable({ apis: ["Date"], now });
    try {
      const stale = new Date(now - 40 * 86400000);
      await prisma.user.updateMany({ where: { id: { in: [world.hk1.userId, world.hk2.userId] } }, data: { createdAt: stale, activatedAt: stale, lastLoginAt: stale } });
      await prisma.device.create({ data: { userId: world.hk2.userId, employeeId: world.hk2.employeeId, label: "active", fingerprint: randomUUID(), lastSeenAt: new Date(now) } });
      await prisma.device.create({ data: { userId: world.hk1.userId, employeeId: world.hk1.employeeId, label: "revoked", fingerprint: randomUUID(), lastSeenAt: new Date(now), revokedAt: new Date(now) } });
      await updateSetting({ key: "access", value: { ...access, lockInactiveUsers: false, sessionIdleDays: 30 }, actorEmployeeId: world.owner.employeeId, reason: "disabled" });
      assert.deepEqual(await runLockInactiveUsers(), {
        locked: 0,
        skipped: true,
        reason: "disabled",
      });
      await updateSetting({ key: "access", value: { ...access, lockInactiveUsers: true, sessionIdleDays: 30 }, actorEmployeeId: world.owner.employeeId, reason: "enabled" });
      const lockedResult = await runLockInactiveUsers();
      assert.equal(lockedResult.skipped, false);
      assert.equal(lockedResult.locked, 1);
      assert.equal(typeof lockedResult.cutoff, "string");
      assert.ok(!Number.isNaN(Date.parse(lockedResult.cutoff)));
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: world.hk1.userId } })).isActive, false);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: world.hk2.userId } })).isActive, true);
      const res = await fetch(`${api}/auth/me`, { headers: { Authorization: `Bearer ${auth.token}` } }); assert.equal(res.status, 401);
      const run = await prisma.jobRun.findFirstOrThrow({ where: { jobKey: "lock_inactive_users" }, orderBy: { startedAt: "desc" } });
      assert.equal(run.status, "ok"); assert.ok(run.finishedAt); assert.equal((run.summary as any).locked, 1);
    // Start or stop the in-process API server for this suite.
    } finally { t.mock.timers.reset(); await closeServer(server); await prisma.user.update({ where: { id: world.hk1.userId }, data: { isActive: true } }); }
  });
  // Case: DB error after JobRun start is persisted while subsequent real jobs finish.
  it("DB error after JobRun start is persisted while subsequent real jobs finish", async t => {
    t.mock.timers.enable({ apis: ["Date"], now });
    const row = await session(world.manager.employeeId);
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION scenario_job_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${row.id}' THEN RAISE EXCEPTION 'scenario_overdue_write_failure'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER scenario_job_fail BEFORE UPDATE ON "CleaningSession" FOR EACH ROW EXECUTE FUNCTION scenario_job_fail()');
    const before = new Set((await prisma.jobRun.findMany()).map(r => r.id));
    try {
      const results = await runAllJobs(); assert.match((results.overdue_sessions as any).error, /scenario_overdue_write_failure/);
      for (const key of ["lock_inactive_users", "ticket_sla_breach", "stale_open_attendance"]) assert.equal((results[key] as any).error, undefined);
      const runs = (await prisma.jobRun.findMany()).filter(r => !before.has(r.id));
      assert.equal(runs.length, 4); runIds.push(...runs.map(r => r.id));
      const failed = runs.find(r => r.jobKey === "overdue_sessions")!;
      assert.equal(failed.status, "error"); assert.match(failed.error!, /scenario_overdue_write_failure/); assert.ok(failed.finishedAt);
      assert.ok(runs.filter(r => r !== failed).every(r => r.status === "ok" && r.finishedAt));
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER scenario_job_fail ON "CleaningSession"'); await prisma.$executeRawUnsafe('DROP FUNCTION scenario_job_fail()');
      await prisma.cleaningSession.update({ where: { id: row.id }, data: { status: "completed", finishedAt: new Date(now) } }); t.mock.timers.reset();
    }
  });
  // Case probes concurrency/isolation: BUG concurrent SLA scans within 12h still leave a single audit marker.
  it("BUG concurrent SLA scans within 12h still leave a single audit marker", async t => {
    t.mock.timers.enable({ apis: ["Date"], now });
    try {
      // ticket: seeded entity required before the mutation under test.
      const ticket = await prisma.maintenanceTicket.create({
        data: {
          status: "new",
          dueAt: new Date(now - 1),
          locationId: world.locationAId,
          title: "Concurrent SLA",
          categoryKey: "other",
          categoryLabelBg: "Друго",
          categoryLabelEn: "Other",
          reportedByEmployeeId: world.owner.employeeId,
          assigneeId: world.technician.employeeId,
        },
      });
      // Run actors together to expose races and serialization bugs.
      await Promise.all([runTicketSlaBreach(), runTicketSlaBreach()]);
      const rows = await prisma.auditEvent.findMany({
        where: { entityId: ticket.id, action: "ticket.sla_breach" },
      });
      assert.equal(rows.length, 1, "ticket FOR UPDATE must serialize SLA audit inserts");
      assert.equal(rows[0]!.locationId, world.locationAId);
    } finally {
      t.mock.timers.reset();
    }
  });

  // Case: attention deduplicates awaiting+overdue task and drops terminal ticket/task.
  it("attention deduplicates awaiting+overdue task and drops terminal ticket/task", async () => {
    // terminal: seeded entity required before the mutation under test.
    const terminal = await prisma.maintenanceTicket.create({ data: { locationId: world.locationBId, title: "Terminal control", categoryKey: "other", categoryLabelBg: "Друго", categoryLabelEn: "Other", status: "resolved", blocksRoom: true, reportedByEmployeeId: world.owner.employeeId } });
    const task = await prisma.cleaningTask.create({ data: { locationId: world.locationBId, hotelDate: new Date("2026-01-16"), cleaningCycle: 0, status: "awaiting_inspection", dueAt: new Date(now - 1000) } });
    const scope = { task: { id: task.id }, ticket: { locationId: world.locationBId }, session: { taskId: task.id }, location: { id: world.locationBId } };
    const first = await getOperationsLive(scope);
    assert.equal(first.needsAttention.filter(n => n.id === task.id).length, 1);
    await prisma.cleaningTask.update({ where: { id: task.id }, data: { status: "completed", completedAt: new Date() } });
    const second = await getOperationsLive(scope); assert.equal(second.needsAttention.some(n => n.id === task.id), false);
    const resolved = await prisma.maintenanceTicket.findMany({ where: { id: terminal.id, status: "resolved" } }); assert.ok(resolved.length > 0);
    assert.ok(resolved.every(ticket => !second.needsAttention.some(n => n.id === ticket.id)));
  });
});
