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
// Import bindings from ../../src/services/cleaningResults.
import { getCleaningResults } from "../../src/services/cleaningResults";
// Import bindings from ../../src/services/analytics/housekeepingSummary.
import { getHousekeepingSummary } from "../../src/services/analytics/housekeepingSummary";
// Import bindings from ../../src/services/analytics/maintenanceSummary.
import { getMaintenanceSummary } from "../../src/services/analytics/maintenanceSummary";
// Import bindings from ../../src/services/settings.
import { getSetting, updateSetting } from "../../src/services/settings";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, getJson, listenApp, loginBearer } from "../httpHarness";

// Execute the next setup or assertion step for this scenario.
let world: CleaningWorld; let api: string; let server: Awaited<ReturnType<typeof listenApp>>["server"]; let token: string;
// Execute the next setup or assertion step for this scenario.
let operations: Awaited<ReturnType<typeof getSetting<"operations">>>;
// Execute the next setup or assertion step for this scenario.
const tasks: string[] = []; const extraEmployees: string[] = [];
// Execute the next setup or assertion step for this scenario.
let reworked: string; let auto: string; let awaiting: string; let anomalous: string;
// Bind d for later setup or assertions in this scope.
const d = (s: string) => new Date(`2000-01-${s}`);
// Bind period for later setup or assertions in this scope.
const period = { from: d("10T00:00:00Z"), to: d("11T23:59:59.999Z"), now: d("15T12:00:00Z") };
// Local helper task used by cases in this file.
async function task(input: { locationId?: string; employeeId?: string; at?: string | null; dueAt?: string | null; serviceType?: "stayover" | "departure"; status?: "completed" | "awaiting_inspection" }) {
  // row: seeded entity required before the mutation under test.
  const row = await prisma.cleaningTask.create({ data: { locationId: input.locationId ?? world.locationAId, assignedEmployeeId: input.employeeId ?? world.hk2.employeeId, hotelDate: d("10T00:00:00Z"), status: input.status ?? "completed", cleaningCycle: 0, completedAt: input.at ? d(input.at) : null, dueAt: input.dueAt ? d(input.dueAt) : null, serviceType: input.serviceType ?? "departure" } });
  // Execute the next setup or assertion step for this scenario.
  tasks.push(row.id); return row.id;
}
// Local helper session used by cases in this file.
async function session(taskId: string, minutes: number, finished: string, flags: string[] = [], employeeId = world.hk1.employeeId) {
  // Bind finishedAt for later setup or assertions in this scope.
  const finishedAt = d(finished);
  // Return the arranged value/result to the caller.
  return prisma.cleaningSession.create({ data: { taskId, employeeId, startedAt: new Date(finishedAt.getTime() - minutes * 60000), finishedAt, status: "completed", anomalyFlags: flags, startCommandId: randomUUID(), completeCommandId: randomUUID() } });
}
// Local helper inspect used by cases in this file.
async function inspect(taskId: string, result: "approved" | "rejected", at: string) {
  // Return the arranged value/result to the caller.
  return prisma.inspection.create({ data: { taskId, inspectorEmployeeId: world.manager.employeeId, result, inspectedAt: d(at), commandId: randomUUID(), findings: result === "rejected" ? "rework" : null } });
}
// Local helper query used by cases in this file.
function query(ids = [reworked, auto, awaiting, anomalous], from = "2000-01-10", to = "2000-01-11") {
  // Return the arranged value/result to the caller.
  return { from, to, page: 1, pageSize: 100, taskWhere: { id: { in: ids } } };
}
// Local helper scope used by cases in this file.
function scope(ids = tasks) { return { taskWhere: { id: { in: ids } }, sessionWhere: { taskId: { in: ids } }, locationWhere: { id: { in: [world.locationAId, world.locationBId] } }, ticketWhere: { locationId: { in: [world.locationAId, world.locationBId] } } }; }
// Suite: analytics against real rows and joins.
describe("analytics against real rows and joins", () => {
  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma); process.env.E2E_DISABLE_RATE_LIMIT = "1";
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma); operations = await getSetting("operations");
    // Await async work before asserting or releasing locks.
    await updateSetting({ key: "operations", value: { ...operations, overdueSessionMinutes: 60 }, actorEmployeeId: world.owner.employeeId });
    // Start or stop the in-process API server for this suite.
    ({ api, server } = await listenApp()); token = (await loginBearer(api, world.owner.email, "test-password-cln")).token;
    // Await async work before asserting or releasing locks.
    reworked = await task({ at: "11T12:00:00Z", dueAt: "11T12:00:00Z" });
    // Await async work before asserting or releasing locks.
    auto = await task({ employeeId: world.hk1.employeeId, at: "11T10:00:00Z", serviceType: "stayover" });
    // Await async work before asserting or releasing locks.
    awaiting = await task({ locationId: world.locationBId, status: "awaiting_inspection" });
    // Await async work before asserting or releasing locks.
    anomalous = await task({ locationId: world.locationBId, at: "11T12:00:00Z", dueAt: "11T11:00:00Z" });
    // Await async work before asserting or releasing locks.
    await session(reworked, 20, "10T10:00:00Z"); await session(reworked, 30, "10T11:00:00Z");
    // Await async work before asserting or releasing locks.
    await session(auto, 10, "11T10:00:00Z"); await session(awaiting, 60, "11T11:00:00Z"); await session(anomalous, 90, "11T12:00:00Z", ["clock_skew"]);
    // Await async work before asserting or releasing locks.
    await inspect(reworked, "rejected", "10T10:01:00Z"); await inspect(reworked, "approved", "11T12:00:00Z");
  });
  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) {
      // Await async work before asserting or releasing locks.
      await updateSetting({ key: "operations", value: operations, actorEmployeeId: world.owner.employeeId });
      // Await async work before asserting or releasing locks.
      await prisma.notification.deleteMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } } });
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.deleteMany({ where: { actorEmployeeId: world.owner.employeeId } });
      // Await async work before asserting or releasing locks.
      await cleanupCleaningWorld(prisma, world);
      // Await async work before asserting or releasing locks.
      await prisma.employee.deleteMany({ where: { id: { in: extraEmployees } } });
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });
  // Case: task/session/distinct-room counts, acceptance and assignee/worker attribution.
  it("task/session/distinct-room counts, acceptance and assignee/worker attribution", async () => {
    // report: HTTP response captured for status/body checks.
    const report = await getCleaningResults(query());
    // Assert the observed value matches the intended post-condition.
    assert.equal(report.summary.completedTasks, 3); assert.equal(report.summary.completedSessions, 5); assert.equal(report.summary.distinctRooms, 2);
    // Assert the observed value matches the intended post-condition.
    assert.equal(report.summary.acceptedTasks, 3); assert.equal(report.summary.reworkEvents, 1);
    // Bind a for later setup or assertions in this scope.
    const a = report.rows.find(r => r.employeeId === world.hk1.employeeId)!; const b = report.rows.find(r => r.employeeId === world.hk2.employeeId)!;
    // Assert the observed value matches the intended post-condition.
    assert.equal(a.completedSessions, 5); assert.equal(a.completedTasks, 1); assert.equal(a.acceptedTasks, 1); assert.equal(a.reworkEvents, 0);
    // Assert the observed value matches the intended post-condition.
    assert.equal(b.completedSessions, 0); assert.equal(b.completedTasks, 2); assert.equal(b.acceptedTasks, 2); assert.equal(b.reworkEvents, 1);
    // http: HTTP response captured for status/body checks.
    const http = await getJson(api, token, "/cleaning/results?from=2000-01-10&to=2000-01-11"); assert.equal(http.status, 200); assert.deepEqual((http.body as any).summary, report.summary);
  });
  // Case: final task completion and session finish belong to different days.
  it("final task completion and session finish belong to different days", async () => {
    // day10: HTTP response captured for status/body checks.
    const day10 = await getCleaningResults(query([reworked], "2000-01-10", "2000-01-10"));
    // day11: HTTP response captured for status/body checks.
    const day11 = await getCleaningResults(query([reworked], "2000-01-11", "2000-01-11"));
    // Assert the observed value matches the intended post-condition.
    assert.equal(day10.summary.completedSessions, 2); assert.equal(day10.summary.completedTasks, 0); assert.equal(day10.summary.acceptedTasks, 0);
    // Assert the observed value matches the intended post-condition.
    assert.equal(day11.summary.completedSessions, 0); assert.equal(day11.summary.completedTasks, 1); assert.equal(day11.summary.acceptedTasks, 1);
  });
  // Case: awaiting work cannot inflate task average; anomalous time is separately excluded.
  it("awaiting work cannot inflate task average; anomalous time is separately excluded", async () => {
    // result: HTTP response captured for status/body checks.
    const result = await getCleaningResults(query());
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.summary.totalValidSessionMinutes, 120); assert.equal(result.summary.totalExcludedSessionMinutes, 90); assert.equal(result.summary.anomalousSessions, 1); assert.equal(result.summary.productivity, 1.5);
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.rows.find(r => r.employeeId === world.hk1.employeeId)!.avgValidMinutes, 10);
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.rows.find(r => r.employeeId === world.hk2.employeeId)!.avgValidMinutes, 50);
    // analytics: HTTP response captured for status/body checks.
    const analytics = await getHousekeepingSummary(period, 2, scope([reworked, auto, awaiting, anomalous]));
    // Assert the observed value matches the intended post-condition.
    assert.equal(analytics.kpis.avgMinutesPerTask, 30); assert.equal(analytics.kpis.totalValidSessionMinutes, 120); assert.equal(analytics.kpis.totalExcludedSessionMinutes, 90);
  });
  // Case: known deadline denominator includes exact boundary and omits unknown deadline.
  it("known deadline denominator includes exact boundary and omits unknown deadline", async () => {
    // Execute the next setup or assertion step for this scenario.
    const ids: string[] = [];
    // Iterate to cover variants or wait until a condition holds.
    for (const at of ["11T09:59:59Z", "11T10:00:00Z", "11T10:00:01Z"]) ids.push(await task({ at, dueAt: "11T10:00:00Z" }));
    // Await async work before asserting or releasing locks.
    ids.push(await task({ at: "11T10:00:00Z" }));
    // Assert the observed value matches the intended post-condition.
    assert.equal((await getCleaningResults(query(ids))).summary.onTimePct, 66.7);
    // Assert the observed value matches the intended post-condition.
    assert.equal((await getCleaningResults(query([ids[3]!]))).summary.onTimePct, null);
  });
  // Case: empty and only anomalous datasets return applicable null KPIs without NaN/Infinity.
  it("empty and only anomalous datasets return applicable null KPIs without NaN/Infinity", async () => {
    // empty: HTTP response captured for status/body checks.
    const empty = await getCleaningResults(query([], "2000-01-01", "2000-01-01"));
    // Assert the observed value matches the intended post-condition.
    assert.equal(empty.summary.completedTasks, 0); assert.equal(empty.summary.completedSessions, 0); assert.equal(empty.summary.productivity, null); assert.equal(empty.summary.onTimePct, null);
    // report: HTTP response captured for status/body checks.
    const report = await getCleaningResults(query([anomalous]));
    // Assert the observed value matches the intended post-condition.
    assert.equal(report.summary.totalValidSessionMinutes, 0); assert.equal(report.summary.productivity, null); assert.equal(report.rows[0]!.avgValidMinutes, null);
    // Assert the observed value matches the intended post-condition.
    assert.ok(!JSON.stringify(report).includes("NaN"));
  });
  // Case: service type narrows tasks/sessions/inspections/employee and full summary equally.
  it("service type narrows tasks/sessions/inspections/employee and full summary equally", async () => {
    // report: HTTP response captured for status/body checks.
    const report = await getCleaningResults({ ...query(), serviceTypes: ["stayover"] });
    // Assert the observed value matches the intended post-condition.
    assert.equal(report.summary.completedTasks, 1); assert.equal(report.summary.completedSessions, 1); assert.equal(report.summary.acceptedTasks, 1); assert.equal(report.summary.reworkEvents, 0);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(report.rows.map(r => r.employeeId), [world.hk1.employeeId]);
    // Assert collection size matches the expected post-condition.
    assert.deepEqual(report.summary.byServiceType, [{ key: "stayover", count: 1 }]);
    // response: HTTP response captured for status/body checks.
    const response = await getJson(api, token, "/cleaning/results?from=2000-01-10&to=2000-01-11&serviceType=stayover");
    // Assert HTTP status matches the contract for this path.
    assert.equal(response.status, 200); assert.deepEqual((response.body as any).summary, report.summary);
  });
  // Case: real maintenance rows distinguish live and closed SLA, scoped previous period and dense days.
  it("real maintenance rows distinguish live and closed SLA, scoped previous period and dense days", async () => {
    // Execute the next setup or assertion step for this scenario.
    const ids: string[] = [];
    // Bind base for later setup or assertions in this scope.
    const base = { locationId: world.locationAId, title: "Metrics", categoryKey: "other", categoryLabelBg: "Друго", categoryLabelEn: "Other", reportedByEmployeeId: world.owner.employeeId, openedAt: d("10T12:00:00Z"), dueAt: d("11T10:00:00Z") };
    // Iterate to cover variants or wait until a condition holds.
    for (const data of [{ status: "new" }, { status: "resolved", resolvedAt: d("11T12:00:00Z") }, { status: "waiting", slaPausedAt: d("11T09:00:00Z") }, { status: "new", dueAt: period.now }, { status: "new", openedAt: d("08T12:00:00Z") }]) ids.push((await prisma.maintenanceTicket.create({ data: { ...base, ...data } as any })).id);
    // foreign: seeded entity required before the mutation under test.
    const foreign = await prisma.maintenanceTicket.create({ data: { ...base, locationId: world.locationBId, status: "new" } });
    // result: HTTP response captured for status/body checks.
    const result = await getMaintenanceSummary(period, 2, { ticketWhere: { id: { in: ids } } });
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(result.kpis.slaBreaches, { active: 2, closed: 1 });
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(result.comparison.signals, { current: 4, previous: 1, deltaPct: 300 });
    // Assert collection size matches the expected post-condition.
    assert.deepEqual(result.series, [{ date: "2000-01-10", count: 4 }, { date: "2000-01-11", count: 0 }]);
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.riskRooms.some(r => r.locationId === foreign.locationId), false);
  });
  // Case: risk room merges all factors once and respects ticket threshold.
  it("risk room merges all factors once and respects ticket threshold", async () => {
    // Await async work before asserting or releasing locks.
    await inspect(reworked, "rejected", "10T12:00:00Z");
    // result: HTTP response captured for status/body checks.
    const result = await getHousekeepingSummary(period, 2, scope());
    // Bind room for later setup or assertions in this scope.
    const room = result.riskRooms.filter(r => r.locationId === world.locationAId);
    // Assert collection size matches the expected post-condition.
    assert.equal(room.length, 1); assert.deepEqual(new Set(room[0]!.factors), new Set(["rejected_inspections_gte_2", "tickets_gte_2"]));
    // higher: HTTP response captured for status/body checks.
    const higher = await getHousekeepingSummary(period, 50, scope());
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(higher.riskRooms.find(r => r.locationId === world.locationAId)!.factors, ["rejected_inspections_gte_2"]);
    // boundary: HTTP response captured for status/body checks.
    const boundary = await getHousekeepingSummary(period, 4, scope());
    // Assert the observed value matches the intended post-condition.
    assert.ok(boundary.riskRooms.find(r => r.locationId === world.locationAId)!.factors.includes("tickets_gte_4"));
    // above: HTTP response captured for status/body checks.
    const above = await getHousekeepingSummary(period, 5, scope());
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(above.riskRooms.find(r => r.locationId === world.locationAId)!.factors, ["rejected_inspections_gte_2"]);
  });
  // Case: housekeeping compares nonzero prior data with same scope and fills empty days.
  it("housekeeping compares nonzero prior data with same scope and fills empty days", async () => {
    // previous: synchronize actors so the race window is observable.
    const previous = [await task({ at: "08T12:00:00Z" }), await task({ at: "09T12:00:00Z" })];
    // result: HTTP response captured for status/body checks.
    const result = await getHousekeepingSummary(period, 2, scope([reworked, auto, anomalous, ...previous]));
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(result.comparison.cleanedTasks, { current: 3, previous: 2, deltaPct: 50 });
    // Assert collection size matches the expected post-condition.
    assert.deepEqual(result.series, [{ date: "2000-01-10", count: 0 }, { date: "2000-01-11", count: 3 }]);
  });
  // Iterate to cover variants or wait until a condition holds.
  for (const [date, remaining] of [["2000-02-15", 14], ["2001-02-15", 13], ["2000-02-29", 0]] as const) it(`${date} forecast counts actual 28-day rows and ${remaining} remaining calendar days`, async () => {
    // Bind now for later setup or assertions in this scope.
    const now = new Date(`${date}T12:00:00Z`); const ids: string[] = []; const taskIds: string[] = [];
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (const daysAgo of [0, 1, 27, 29]) ids.push((await prisma.maintenanceTicket.create({ data: { locationId: world.locationBId, title: "Forecast", categoryKey: "other", categoryLabelBg: "Друго", categoryLabelEn: "Other", reportedByEmployeeId: world.owner.employeeId, openedAt: new Date(now.getTime() - daysAgo * 86400000) } })).id);
    // result: HTTP response captured for status/body checks.
    const result = await getMaintenanceSummary({ from: new Date(`${date}T00:00:00Z`), to: now, now }, 2, { ticketWhere: { id: { in: ids } } });
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.forecast.remainingDaysInMonth, remaining); assert.equal(result.forecast.predicted, Math.round(3 / 28 * remaining * 10) / 10); assert.match(result.forecast.formula, /3 tickets \/ 28 days/);
    // Iterate to cover variants or wait until a condition holds.
    for (const daysAgo of [0, 1, 27, 29]) taskIds.push((await prisma.cleaningTask.create({ data: { locationId: world.locationBId, hotelDate: new Date(`${date}T00:00:00Z`), status: "completed", cleaningCycle: 0, completedAt: new Date(now.getTime() - daysAgo * 86400000) } })).id);
    // hk: HTTP response captured for status/body checks.
    const hk = await getHousekeepingSummary({ from: new Date(`${date}T00:00:00Z`), to: now, now }, 2, scope(taskIds));
    // Assert the observed value matches the intended post-condition.
    assert.equal(hk.forecast.remainingDaysInMonth, remaining); assert.equal(hk.forecast.predicted, Math.round(3 / 28 * remaining * 10) / 10);
  });
  // Case: equal-volume/equal-name employees have a stable total order across pages and full summaries.
  it("equal-volume/equal-name employees have a stable total order across pages and full summaries", async () => {
    // Execute the next setup or assertion step for this scenario.
    const ids: string[] = []; const prefix = randomUUID(); const employeeIds = ["z", "a", "m"].map(x => `${prefix}-${x}`);
    // Iterate to cover variants or wait until a condition holds.
    for (const employeeId of employeeIds) { await prisma.employee.create({ data: { id: employeeId, employeeNumber: randomUUID(), fullName: "Same name" } }); extraEmployees.push(employeeId); ids.push(await task({ employeeId, at: "11T12:00:00Z" })); }
    // Execute the next setup or assertion step for this scenario.
    const seen: string[] = [];
    // Iterate to cover variants or wait until a condition holds.
    for (let page = 1; page <= 3; page++) {
      // result: HTTP response captured for status/body checks.
      const result = await getCleaningResults({ ...query(ids), page, pageSize: 1 });
      // Assert the observed value matches the intended post-condition.
      assert.equal(result.summary.completedTasks, 3); assert.equal(result.total, 3); seen.push(result.rows[0]!.employeeId);
    }
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(seen, [...employeeIds].sort());
  });
  // Case: housekeeping summary survives a window above the 32,767 bind-variable limit (CODE-05).
  it("housekeeping summary survives a window above the 32,767 bind-variable limit (CODE-05)", async () => {
    // Regression: nested `include: sessions` produced `taskId IN (<all ids>)`, which Prisma/PG reject
    // (`too many bind variables`) once more than 32,767 tasks completed in one period.
    const count = 32_800; const prefix = `an-bulk-${randomUUID()}-`; const bulkDay = new Date("1999-06-10T12:00:00Z");
    // Bind bulkPeriod for later setup or assertions in this scope.
    const bulkPeriod = { from: new Date("1999-06-10T00:00:00Z"), to: new Date("1999-06-10T23:59:59.999Z"), now: new Date("1999-06-11T12:00:00Z") };
    // Bind ids for later setup or assertions in this scope.
    const ids = Array.from({ length: count }, (_, i) => `${prefix}${i}`);
    // Try path where partial failure must not leak suite state.
    try {
      // Repeat/poll to widen the race window or wait for lock waiters.
      for (let i = 0; i < count; i += 4000) {
        // Bind slice for later setup or assertions in this scope.
        const slice = ids.slice(i, i + 4000);
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        await prisma.cleaningTask.createMany({ data: slice.map((id) => ({ id, locationId: world.locationAId, assignedEmployeeId: world.hk2.employeeId, hotelDate: bulkDay, status: "completed" as const, cleaningCycle: 0, completedAt: bulkDay, dueAt: new Date(bulkDay.getTime() + 60000) })) });
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        await prisma.cleaningSession.createMany({ data: slice.map((id) => ({ id: `${id}-s`, taskId: id, employeeId: world.hk1.employeeId, startedAt: new Date(bulkDay.getTime() - 10 * 60000), finishedAt: bulkDay, status: "completed" as const, anomalyFlags: [], startCommandId: randomUUID(), completeCommandId: randomUUID() })) });
      }
      // Bind bulkScope for later setup or assertions in this scope.
      const bulkScope = { taskWhere: { id: { startsWith: prefix } }, sessionWhere: { task: { id: { startsWith: prefix } } } };
      // result: HTTP response captured for status/body checks.
      const result = await getHousekeepingSummary(bulkPeriod, 3, bulkScope);
      // Assert collection size matches the expected post-condition.
      assert.equal(result.kpis.cleanedTasks, count); assert.equal(result.kpis.completedSessions, count);
      // Assert collection size matches the expected post-condition.
      assert.equal(result.kpis.acceptedTasks, count); assert.equal(result.kpis.distinctRooms, 1);
      // Assert the observed value matches the intended post-condition.
      assert.equal(result.kpis.onTimePct, 100); assert.equal(result.kpis.avgMinutesPerTask, 10);
      // Assert collection size matches the expected post-condition.
      assert.equal(result.kpis.totalValidSessionMinutes, count * 10); assert.equal(result.kpis.anomalousSessions, 0);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.cleaningSession.deleteMany({ where: { taskId: { startsWith: prefix } } });
      // Await async work before asserting or releasing locks.
      await prisma.cleaningTask.deleteMany({ where: { id: { startsWith: prefix } } });
    }
  });
});
