// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, getJson, listenApp, loginBearer, patchJson, postJson, putJson, putRoleGrantsJson, requestJson, snapshotRoleGrants, restoreRoleGrants } from "../httpHarness";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createCleaningWorld, cleanupCleaningWorld, type CleaningWorld } from "../cleaning/fixtures";
import { getSetting, updateSetting } from "../../src/services/settings";
import { createMaintenanceTicket } from "../../src/services/maintenance";
import { createCategory, updateCategory, archiveCategory, createIssueOption, reorderIssueOptions } from "../../src/services/issueCatalog";
import { createDailyPlanEntry } from "../../src/services/dailyPlan";
import { todayHotelDateYmd } from "../../src/services/hotelTime";

let world: CleaningWorld; let api: string; let server: Awaited<ReturnType<typeof listenApp>>["server"]; let token: string;
let operations: Awaited<ReturnType<typeof getSetting<"operations">>>;
let access: Awaited<ReturnType<typeof getSetting<"access">>>;
let flags: Awaited<ReturnType<typeof getSetting<"flags">>>;
const categoryIds: string[] = []; const shiftIds: string[] = [];
// Suite: P2 settings, catalog, calendar and plan contracts.
describe("P2 settings, catalog, calendar and plan contracts", () => {
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma); process.env.E2E_DISABLE_RATE_LIMIT = "1";
    world = await createCleaningWorld(prisma); operations = await getSetting("operations"); access = await getSetting("access"); flags = await getSetting("flags");
    for (const [key, value] of [["operations", operations], ["access", access], ["flags", flags]] as const) await updateSetting({ key, value, actorEmployeeId: world.owner.employeeId, reason: "nonempty baseline" });
    ({ api, server } = await listenApp()); token = (await loginBearer(api, world.owner.email, "test-password-cln")).token;
  });
  after(async () => {
    if (server) await closeServer(server);
    if (world) {
      for (const [key, value] of [["operations", operations], ["access", access], ["flags", flags]] as const) await updateSetting({ key, value, actorEmployeeId: world.owner.employeeId, reason: "restore" });
      await prisma.notification.deleteMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } } });
      await prisma.ticketEvent.deleteMany({ where: { ticket: { locationId: { in: [world.locationAId, world.locationBId] } } } });
      await prisma.auditEvent.deleteMany({ where: { OR: [{ actorEmployeeId: { in: world.employeeIds } }, { locationId: { in: [world.locationAId, world.locationBId] } }] } });
      await prisma.dailyPlanEntry.deleteMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } } });
      await prisma.dailyPlanImportBatch.deleteMany({ where: { createdByEmployeeId: world.owner.employeeId } });
      await prisma.employeeShiftRoster.deleteMany({ where: { employeeId: { in: world.employeeIds } } });
      await cleanupCleaningWorld(prisma, world);
      await prisma.issueOption.deleteMany({ where: { maintenanceCategoryId: { in: categoryIds } } });
      await prisma.maintenanceCategory.deleteMany({ where: { id: { in: categoryIds } } });
      await prisma.shift.deleteMany({ where: { id: { in: shiftIds } } });
    }
    await prisma.$disconnect();
  });
  // Case: invalid operations/access/flags preserve nonempty settings and history.
  it("invalid operations/access/flags preserve nonempty settings and history", async () => {
    for (const [key, invalid] of [
      ["operations", { ...operations, overdueSessionMinutes: 0 }], ["operations", { ...operations, defaultTaskDueHours: 73 }],
      ["access", { ...access, invitationTtlHours: 0 }], ["access", { ...access, sessionIdleDays: -1 }], ["flags", { ...flags, require_inspection: "false" }],
    ] as const) {
      const before = await prisma.appSetting.findUniqueOrThrow({ where: { key } });
      const audits = await prisma.auditEvent.findMany({ where: { entityType: "setting", entityId: key } }); assert.ok(audits.length > 0);
      const res = await patchJson(api, token, `/settings/${key}`, { value: invalid, reason: "invalid", expectedVersion: before.version }); assert.equal(res.status, 400);
      assert.deepEqual(await prisma.appSetting.findUniqueOrThrow({ where: { key } }), before);
      assert.deepEqual(await prisma.auditEvent.findMany({ where: { entityType: "setting", entityId: key } }), audits);
    }
  });
  // Case: saved setting is immediate and survives a fresh process.
  it("saved setting is immediate and survives a fresh process", async () => {
    const value = { ...operations, overdueSessionMinutes: operations.overdueSessionMinutes === 91 ? 92 : 91 };
    try {
      const ver = (await prisma.appSetting.findUniqueOrThrow({ where: { key: "operations" } })).version;
      assert.equal((await patchJson(api, token, "/settings/operations", { value, reason: "restart contract", expectedVersion: ver })).status, 200);
      assert.equal((await getSetting("operations")).overdueSessionMinutes, value.overdueSessionMinutes);
      // Concatenate into one string: console.log(label, number) uses util.inspect
      // and emits ANSI color under FORCE_COLOR (e.g. from the parent test runner).
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "./tests/registerP1TestEnv.mjs",
          "--import",
          "tsx",
          "-e",
          "const {getSetting}=require('./src/services/settings'); const {prisma}=require('./src/db'); getSetting('operations').then(v=>console.log('PERSISTED '+v.overdueSessionMinutes)).finally(()=>prisma.$disconnect())",
        ],
        {
          // Configure cwd for the request/server under test.
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 10000,
          // Configure env for the request/server under test.
          env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
        },
      );
      assert.equal(child.status, 0, child.stderr);
      assert.match(
        child.stdout,
        new RegExp(`PERSISTED ${value.overdueSessionMinutes}`),
      );
    } finally { await updateSetting({ key: "operations", value: operations, actorEmployeeId: world.owner.employeeId, reason: "restore" }); }
  });
  // Case: changing default SLA changes new ticket only; existing deadline stays fixed.
  it("changing default SLA changes new ticket only; existing deadline stays fixed", async () => {
    const policy = await prisma.slaPolicy.findUnique({ where: { priority: "normal" } });
    const category = await createCategory({ key: `c_${randomUUID().replaceAll("-", "").slice(0, 20)}`, nameBg: "Категория", nameEn: "Category" }); categoryIds.push(category.id);
    const now = new Date("2026-01-01T10:00:00Z");
    try {
      if (policy) await prisma.slaPolicy.update({ where: { id: policy.id }, data: { isActive: false } });
      await updateSetting({ key: "operations", value: { ...operations, defaultTicketSlaHours: 4 }, actorEmployeeId: world.owner.employeeId });
      // a: seeded entity required before the mutation under test.
      const a = await createMaintenanceTicket({ locationId: world.locationAId, categoryId: category.id, title: "before", blocksRoom: false, reportedByEmployeeId: world.owner.employeeId, now });
      await updateSetting({ key: "operations", value: { ...operations, defaultTicketSlaHours: 9 }, actorEmployeeId: world.owner.employeeId });
      // b: seeded entity required before the mutation under test.
      const b = await createMaintenanceTicket({ locationId: world.locationAId, categoryId: category.id, title: "after", blocksRoom: false, reportedByEmployeeId: world.owner.employeeId, now });
      assert.equal(new Date(a.ticket.dueAt!).getTime(), now.getTime() + 4 * 3600000);
      assert.equal(new Date(b.ticket.dueAt!).getTime(), now.getTime() + 9 * 3600000);
      assert.equal((await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: a.ticket.id } })).dueAt!.getTime(), now.getTime() + 4 * 3600000);
    } finally {
      if (policy) await prisma.slaPolicy.update({ where: { id: policy.id }, data: policy });
      await updateSetting({ key: "operations", value: operations, actorEmployeeId: world.owner.employeeId });
    }
  });
  // Case checks authz/session policy: permission history records exact add/revoke actor/reason and identical save is a no-op.
  it("permission history records exact add/revoke actor/reason and identical save is a no-op", async () => {
    const snapshot = await snapshotRoleGrants(prisma, ["housekeeper"]);
    const baseline = { panels: snapshot.filter(r => r.kind === "panel").map(r => r.key), actions: snapshot.filter(r => r.kind === "action").map(r => r.key) };
    const remove = baseline.actions.find(k => k !== "tickets.report")!;
    const next = { panels: baseline.panels, actions: baseline.actions.filter(k => k !== remove).concat(baseline.actions.includes("audit.view") ? [] : ["audit.view"]), reason: randomUUID() };
    try {
      assert.equal((await putRoleGrantsJson(api, token, "housekeeper", next)).status, 200);
      const history = await prisma.auditEvent.findMany({ where: { reason: next.reason } });
      assert.deepEqual(history.map(h => [h.action, h.entityId]).sort(), [["permission.grant", "housekeeper:action:audit.view"], ["permission.revoke", `housekeeper:action:${remove}`]].sort());
      assert.ok(history.every(h => h.actorEmployeeId === world.owner.employeeId));
      assert.equal((await putRoleGrantsJson(api, token, "housekeeper", next)).status, 200);
      assert.deepEqual(await prisma.auditEvent.findMany({ where: { reason: next.reason } }), history);
    } finally { await restoreRoleGrants(prisma, ["housekeeper"], snapshot); }
  });
  // Case: all audit filters intersect without broadening location/actor/time/entity.
  it("all audit filters intersect without broadening location/actor/time/entity", async () => {
    const entity = randomUUID(); const action = `scenario.${randomUUID()}`;
    const template = { action, entityType: "scenario", entityId: entity, actorEmployeeId: world.owner.employeeId, locationId: world.locationAId, occurredAt: new Date("2026-01-10T12:00:00Z") };
    // wanted: seeded entity required before the mutation under test.
    const wanted = await prisma.auditEvent.create({ data: template });
    for (const patch of [{ actorEmployeeId: world.hk1.employeeId }, { locationId: world.locationBId }, { entityId: "other" }, { action: "other" }, { occurredAt: new Date("2025-12-31") }]) await prisma.auditEvent.create({ data: { ...template, ...patch } });
    const q = new URLSearchParams({ action, entityType: "scenario", entityId: entity, actorEmployeeId: world.owner.employeeId, locationId: world.locationAId, from: "2026-01-10T00:00:00.000Z", to: "2026-01-10T23:59:59.999Z" });
    const res = await getJson(api, token, `/audit?${q}`); assert.equal(res.status, 200); assert.deepEqual((res.body as any[]).map(r => r.id), [wanted.id]);
  });
  // Case: invalid floor and duplicate number create/update leave room and audit unchanged.
  it("invalid floor and duplicate number create/update leave room and audit unchanged", async () => {
    const before = await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } });
    const other = await prisma.location.findUniqueOrThrow({ where: { id: world.locationBId } });
    const audits = await prisma.auditEvent.findMany({ where: { locationId: world.locationAId } });
    for (const [body, code] of [[{ floorId: "unknown", number: "new" }, 404], [{ floorId: world.floorId, number: other.number }, 409]] as const) {
      assert.equal((await postJson(api, token, "/locations", body)).status, code);
      assert.equal((await patchJson(api, token, `/locations/${world.locationAId}`, body)).status, code);
      assert.deepEqual(await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } }), before);
      assert.deepEqual(await prisma.auditEvent.findMany({ where: { locationId: world.locationAId } }), audits);
    }
  });
  // Case: archive/restore retains occupancy, cleaning, service, cycle and old history.
  it("archive/restore retains occupancy, cleaning, service, cycle and old history", async () => {
    await prisma.location.update({ where: { id: world.locationBId }, data: { occupancy: "occupied", cleaningStatus: "dirty", serviceStatus: "out_of_service", cleaningCycle: 7 } });
    const before = await prisma.location.findUniqueOrThrow({ where: { id: world.locationBId } });
    // old: seeded entity required before the mutation under test.
    const old = await prisma.auditEvent.create({ data: { entityType: "location", entityId: world.locationBId, locationId: world.locationBId, action: "scenario.old", after: { value: "old" } } });
    assert.equal((await postJson(api, token, `/locations/${world.locationBId}/archive`, {})).status, 200);
    assert.equal((await postJson(api, token, `/locations/${world.locationBId}/restore`, {})).status, 200);
    const after = await prisma.location.findUniqueOrThrow({ where: { id: world.locationBId } });
    for (const key of ["occupancy", "cleaningStatus", "serviceStatus", "cleaningCycle", "catalogStatus"] as const) assert.equal(after[key], before[key]);
    assert.deepEqual(await prisma.auditEvent.findUniqueOrThrow({ where: { id: old.id } }), old);
  });
  // Case probes concurrency/isolation: category snapshot and preset defaults retain explicit blocksRoom.
  it("category snapshot and preset defaults retain explicit blocksRoom", async () => {
    const category = await createCategory({ key: `c_${randomUUID().replaceAll("-", "").slice(0, 20)}`, nameBg: "Стара категория", nameEn: "Old Category" }); categoryIds.push(category.id);
    // option: seeded entity required before the mutation under test.
    const option = await createIssueOption({ maintenanceCategoryId: category.id, kind: "maintenance", nameBg: "Предварително описание", nameEn: "Preset", defaultPriority: "urgent", defaultBlocksRoom: true });
    const res = await postJson(api, token, "/maintenance/tickets", { locationId: world.locationAId, issueOptionId: option.id, blocksRoom: false, commandId: randomUUID() }); assert.equal(res.status, 201);
    const ticket = (res.body as any).ticket ?? res.body;
    assert.equal(ticket.title, "Предварително описание"); assert.equal(ticket.priority, "urgent"); assert.equal(ticket.blocksRoom, false);
    const before = await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    await updateCategory(category.id, { nameBg: "Нова категория", nameEn: "New Category" }); await archiveCategory(category.id);
    assert.deepEqual(await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticket.id } }), before);
    assert.equal(before.categoryLabelBg, "Стара категория");
  });
  // Case: option reorder is atomic for unknown, duplicate and late database errors.
  it("option reorder is atomic for unknown, duplicate and late database errors", async () => {
    const category = await createCategory({ key: `c_${randomUUID().replaceAll("-", "").slice(0, 20)}`, nameBg: "Подредба", nameEn: "Order" }); categoryIds.push(category.id);
    const ids: string[] = [];
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < 3; i++) ids.push((await createIssueOption({ maintenanceCategoryId: category.id, kind: "maintenance", nameBg: `Опция ${i}`, nameEn: `Option ${i}`, sortOrder: i })).id);
    const read = () => prisma.issueOption.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
    await reorderIssueOptions([...ids].reverse()); const before = await read();
    assert.deepEqual(ids.map(id => before.find(r => r.id === id)!.sortOrder), [2, 1, 0]);
    for (const invalid of [[ids[0]!, "unknown"], [ids[0]!, ids[0]!]]) { await assert.rejects(reorderIssueOptions(invalid), /Unknown/); assert.deepEqual(await read(), before); }
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION scenario_order_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${ids[1]}' AND EXISTS (SELECT 1 FROM "IssueOption" WHERE id = '${ids[0]}' AND "sortOrder" = 0) THEN RAISE EXCEPTION 'scenario_order_after_first_write'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER scenario_order_fail BEFORE UPDATE ON "IssueOption" FOR EACH ROW EXECUTE FUNCTION scenario_order_fail()');
    try { await assert.rejects(reorderIssueOptions(ids), /scenario_order_after_first_write/); assert.deepEqual(await read(), before); }
    // Always run cleanup to preserve DB/server isolation across cases.
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER scenario_order_fail ON "IssueOption"'); await prisma.$executeRawUnsafe('DROP FUNCTION scenario_order_fail()'); }
  });
  // Case: overnight shift persists and invalid hours leave catalog unchanged.
  it("overnight shift persists and invalid hours leave catalog unchanged", async () => {
    const body = { code: `S${randomUUID().slice(0, 7)}`, nameBg: "Нощна", nameEn: "Night", startTime: "22:00", endTime: "06:00" };
    const good = await postJson(api, token, "/shifts", body); assert.equal(good.status, 201); shiftIds.push((good.body as any).id);
    assert.equal((await prisma.shift.findUniqueOrThrow({ where: { id: (good.body as any).id } })).endTime, "06:00");
    const count = await prisma.shift.count();
    for (const invalid of ["24:00", "12:60", "9:30", "invalid"]) assert.equal((await postJson(api, token, "/shifts", { ...body, code: randomUUID(), endTime: invalid })).status, 400);
    assert.equal(await prisma.shift.count(), count);
  });
  // Case: impossible task and roster dates reject without rollover or partial writes.
  it("impossible task and roster dates reject without rollover or partial writes", async () => {
    const before = await prisma.cleaningTask.count({ where: { locationId: world.locationAId } });
    const rosters = await prisma.employeeShiftRoster.findMany({ where: { employeeId: world.hk1.employeeId } });
    for (const hotelDate of ["2025-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10"]) {
      assert.equal((await postJson(api, token, "/cleaning/tasks", { locationId: world.locationAId, hotelDate })).status, 400, `task ${hotelDate}`);
    }
    assert.equal(await prisma.cleaningTask.count({ where: { locationId: world.locationAId } }), before);
    assert.deepEqual(await prisma.employeeShiftRoster.findMany({ where: { employeeId: world.hk1.employeeId } }), rosters);
    assert.equal((await postJson(api, token, "/cleaning/tasks", { locationId: world.locationAId, hotelDate: "2028-02-29" })).status, 201);
  });
  // Case: roster rejects impossible date without deleting other hotel days.
  it("roster rejects impossible date without deleting other hotel days", async () => {
    const before = await prisma.employeeShiftRoster.findMany({ where: { employeeId: world.hk1.employeeId } });
    assert.equal((await putJson(api, token, "/shifts/roster", { hotelDate: "2026-02-30", entries: [{ employeeId: world.hk1.employeeId, shiftId: shiftIds[0] }] })).status, 400);
    assert.deepEqual(await prisma.employeeShiftRoster.findMany({ where: { employeeId: world.hk1.employeeId } }), before);
  });
  // Case: deleting plan row retains created task and applied room effects.
  it("deleting plan row retains created task and applied room effects", async () => {
    await prisma.location.update({ where: { id: world.locationAId }, data: { occupancy: "vacant", cleaningStatus: "dirty" } });
    // created: seeded entity required before the mutation under test.
    const created = await createDailyPlanEntry({ hotelDate: await todayHotelDateYmd(), locationId: world.locationAId, category: "arrival", assignedEmployeeId: world.hk1.employeeId, createdByEmployeeId: world.owner.employeeId });
    // entry: seeded entity required before the mutation under test.
    const entry = await prisma.dailyPlanEntry.findUniqueOrThrow({ where: { id: created.entry.id } }); assert.ok(entry.cleaningTaskId);
    const task = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: entry.cleaningTaskId! } });
    const location = await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } });
    assert.equal((await requestJson(api, token, "DELETE", `/daily-plan/${entry.id}`)).status, 200);
    assert.equal(await prisma.dailyPlanEntry.findUnique({ where: { id: entry.id } }), null);
    assert.deepEqual(await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } }), task);
    assert.deepEqual(await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } }), location);
  });
  // Case: malformed import envelopes are HTTP validation errors, with no new batches.
  it("malformed import envelopes are HTTP validation errors, with no new batches", async () => {
    // before: seeded entity required before the mutation under test.
    const before = await prisma.dailyPlanImportBatch.count({ where: { createdByEmployeeId: world.owner.employeeId } });
    for (const body of [{ hotelDate: "2026-10-19" }, { hotelDate: "2026-10-19", entries: {} }, [], null, "invalid"]) assert.equal((await postJson(api, token, "/daily-plan/import", body)).status, 400);
    assert.equal(await prisma.dailyPlanImportBatch.count({ where: { createdByEmployeeId: world.owner.employeeId } }), before);
  });
});
