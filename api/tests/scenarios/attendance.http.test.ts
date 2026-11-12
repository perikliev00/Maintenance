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
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, getJson, listenApp, loginBearer, postJson } from "../httpHarness";
// Import bindings from ../../src/services/settings.
import { getSetting, updateSetting } from "../../src/services/settings";
// Import bindings from ../../src/services/hotelTime.
import { todayHotelDateYmd } from "../../src/services/hotelTime";
// Import bindings from ../../src/services/cleaning.
import { createCleaningTask } from "../../src/services/cleaning";
// Import bindings from ../../src/services/dailyPlan.
import { createDailyPlanEntry } from "../../src/services/dailyPlan";
// Import bindings from ../../src/services/shifts.
import { createShift, upsertShiftRoster } from "../../src/services/shifts";

// Execute the next setup or assertion step for this scenario.
let world: CleaningWorld; let api: string; let server: Awaited<ReturnType<typeof listenApp>>["server"]; let token: string;
// Execute the next setup or assertion step for this scenario.
let operations: Awaited<ReturnType<typeof getSetting<"operations">>>;
// Execute the next setup or assertion step for this scenario.
const shifts: string[] = [];
// Bind days for later setup or assertions in this scope.
const days = ["1999-12-26", "1999-12-27", "1999-12-31", "2000-01-01", "2000-01-02", "2000-01-03", "2000-01-31", "2000-02-01"];
// Local helper interval used by cases in this file.
async function interval(employeeId: string, day: string, skew: number | null) {
  // Bind at for later setup or assertions in this scope.
  const at = new Date(`${day}T08:00:00Z`);
  // event: unique stamp so parallel runs do not collide.
  const event = await prisma.attendanceEvent.create({ data: { employeeId, source: "scenario", externalEventId: randomUUID(), kind: "clock_in", deviceTime: at, receivedAt: at, normalizedTime: at, clockSkewSeconds: skew } });
  // Return the arranged value/result to the caller.
  return prisma.attendanceInterval.create({ data: { employeeId, hotelDate: new Date(`${day}T00:00:00Z`), startedAt: at, endedAt: new Date(at.getTime() + 3600000), status: "closed", workedMinutes: 60, startEventId: event.id } });
}
// Suite: real attendance query/export/ingest.
describe("real attendance query/export/ingest", () => {
  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma); process.env.E2E_DISABLE_RATE_LIMIT = "1";
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma); operations = await getSetting("operations");
    // Await async work before asserting or releasing locks.
    await updateSetting({ key: "operations", value: { ...operations, hotelTimezone: "Europe/Sofia" }, actorEmployeeId: world.owner.employeeId });
    // Await async work before asserting or releasing locks.
    await prisma.employee.update({ where: { id: world.hk1.employeeId }, data: { department: "Scenario Dept", fullName: "Unique report match" } });
    // Await async work before asserting or releasing locks.
    await prisma.employee.update({ where: { id: world.hk2.employeeId }, data: { department: "Other Dept", fullName: "Unique report match" } });
    // Iterate to cover variants or wait until a condition holds.
    for (const day of days) await interval(world.hk1.employeeId, day, day === "2000-01-02" ? -240 : day === "2000-01-01" ? 120 : null);
    // Await async work before asserting or releasing locks.
    await interval(world.hk2.employeeId, "2000-01-01", 9999);
    // Start or stop the in-process API server for this suite.
    ({ api, server } = await listenApp()); token = (await loginBearer(api, world.owner.email, "test-password-cln")).token;
  });
  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) { await updateSetting({ key: "operations", value: operations, actorEmployeeId: world.owner.employeeId }); await prisma.auditEvent.deleteMany({ where: { actorEmployeeId: world.owner.employeeId } }); await prisma.notification.deleteMany({ where: { locationId: world.locationAId } }); await prisma.dailyPlanEntry.deleteMany({ where: { locationId: world.locationAId } }); await cleanupCleaningWorld(prisma, world); await prisma.shift.deleteMany({ where: { id: { in: shifts } } }); }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });
  // Case: combined employee/department/search/month scopes yield identical HTTP list and CSV.
  it("combined employee/department/search/month scopes yield identical HTTP list and CSV", async t => {
    // Execute the next setup or assertion step for this scenario.
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2000-01-02T10:00:00Z") });
    // Try path where partial failure must not leak suite state.
    try {
      // Iterate to cover variants or wait until a condition holds.
      for (const [scope, expected] of [["today", ["2000-01-02"]], ["week", ["1999-12-27", "1999-12-31", "2000-01-01", "2000-01-02"]], ["month", ["2000-01-01", "2000-01-02", "2000-01-03", "2000-01-31"]]] as const) {
        // Bind query for later setup or assertions in this scope.
        const query = new URLSearchParams({ scope, month: "2000-01", employeeId: world.hk1.employeeId, department: "scenario dept", q: "Unique report" });
        // res: HTTP response captured for status/body checks.
        const res = await getJson(api, token, `/attendance/intervals?${query}`); assert.equal(res.status, 200);
        // Bind rows for later setup or assertions in this scope.
        const rows = (res.body as any).intervals as any[]; assert.deepEqual(rows.map(r => r.hotelDate).sort(), [...expected].sort()); assert.ok(rows.every(r => r.employeeId === world.hk1.employeeId));
        // csv: HTTP response captured for status/body checks.
        const csv = await fetch(`${api}/attendance/export.csv?${query}`, { headers: { Authorization: `Bearer ${token}` } }); assert.equal(csv.status, 200);
        // lines: synchronize actors so the race window is observable.
        const lines = (await csv.text()).trim().split(/\r?\n/).slice(1); assert.deepEqual(lines.map(l => l.split(",")[0]).sort(), [...expected].sort());
        // Assert the observed value matches the intended post-condition.
        query.set("department", "Other Dept"); assert.equal(((await getJson(api, token, `/attendance/intervals?${query}`)).body as any).total, 0);
      }
    // Execute the next setup or assertion step for this scenario.
    } finally { t.mock.timers.reset(); }
  });
  // Iterate to cover variants or wait until a condition holds.
  for (const instant of ["1999-12-31T22:30:00Z", "2000-01-01T10:00:00Z"]) it(`hotel new-year/month boundary at ${instant} respects Monday–Sunday`, async t => {
    // Execute the next setup or assertion step for this scenario.
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse(instant) });
    // Try path where partial failure must not leak suite state.
    try {
      // Iterate to cover variants or wait until a condition holds.
      for (const [scope, expected] of [["today", ["2000-01-01"]], ["week", ["1999-12-27", "1999-12-31", "2000-01-01", "2000-01-02"]], ["month", ["2000-01-01", "2000-01-02", "2000-01-03", "2000-01-31"]]] as const) {
        // Bind query for later setup or assertions in this scope.
        const query = new URLSearchParams({ scope, employeeId: world.hk1.employeeId });
        // res: HTTP response captured for status/body checks.
        const res = await getJson(api, token, `/attendance/intervals?${query}`); assert.equal(res.status, 200); assert.deepEqual((res.body as any).intervals.map((r: any) => r.hotelDate).sort(), [...expected].sort());
      }
    // Execute the next setup or assertion step for this scenario.
    } finally { t.mock.timers.reset(); }
  });
  // Case: actual 50001-row export is explicitly 413, never a truncated successful CSV.
  it("actual 50001-row export is explicitly 413, never a truncated successful CSV", async () => {
    // prefix: unique stamp so parallel runs do not collide.
    const prefix = randomUUID();
    // Await async work before asserting or releasing locks.
    await prisma.$executeRaw`
      INSERT INTO "AttendanceInterval" (id, "employeeId", "hotelDate", "startedAt", "endedAt", "breakMinutes", "workedMinutes", status, "anomalyFlags", "createdAt", "updatedAt")
      SELECT ${prefix} || '-' || n, ${world.technician.employeeId}, DATE '2000-02-15', TIMESTAMP '2000-02-15 08:00:00', TIMESTAMP '2000-02-15 09:00:00', 0, 60, 'closed'::"AttendanceIntervalStatus", '[]'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM generate_series(1, 50001) AS n
    `;
    // Try path where partial failure must not leak suite state.
    try {
      // Bind url for later setup or assertions in this scope.
      const url = `${api}/attendance/export.csv?scope=month&month=2000-02&employeeId=${world.technician.employeeId}`;
      // res: HTTP response captured for status/body checks.
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 413); assert.match(res.headers.get("content-type")!, /application\/json/);
      // body: synchronize actors so the race window is observable.
      const body = await res.json() as any; assert.equal(body.error, "too_large"); assert.deepEqual(body.details, { total: 50001, ceiling: 50000 });
    // Await async work before asserting or releasing locks.
    } finally { await prisma.attendanceInterval.deleteMany({ where: { id: { startsWith: prefix } } }); }
  });
  // Case probes concurrency/isolation: max absolute clock skew uses only selected records and returns null for unknown.
  it("max absolute clock skew uses only selected records and returns null for unknown", async () => {
    // res: HTTP response captured for status/body checks.
    const res = await getJson(api, token, `/attendance/intervals?scope=month&month=2000-01&employeeId=${world.hk1.employeeId}`);
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200); assert.equal((res.body as any).maxClockSkewSeconds, 240);
    // unknown: HTTP response captured for status/body checks.
    const unknown = await getJson(api, token, `/attendance/intervals?scope=month&month=1999-12&employeeId=${world.hk1.employeeId}`);
    // Assert the observed value matches the intended post-condition.
    assert.equal((unknown.body as any).maxClockSkewSeconds, null);
  });
  // Case: calculated, explicit and zero skew persist; invalid device/receive times are 400 and leave no partial event.
  it("calculated, explicit and zero skew persist; invalid device/receive times are 400 and leave no partial event", async () => {
    // Iterate to cover variants or wait until a condition holds.
    for (const explicit of [undefined, -19, 0]) {
      // key: unique stamp so parallel runs do not collide.
      const key = randomUUID();
      // res: HTTP response captured for status/body checks.
      const res = await postJson(api, token, "/attendance/events", { source: "scenario-ingest", externalEventId: key, employeeId: world.manager.employeeId, kind: "clock_in", deviceTime: "2000-03-01T08:00:30Z", receivedAt: "2000-03-01T08:00:00Z", ...(explicit === undefined ? {} : { clockSkewSeconds: explicit }) });
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 201, JSON.stringify(res.body));
      // row: synchronize actors so the race window is observable.
      const row = await prisma.attendanceEvent.findUniqueOrThrow({ where: { source_externalEventId: { source: "scenario-ingest", externalEventId: key } } }); assert.equal(row.clockSkewSeconds, explicit ?? 30);
    }
    // events: synchronize actors so the race window is observable.
    const events = await prisma.attendanceEvent.findMany({ where: { employeeId: world.manager.employeeId } });
    // intervals: synchronize actors so the race window is observable.
    const intervals = await prisma.attendanceInterval.findMany({ where: { employeeId: world.manager.employeeId } }); assert.ok(events.length > 0); assert.ok(intervals.length > 0);
    // Iterate to cover variants or wait until a condition holds.
    for (const times of [{ deviceTime: "invalid", receivedAt: "2000-03-01T08:00:00Z" }, { deviceTime: "2000-03-01T08:00:00Z", receivedAt: "invalid" }]) {
      // res: unique stamp so parallel runs do not collide.
      const res = await postJson(api, token, "/attendance/events", { source: "scenario-ingest", externalEventId: randomUUID(), employeeId: world.manager.employeeId, kind: "clock_out", ...times });
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 400, JSON.stringify(res.body));
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await prisma.attendanceEvent.findMany({ where: { employeeId: world.manager.employeeId } }), events);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await prisma.attendanceInterval.findMany({ where: { employeeId: world.manager.employeeId } }), intervals);
    }
  });
  // Case: one instant at hotel new-year midnight yields identical plan/task/roster/attendance date keys.
  it("one instant at hotel new-year midnight yields identical plan/task/roster/attendance date keys", async t => {
    // Bind instant for later setup or assertions in this scope.
    const instant = "1999-12-31T22:30:00.000Z"; t.mock.timers.enable({ apis: ["Date"], now: Date.parse(instant) });
    // Try path where partial failure must not leak suite state.
    try {
      // day: synchronize actors so the race window is observable.
      const day = await todayHotelDateYmd(); assert.equal(day, "2000-01-01");
      // task: seeded entity required before the mutation under test.
      const task = await createCleaningTask({ locationId: world.locationAId, hotelDate: day, assignedEmployeeId: world.hk1.employeeId });
      // plan: seeded entity required before the mutation under test.
      const plan = await createDailyPlanEntry({ locationId: world.locationAId, hotelDate: day, category: "arrival", createdByEmployeeId: world.owner.employeeId });
      // shift: unique stamp so parallel runs do not collide.
      const shift = await createShift({ code: `TZ${randomUUID().slice(0, 8)}`, nameBg: "Нощна", nameEn: "Night", startTime: "22:00", endTime: "06:00" }); shifts.push(shift.id);
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await upsertShiftRoster({ hotelDate: day, entries: [{ employeeId: world.hk1.employeeId, shiftId: shift.id }], actorEmployeeId: world.owner.employeeId });
      // res: unique stamp so parallel runs do not collide.
      const res = await postJson(api, token, "/attendance/events", { source: "scenario-timezone", externalEventId: randomUUID(), employeeId: world.reception.employeeId, kind: "clock_in", deviceTime: instant, receivedAt: instant }); assert.equal(res.status, 201);
      // Run actors together to expose races and serialization bugs.
      const [entry, roster, attendance] = await Promise.all([
        // Execute the next setup or assertion step for this scenario.
        prisma.dailyPlanEntry.findUniqueOrThrow({ where: { id: plan.entry.id } }),
        // Execute the next setup or assertion step for this scenario.
        prisma.employeeShiftRoster.findUniqueOrThrow({ where: { employeeId_hotelDate: { employeeId: world.hk1.employeeId, hotelDate: new Date(`${day}T00:00:00Z`) } } }),
        // Execute the next setup or assertion step for this scenario.
        prisma.attendanceInterval.findFirstOrThrow({ where: { employeeId: world.reception.employeeId } }),
      ]);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual([task.hotelDate, entry.hotelDate, roster.hotelDate, attendance.hotelDate].map(value => value.toISOString().slice(0, 10)), [day, day, day, day]);
      // Assert the observed value matches the intended post-condition.
      assert.equal(entry.cleaningTaskId, task.id);
    // Execute the next setup or assertion step for this scenario.
    } finally { t.mock.timers.reset(); }
  });
});
