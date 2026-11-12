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
import { getCleaningResults } from "../../src/services/cleaningResults";
import { getHousekeepingSummary } from "../../src/services/analytics/housekeepingSummary";
import { getMaintenanceSummary } from "../../src/services/analytics/maintenanceSummary";
import { getSetting, updateSetting } from "../../src/services/settings";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, getJson, listenApp, loginBearer } from "../httpHarness";

let world: CleaningWorld; let api: string; let server: Awaited<ReturnType<typeof listenApp>>["server"]; let token: string;
let operations: Awaited<ReturnType<typeof getSetting<"operations">>>;
const tasks: string[] = []; const extraEmployees: string[] = [];
let reworked: string; let auto: string; let awaiting: string; let anomalous: string;
const d = (s: string) => new Date(`2000-01-${s}`);
const period = { from: d("10T00:00:00Z"), to: d("11T23:59:59.999Z"), now: d("15T12:00:00Z") };
// Local helper task used by cases in this file.
async function task(input: { locationId?: string; employeeId?: string; at?: string | null; dueAt?: string | null; serviceType?: "stayover" | "departure"; status?: "completed" | "awaiting_inspection" }) {
  // row: seeded entity required before the mutation under test.
  const row = await prisma.cleaningTask.create({ data: { locationId: input.locationId ?? world.locationAId, assignedEmployeeId: input.employeeId ?? world.hk2.employeeId, hotelDate: d("10T00:00:00Z"), status: input.status ?? "completed", cleaningCycle: 0, completedAt: input.at ? d(input.at) : null, dueAt: input.dueAt ? d(input.dueAt) : null, serviceType: input.serviceType ?? "departure" } });
  tasks.push(row.id); return row.id;
}
// Local helper session used by cases in this file.
async function session(taskId: string, minutes: number, finished: string, flags: string[] = [], employeeId = world.hk1.employeeId) {
  const finishedAt = d(finished);
  return prisma.cleaningSession.create({ data: { taskId, employeeId, startedAt: new Date(finishedAt.getTime() - minutes * 60000), finishedAt, status: "completed", anomalyFlags: flags, startCommandId: randomUUID(), completeCommandId: randomUUID() } });
}
// Local helper inspect used by cases in this file.
async function inspect(taskId: string, result: "approved" | "rejected", at: string) {
  return prisma.inspection.create({ data: { taskId, inspectorEmployeeId: world.manager.employeeId, result, inspectedAt: d(at), commandId: randomUUID(), findings: result === "rejected" ? "rework" : null } });
}
// Local helper query used by cases in this file.
function query(ids = [reworked, auto, awaiting, anomalous], from = "2000-01-10", to = "2000-01-11") {
  return { from, to, page: 1, pageSize: 100, taskWhere: { id: { in: ids } } };
}
// Local helper scope used by cases in this file.
function scope(ids = tasks) { return { taskWhere: { id: { in: ids } }, sessionWhere: { taskId: { in: ids } }, locationWhere: { id: { in: [world.locationAId, world.locationBId] } }, ticketWhere: { locationId: { in: [world.locationAId, world.locationBId] } } }; }
// Suite: analytics against real rows and joins.
describe("analytics against real rows and joins", () => {
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma); process.env.E2E_DISABLE_RATE_LIMIT = "1";
    world = await createCleaningWorld(prisma); operations = await getSetting("operations");
    await updateSetting({ key: "operations", value: { ...operations, overdueSessionMinutes: 60 }, actorEmployeeId: world.owner.employeeId });
    ({ api, server } = await listenApp()); token = (await loginBearer(api, world.owner.email, "test-password-cln")).token;
    reworked = await task({ at: "11T12:00:00Z", dueAt: "11T12:00:00Z" });
    auto = await task({ employeeId: world.hk1.employeeId, at: "11T10:00:00Z", serviceType: "stayover" });
    awaiting = await task({ locationId: world.locationBId, status: "awaiting_inspection" });
    anomalous = await task({ locationId: world.locationBId, at: "11T12:00:00Z", dueAt: "11T11:00:00Z" });
    await session(reworked, 20, "10T10:00:00Z"); await session(reworked, 30, "10T11:00:00Z");
    await session(auto, 10, "11T10:00:00Z"); await session(awaiting, 60, "11T11:00:00Z"); await session(anomalous, 90, "11T12:00:00Z", ["clock_skew"]);
    await inspect(reworked, "rejected", "10T10:01:00Z"); await inspect(reworked, "approved", "11T12:00:00Z");
  });
  after(async () => {
    if (server) await closeServer(server);
    if (world) {
      await updateSetting({ key: "operations", value: operations, actorEmployeeId: world.owner.employeeId });
      await prisma.notification.deleteMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } } });
      await prisma.auditEvent.deleteMany({ where: { actorEmployeeId: world.owner.employeeId } });
      await cleanupCleaningWorld(prisma, world);
      await prisma.employee.deleteMany({ where: { id: { in: extraEmployees } } });
    }
    await prisma.$disconnect();
  });
  // Case: task/session/distinct-room counts, acceptance and assignee/worker attribution.
  it("task/session/distinct-room counts, acceptance and assignee/worker attribution", async () => {
    const report = await getCleaningResults(query());
    assert.equal(report.summary.completedTasks, 3); assert.equal(report.summary.completedSessions, 5); assert.equal(report.summary.distinctRooms, 2);
    assert.equal(report.summary.acceptedTasks, 3); assert.equal(report.summary.reworkEvents, 1);
    const a = report.rows.find(r => r.employeeId === world.hk1.employeeId)!; const b = report.rows.find(r => r.employeeId === world.hk2.employeeId)!;
    assert.equal(a.completedSessions, 5); assert.equal(a.completedTasks, 1); assert.equal(a.acceptedTasks, 1); assert.equal(a.reworkEvents, 0);
    assert.equal(b.completedSessions, 0); assert.equal(b.completedTasks, 2); assert.equal(b.acceptedTasks, 2); assert.equal(b.reworkEvents, 1);
    const http = await getJson(api, token, "/cleaning/results?from=2000-01-10&to=2000-01-11"); assert.equal(http.status, 200); assert.deepEqual((http.body as any).summary, report.summary);
  });
  // Case: final task completion and session finish belong to different days.
  it("final task completion and session finish belong to different days", async () => {
    const day10 = await getCleaningResults(query([reworked], "2000-01-10", "2000-01-10"));
    const day11 = await getCleaningResults(query([reworked], "2000-01-11", "2000-01-11"));
    assert.equal(day10.summary.completedSessions, 2); assert.equal(day10.summary.completedTasks, 0); assert.equal(day10.summary.acceptedTasks, 0);
    assert.equal(day11.summary.completedSessions, 0); assert.equal(day11.summary.completedTasks, 1); assert.equal(day11.summary.acceptedTasks, 1);
  });
  // Case: awaiting work cannot inflate task average; anomalous time is separately excluded.
  it("awaiting work cannot inflate task average; anomalous time is separately excluded", async () => {
    const result = await getCleaningResults(query());
    assert.equal(result.summary.totalValidSessionMinutes, 120); assert.equal(result.summary.totalExcludedSessionMinutes, 90); assert.equal(result.summary.anomalousSessions, 1); assert.equal(result.summary.productivity, 1.5);
    assert.equal(result.rows.find(r => r.employeeId === world.hk1.employeeId)!.avgValidMinutes, 10);
    assert.equal(result.rows.find(r => r.employeeId === world.hk2.employeeId)!.avgValidMinutes, 50);
    const analytics = await getHousekeepingSummary(period, 2, scope([reworked, auto, awaiting, anomalous]));
    assert.equal(analytics.kpis.avgMinutesPerTask, 30); assert.equal(analytics.kpis.totalValidSessionMinutes, 120); assert.equal(analytics.kpis.totalExcludedSessionMinutes, 90);
  });
  // Case: known deadline denominator includes exact boundary and omits unknown deadline.
  it("known deadline denominator includes exact boundary and omits unknown deadline", async () => {
    const ids: string[] = [];
    for (const at of ["11T09:59:59Z", "11T10:00:00Z", "11T10:00:01Z"]) ids.push(await task({ at, dueAt: "11T10:00:00Z" }));
    ids.push(await task({ at: "11T10:00:00Z" }));
    assert.equal((await getCleaningResults(query(ids))).summary.onTimePct, 66.7);
    assert.equal((await getCleaningResults(query([ids[3]!]))).summary.onTimePct, null);
  });
  // Case: empty and only anomalous datasets return applicable null KPIs without NaN/Infinity.
  it("empty and only anomalous datasets return applicable null KPIs without NaN/Infinity", async () => {
    const empty = await getCleaningResults(query([], "2000-01-01", "2000-01-01"));
    assert.equal(empty.summary.completedTasks, 0); assert.equal(empty.summary.completedSessions, 0); assert.equal(empty.summary.productivity, null); assert.equal(empty.summary.onTimePct, null);
    const report = await getCleaningResults(query([anomalous]));
    assert.equal(report.summary.totalValidSessionMinutes, 0); assert.equal(report.summary.productivity, null); assert.equal(report.rows[0]!.avgValidMinutes, null);
    assert.ok(!JSON.stringify(report).includes("NaN"));
  });
  // Case: service type narrows tasks/sessions/inspections/employee and full summary equally.
  it("service type narrows tasks/sessions/inspections/employee and full summary equally", async () => {
    const report = await getCleaningResults({ ...query(), serviceTypes: ["stayover"] });
    assert.equal(report.summary.completedTasks, 1); assert.equal(report.summary.completedSessions, 1); assert.equal(report.summary.acceptedTasks, 1); assert.equal(report.summary.reworkEvents, 0);
    assert.deepEqual(report.rows.map(r => r.employeeId), [world.hk1.employeeId]);
    assert.deepEqual(report.summary.byServiceType, [{ key: "stayover", count: 1 }]);
    const response = await getJson(api, token, "/cleaning/results?from=2000-01-10&to=2000-01-11&serviceType=stayover");
    assert.equal(response.status, 200); assert.deepEqual((response.body as any).summary, report.summary);
  });
  // Case: real maintenance rows distinguish live and closed SLA, scoped previous period and dense days.
  it("real maintenance rows distinguish live and closed SLA, scoped previous period and dense days", async () => {
    const ids: string[] = [];
    const base = { locationId: world.locationAId, title: "Metrics", categoryKey: "other", categoryLabelBg: "Друго", categoryLabelEn: "Other", reportedByEmployeeId: world.owner.employeeId, openedAt: d("10T12:00:00Z"), dueAt: d("11T10:00:00Z") };
    for (const data of [{ status: "new" }, { status: "resolved", resolvedAt: d("11T12:00:00Z") }, { status: "waiting", slaPausedAt: d("11T09:00:00Z") }, { status: "new", dueAt: period.now }, { status: "new", openedAt: d("08T12:00:00Z") }]) ids.push((await prisma.maintenanceTicket.create({ data: { ...base, ...data } as any })).id);
    // foreign: seeded entity required before the mutation under test.
    const foreign = await prisma.maintenanceTicket.create({ data: { ...base, locationId: world.locationBId, status: "new" } });
    const result = await getMaintenanceSummary(period, 2, { ticketWhere: { id: { in: ids } } });
    assert.deepEqual(result.kpis.slaBreaches, { active: 2, closed: 1 });
    assert.deepEqual(result.comparison.signals, { current: 4, previous: 1, deltaPct: 300 });
    assert.deepEqual(result.series, [{ date: "2000-01-10", count: 4 }, { date: "2000-01-11", count: 0 }]);
    assert.equal(result.riskRooms.some(r => r.locationId === foreign.locationId), false);
  });
  // Case: risk room merges all factors once and respects ticket threshold.
  it("risk room merges all factors once and respects ticket threshold", async () => {
    await inspect(reworked, "rejected", "10T12:00:00Z");
    const result = await getHousekeepingSummary(period, 2, scope());
    const room = result.riskRooms.filter(r => r.locationId === world.locationAId);
    assert.equal(room.length, 1); assert.deepEqual(new Set(room[0]!.factors), new Set(["rejected_inspections_gte_2", "tickets_gte_2"]));
    const higher = await getHousekeepingSummary(period, 50, scope());
    assert.deepEqual(higher.riskRooms.find(r => r.locationId === world.locationAId)!.factors, ["rejected_inspections_gte_2"]);
    const boundary = await getHousekeepingSummary(period, 4, scope());
    assert.ok(boundary.riskRooms.find(r => r.locationId === world.locationAId)!.factors.includes("tickets_gte_4"));
    const above = await getHousekeepingSummary(period, 5, scope());
    assert.deepEqual(above.riskRooms.find(r => r.locationId === world.locationAId)!.factors, ["rejected_inspections_gte_2"]);
  });
  // Case: housekeeping compares nonzero prior data with same scope and fills empty days.
  it("housekeeping compares nonzero prior data with same scope and fills empty days", async () => {
    const previous = [await task({ at: "08T12:00:00Z" }), await task({ at: "09T12:00:00Z" })];
    const result = await getHousekeepingSummary(period, 2, scope([reworked, auto, anomalous, ...previous]));
    assert.deepEqual(result.comparison.cleanedTasks, { current: 3, previous: 2, deltaPct: 50 });
    assert.deepEqual(result.series, [{ date: "2000-01-10", count: 0 }, { date: "2000-01-11", count: 3 }]);
  });
  for (const [date, remaining] of [["2000-02-15", 14], ["2001-02-15", 13], ["2000-02-29", 0]] as const) it(`${date} forecast counts actual 28-day rows and ${remaining} remaining calendar days`, async () => {
    const now = new Date(`${date}T12:00:00Z`); const ids: string[] = []; const taskIds: string[] = [];
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (const daysAgo of [0, 1, 27, 29]) ids.push((await prisma.maintenanceTicket.create({ data: { locationId: world.locationBId, title: "Forecast", categoryKey: "other", categoryLabelBg: "Друго", categoryLabelEn: "Other", reportedByEmployeeId: world.owner.employeeId, openedAt: new Date(now.getTime() - daysAgo * 86400000) } })).id);
    const result = await getMaintenanceSummary({ from: new Date(`${date}T00:00:00Z`), to: now, now }, 2, { ticketWhere: { id: { in: ids } } });
    assert.equal(result.forecast.remainingDaysInMonth, remaining); assert.equal(result.forecast.predicted, Math.round(3 / 28 * remaining * 10) / 10); assert.match(result.forecast.formula, /3 tickets \/ 28 days/);
    for (const daysAgo of [0, 1, 27, 29]) taskIds.push((await prisma.cleaningTask.create({ data: { locationId: world.locationBId, hotelDate: new Date(`${date}T00:00:00Z`), status: "completed", cleaningCycle: 0, completedAt: new Date(now.getTime() - daysAgo * 86400000) } })).id);
    const hk = await getHousekeepingSummary({ from: new Date(`${date}T00:00:00Z`), to: now, now }, 2, scope(taskIds));
    assert.equal(hk.forecast.remainingDaysInMonth, remaining); assert.equal(hk.forecast.predicted, Math.round(3 / 28 * remaining * 10) / 10);
  });
  // Case: equal-volume/equal-name employees have a stable total order across pages and full summaries.
  it("equal-volume/equal-name employees have a stable total order across pages and full summaries", async () => {
    const ids: string[] = []; const prefix = randomUUID(); const employeeIds = ["z", "a", "m"].map(x => `${prefix}-${x}`);
    for (const employeeId of employeeIds) { await prisma.employee.create({ data: { id: employeeId, employeeNumber: randomUUID(), fullName: "Same name" } }); extraEmployees.push(employeeId); ids.push(await task({ employeeId, at: "11T12:00:00Z" })); }
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = await getCleaningResults({ ...query(ids), page, pageSize: 1 });
      assert.equal(result.summary.completedTasks, 3); assert.equal(result.total, 3); seen.push(result.rows[0]!.employeeId);
    }
    assert.deepEqual(seen, [...employeeIds].sort());
  });
  // Case: housekeeping summary survives a window above the 32,767 bind-variable limit (CODE-05).
  it("housekeeping summary survives a window above the 32,767 bind-variable limit (CODE-05)", async () => {
    // Regression: nested `include: sessions` produced `taskId IN (<all ids>)`, which Prisma/PG reject
    // (`too many bind variables`) once more than 32,767 tasks completed in one period.
    const count = 32_800; const prefix = `an-bulk-${randomUUID()}-`; const bulkDay = new Date("1999-06-10T12:00:00Z");
    const bulkPeriod = { from: new Date("1999-06-10T00:00:00Z"), to: new Date("1999-06-10T23:59:59.999Z"), now: new Date("1999-06-11T12:00:00Z") };
    const ids = Array.from({ length: count }, (_, i) => `${prefix}${i}`);
    try {
      // Repeat/poll to widen the race window or wait for lock waiters.
      for (let i = 0; i < count; i += 4000) {
        const slice = ids.slice(i, i + 4000);
        await prisma.cleaningTask.createMany({ data: slice.map((id) => ({ id, locationId: world.locationAId, assignedEmployeeId: world.hk2.employeeId, hotelDate: bulkDay, status: "completed" as const, cleaningCycle: 0, completedAt: bulkDay, dueAt: new Date(bulkDay.getTime() + 60000) })) });
        await prisma.cleaningSession.createMany({ data: slice.map((id) => ({ id: `${id}-s`, taskId: id, employeeId: world.hk1.employeeId, startedAt: new Date(bulkDay.getTime() - 10 * 60000), finishedAt: bulkDay, status: "completed" as const, anomalyFlags: [], startCommandId: randomUUID(), completeCommandId: randomUUID() })) });
      }
      const bulkScope = { taskWhere: { id: { startsWith: prefix } }, sessionWhere: { task: { id: { startsWith: prefix } } } };
      const result = await getHousekeepingSummary(bulkPeriod, 3, bulkScope);
      assert.equal(result.kpis.cleanedTasks, count); assert.equal(result.kpis.completedSessions, count);
      assert.equal(result.kpis.acceptedTasks, count); assert.equal(result.kpis.distinctRooms, 1);
      assert.equal(result.kpis.onTimePct, 100); assert.equal(result.kpis.avgMinutesPerTask, 10);
      assert.equal(result.kpis.totalValidSessionMinutes, count * 10); assert.equal(result.kpis.anomalousSessions, 0);
    } finally {
      await prisma.cleaningSession.deleteMany({ where: { taskId: { startsWith: prefix } } });
      await prisma.cleaningTask.deleteMany({ where: { id: { startsWith: prefix } } });
    }
  });
});
