// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Import bindings from node:child_process.
import { spawnSync } from "node:child_process";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, getJson, listenApp, loginBearer, patchJson, postJson, putJson, putRoleGrantsJson, requestJson, snapshotRoleGrants, restoreRoleGrants } from "../httpHarness";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createCleaningWorld, cleanupCleaningWorld, type CleaningWorld } from "../cleaning/fixtures";
// Import bindings from ../../src/services/settings.
import { getSetting, updateSetting } from "../../src/services/settings";
// Import bindings from ../../src/services/maintenance.
import { createMaintenanceTicket } from "../../src/services/maintenance";
// Import bindings from ../../src/services/issueCatalog.
import { createCategory, updateCategory, archiveCategory, createIssueOption, reorderIssueOptions } from "../../src/services/issueCatalog";
// Import bindings from ../../src/services/dailyPlan.
import { createDailyPlanEntry } from "../../src/services/dailyPlan";
// Import bindings from ../../src/services/hotelTime.
import { todayHotelDateYmd } from "../../src/services/hotelTime";

// Execute the next setup or assertion step for this scenario.
let world: CleaningWorld; let api: string; let server: Awaited<ReturnType<typeof listenApp>>["server"]; let token: string;
// Execute the next setup or assertion step for this scenario.
let operations: Awaited<ReturnType<typeof getSetting<"operations">>>;
// Execute the next setup or assertion step for this scenario.
let access: Awaited<ReturnType<typeof getSetting<"access">>>;
// Execute the next setup or assertion step for this scenario.
let flags: Awaited<ReturnType<typeof getSetting<"flags">>>;
// Execute the next setup or assertion step for this scenario.
const categoryIds: string[] = []; const shiftIds: string[] = [];
// Suite: P2 settings, catalog, calendar and plan contracts.
describe("P2 settings, catalog, calendar and plan contracts", () => {
  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma); process.env.E2E_DISABLE_RATE_LIMIT = "1";
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma); operations = await getSetting("operations"); access = await getSetting("access"); flags = await getSetting("flags");
    // Iterate to cover variants or wait until a condition holds.
    for (const [key, value] of [["operations", operations], ["access", access], ["flags", flags]] as const) await updateSetting({ key, value, actorEmployeeId: world.owner.employeeId, reason: "nonempty baseline" });
    // Start or stop the in-process API server for this suite.
    ({ api, server } = await listenApp()); token = (await loginBearer(api, world.owner.email, "test-password-cln")).token;
  });
  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) {
      // Iterate to cover variants or wait until a condition holds.
      for (const [key, value] of [["operations", operations], ["access", access], ["flags", flags]] as const) await updateSetting({ key, value, actorEmployeeId: world.owner.employeeId, reason: "restore" });
      // Await async work before asserting or releasing locks.
      await prisma.notification.deleteMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } } });
      // Await async work before asserting or releasing locks.
      await prisma.ticketEvent.deleteMany({ where: { ticket: { locationId: { in: [world.locationAId, world.locationBId] } } } });
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.deleteMany({ where: { OR: [{ actorEmployeeId: { in: world.employeeIds } }, { locationId: { in: [world.locationAId, world.locationBId] } }] } });
      // Await async work before asserting or releasing locks.
      await prisma.dailyPlanEntry.deleteMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } } });
      // Await async work before asserting or releasing locks.
      await prisma.dailyPlanImportBatch.deleteMany({ where: { createdByEmployeeId: world.owner.employeeId } });
      // Await async work before asserting or releasing locks.
      await prisma.employeeShiftRoster.deleteMany({ where: { employeeId: { in: world.employeeIds } } });
      // Await async work before asserting or releasing locks.
      await cleanupCleaningWorld(prisma, world);
      // Await async work before asserting or releasing locks.
      await prisma.issueOption.deleteMany({ where: { maintenanceCategoryId: { in: categoryIds } } });
      // Await async work before asserting or releasing locks.
      await prisma.maintenanceCategory.deleteMany({ where: { id: { in: categoryIds } } });
      // Await async work before asserting or releasing locks.
      await prisma.shift.deleteMany({ where: { id: { in: shiftIds } } });
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });
  // Case: invalid operations/access/flags preserve nonempty settings and history.
  it("invalid operations/access/flags preserve nonempty settings and history", async () => {
    // Iterate to cover variants or wait until a condition holds.
    for (const [key, invalid] of [
      // Session/CSRF step exercising auth lifecycle.
      ["operations", { ...operations, overdueSessionMinutes: 0 }], ["operations", { ...operations, defaultTaskDueHours: 73 }],
      // Session/CSRF step exercising auth lifecycle.
      ["access", { ...access, invitationTtlHours: 0 }], ["access", { ...access, sessionIdleDays: -1 }], ["flags", { ...flags, require_inspection: "false" }],
    // Execute the next setup or assertion step for this scenario.
    ] as const) {
      // before: synchronize actors so the race window is observable.
      const before = await prisma.appSetting.findUniqueOrThrow({ where: { key } });
      // audits: synchronize actors so the race window is observable.
      const audits = await prisma.auditEvent.findMany({ where: { entityType: "setting", entityId: key } }); assert.ok(audits.length > 0);
      // res: HTTP response captured for status/body checks.
      const res = await patchJson(api, token, `/settings/${key}`, { value: invalid, reason: "invalid", expectedVersion: before.version }); assert.equal(res.status, 400);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await prisma.appSetting.findUniqueOrThrow({ where: { key } }), before);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await prisma.auditEvent.findMany({ where: { entityType: "setting", entityId: key } }), audits);
    }
  });
  // Case: saved setting is immediate and survives a fresh process.
  it("saved setting is immediate and survives a fresh process", async () => {
    // Bind value for later setup or assertions in this scope.
    const value = { ...operations, overdueSessionMinutes: operations.overdueSessionMinutes === 91 ? 92 : 91 };
    // Try path where partial failure must not leak suite state.
    try {
      // ver: synchronize actors so the race window is observable.
      const ver = (await prisma.appSetting.findUniqueOrThrow({ where: { key: "operations" } })).version;
      // Assert HTTP status matches the contract for this path.
      assert.equal((await patchJson(api, token, "/settings/operations", { value, reason: "restart contract", expectedVersion: ver })).status, 200);
      // Assert the observed value matches the intended post-condition.
      assert.equal((await getSetting("operations")).overdueSessionMinutes, value.overdueSessionMinutes);
      // Concatenate into one string: console.log(label, number) uses util.inspect
      // and emits ANSI color under FORCE_COLOR (e.g. from the parent test runner).
      const child = spawnSync(
        // Execute the next setup or assertion step for this scenario.
        process.execPath,
        [
          // Execute the next setup or assertion step for this scenario.
          "--import",
          // Execute the next setup or assertion step for this scenario.
          "./tests/registerP1TestEnv.mjs",
          // Execute the next setup or assertion step for this scenario.
          "--import",
          // Execute the next setup or assertion step for this scenario.
          "tsx",
          // Execute the next setup or assertion step for this scenario.
          "-e",
          // Disconnect Prisma so the pool does not leak across suites.
          "const {getSetting}=require('./src/services/settings'); const {prisma}=require('./src/db'); getSetting('operations').then(v=>console.log('PERSISTED '+v.overdueSessionMinutes)).finally(()=>prisma.$disconnect())",
        ],
        {
          // Configure cwd for the request/server under test.
          cwd: process.cwd(),
          // Execute the next setup or assertion step for this scenario.
          encoding: "utf8",
          // Runner option controlling stability or isolation of the suite.
          timeout: 10000,
          // Configure env for the request/server under test.
          env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
        },
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(child.status, 0, child.stderr);
      // Assert the observed value matches the intended post-condition.
      assert.match(
        // Execute the next setup or assertion step for this scenario.
        child.stdout,
        // Session/CSRF step exercising auth lifecycle.
        new RegExp(`PERSISTED ${value.overdueSessionMinutes}`),
      );
    // Await async work before asserting or releasing locks.
    } finally { await updateSetting({ key: "operations", value: operations, actorEmployeeId: world.owner.employeeId, reason: "restore" }); }
  });
  // Case: changing default SLA changes new ticket only; existing deadline stays fixed.
  it("changing default SLA changes new ticket only; existing deadline stays fixed", async () => {
    // policy: synchronize actors so the race window is observable.
    const policy = await prisma.slaPolicy.findUnique({ where: { priority: "normal" } });
    // category: unique stamp so parallel runs do not collide.
    const category = await createCategory({ key: `c_${randomUUID().replaceAll("-", "").slice(0, 20)}`, nameBg: "Категория", nameEn: "Category" }); categoryIds.push(category.id);
    // Bind now for later setup or assertions in this scope.
    const now = new Date("2026-01-01T10:00:00Z");
    // Try path where partial failure must not leak suite state.
    try {
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (policy) await prisma.slaPolicy.update({ where: { id: policy.id }, data: { isActive: false } });
      // Await async work before asserting or releasing locks.
      await updateSetting({ key: "operations", value: { ...operations, defaultTicketSlaHours: 4 }, actorEmployeeId: world.owner.employeeId });
      // a: seeded entity required before the mutation under test.
      const a = await createMaintenanceTicket({ locationId: world.locationAId, categoryId: category.id, title: "before", blocksRoom: false, reportedByEmployeeId: world.owner.employeeId, now });
      // Await async work before asserting or releasing locks.
      await updateSetting({ key: "operations", value: { ...operations, defaultTicketSlaHours: 9 }, actorEmployeeId: world.owner.employeeId });
      // b: seeded entity required before the mutation under test.
      const b = await createMaintenanceTicket({ locationId: world.locationAId, categoryId: category.id, title: "after", blocksRoom: false, reportedByEmployeeId: world.owner.employeeId, now });
      // Assert the observed value matches the intended post-condition.
      assert.equal(new Date(a.ticket.dueAt!).getTime(), now.getTime() + 4 * 3600000);
      // Assert the observed value matches the intended post-condition.
      assert.equal(new Date(b.ticket.dueAt!).getTime(), now.getTime() + 9 * 3600000);
      // Assert the observed value matches the intended post-condition.
      assert.equal((await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: a.ticket.id } })).dueAt!.getTime(), now.getTime() + 4 * 3600000);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (policy) await prisma.slaPolicy.update({ where: { id: policy.id }, data: policy });
      // Await async work before asserting or releasing locks.
      await updateSetting({ key: "operations", value: operations, actorEmployeeId: world.owner.employeeId });
    }
  });
  // Case checks authz/session policy: permission history records exact add/revoke actor/reason and identical save is a no-op.
  it("permission history records exact add/revoke actor/reason and identical save is a no-op", async () => {
    // snapshot: synchronize actors so the race window is observable.
    const snapshot = await snapshotRoleGrants(prisma, ["housekeeper"]);
    // Bind baseline for later setup or assertions in this scope.
    const baseline = { panels: snapshot.filter(r => r.kind === "panel").map(r => r.key), actions: snapshot.filter(r => r.kind === "action").map(r => r.key) };
    // Bind remove for later setup or assertions in this scope.
    const remove = baseline.actions.find(k => k !== "tickets.report")!;
    // next: unique stamp so parallel runs do not collide.
    const next = { panels: baseline.panels, actions: baseline.actions.filter(k => k !== remove).concat(baseline.actions.includes("audit.view") ? [] : ["audit.view"]), reason: randomUUID() };
    // Try path where partial failure must not leak suite state.
    try {
      // Assert HTTP status matches the contract for this path.
      assert.equal((await putRoleGrantsJson(api, token, "housekeeper", next)).status, 200);
      // history: synchronize actors so the race window is observable.
      const history = await prisma.auditEvent.findMany({ where: { reason: next.reason } });
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(history.map(h => [h.action, h.entityId]).sort(), [["permission.grant", "housekeeper:action:audit.view"], ["permission.revoke", `housekeeper:action:${remove}`]].sort());
      // Assert the observed value matches the intended post-condition.
      assert.ok(history.every(h => h.actorEmployeeId === world.owner.employeeId));
      // Assert HTTP status matches the contract for this path.
      assert.equal((await putRoleGrantsJson(api, token, "housekeeper", next)).status, 200);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await prisma.auditEvent.findMany({ where: { reason: next.reason } }), history);
    // Await async work before asserting or releasing locks.
    } finally { await restoreRoleGrants(prisma, ["housekeeper"], snapshot); }
  });
  // Case: all audit filters intersect without broadening location/actor/time/entity.
  it("all audit filters intersect without broadening location/actor/time/entity", async () => {
    // entity: unique stamp so parallel runs do not collide.
    const entity = randomUUID(); const action = `scenario.${randomUUID()}`;
    // Bind template for later setup or assertions in this scope.
    const template = { action, entityType: "scenario", entityId: entity, actorEmployeeId: world.owner.employeeId, locationId: world.locationAId, occurredAt: new Date("2026-01-10T12:00:00Z") };
    // wanted: seeded entity required before the mutation under test.
    const wanted = await prisma.auditEvent.create({ data: template });
    // Iterate to cover variants or wait until a condition holds.
    for (const patch of [{ actorEmployeeId: world.hk1.employeeId }, { locationId: world.locationBId }, { entityId: "other" }, { action: "other" }, { occurredAt: new Date("2025-12-31") }]) await prisma.auditEvent.create({ data: { ...template, ...patch } });
    // Bind q for later setup or assertions in this scope.
    const q = new URLSearchParams({ action, entityType: "scenario", entityId: entity, actorEmployeeId: world.owner.employeeId, locationId: world.locationAId, from: "2026-01-10T00:00:00.000Z", to: "2026-01-10T23:59:59.999Z" });
    // res: HTTP response captured for status/body checks.
    const res = await getJson(api, token, `/audit?${q}`); assert.equal(res.status, 200); assert.deepEqual((res.body as any[]).map(r => r.id), [wanted.id]);
  });
  // Case: invalid floor and duplicate number create/update leave room and audit unchanged.
  it("invalid floor and duplicate number create/update leave room and audit unchanged", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } });
    // other: synchronize actors so the race window is observable.
    const other = await prisma.location.findUniqueOrThrow({ where: { id: world.locationBId } });
    // audits: synchronize actors so the race window is observable.
    const audits = await prisma.auditEvent.findMany({ where: { locationId: world.locationAId } });
    // Iterate to cover variants or wait until a condition holds.
    for (const [body, code] of [[{ floorId: "unknown", number: "new" }, 404], [{ floorId: world.floorId, number: other.number }, 409]] as const) {
      // Assert HTTP status matches the contract for this path.
      assert.equal((await postJson(api, token, "/locations", body)).status, code);
      // Assert HTTP status matches the contract for this path.
      assert.equal((await patchJson(api, token, `/locations/${world.locationAId}`, body)).status, code);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } }), before);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await prisma.auditEvent.findMany({ where: { locationId: world.locationAId } }), audits);
    }
  });
  // Case: archive/restore retains occupancy, cleaning, service, cycle and old history.
  it("archive/restore retains occupancy, cleaning, service, cycle and old history", async () => {
    // Await async work before asserting or releasing locks.
    await prisma.location.update({ where: { id: world.locationBId }, data: { occupancy: "occupied", cleaningStatus: "dirty", serviceStatus: "out_of_service", cleaningCycle: 7 } });
    // before: synchronize actors so the race window is observable.
    const before = await prisma.location.findUniqueOrThrow({ where: { id: world.locationBId } });
    // old: seeded entity required before the mutation under test.
    const old = await prisma.auditEvent.create({ data: { entityType: "location", entityId: world.locationBId, locationId: world.locationBId, action: "scenario.old", after: { value: "old" } } });
    // Assert HTTP status matches the contract for this path.
    assert.equal((await postJson(api, token, `/locations/${world.locationBId}/archive`, {})).status, 200);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await postJson(api, token, `/locations/${world.locationBId}/restore`, {})).status, 200);
    // after: synchronize actors so the race window is observable.
    const after = await prisma.location.findUniqueOrThrow({ where: { id: world.locationBId } });
    // Assert the observed value matches the intended post-condition.
    for (const key of ["occupancy", "cleaningStatus", "serviceStatus", "cleaningCycle", "catalogStatus"] as const) assert.equal(after[key], before[key]);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await prisma.auditEvent.findUniqueOrThrow({ where: { id: old.id } }), old);
  });
  // Case probes concurrency/isolation: category snapshot and preset defaults retain explicit blocksRoom.
  it("category snapshot and preset defaults retain explicit blocksRoom", async () => {
    // category: unique stamp so parallel runs do not collide.
    const category = await createCategory({ key: `c_${randomUUID().replaceAll("-", "").slice(0, 20)}`, nameBg: "Стара категория", nameEn: "Old Category" }); categoryIds.push(category.id);
    // option: seeded entity required before the mutation under test.
    const option = await createIssueOption({ maintenanceCategoryId: category.id, kind: "maintenance", nameBg: "Предварително описание", nameEn: "Preset", defaultPriority: "urgent", defaultBlocksRoom: true });
    // res: unique stamp so parallel runs do not collide.
    const res = await postJson(api, token, "/maintenance/tickets", { locationId: world.locationAId, issueOptionId: option.id, blocksRoom: false, commandId: randomUUID() }); assert.equal(res.status, 201);
    // Bind ticket for later setup or assertions in this scope.
    const ticket = (res.body as any).ticket ?? res.body;
    // Assert the observed value matches the intended post-condition.
    assert.equal(ticket.title, "Предварително описание"); assert.equal(ticket.priority, "urgent"); assert.equal(ticket.blocksRoom, false);
    // before: synchronize actors so the race window is observable.
    const before = await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    // Await async work before asserting or releasing locks.
    await updateCategory(category.id, { nameBg: "Нова категория", nameEn: "New Category" }); await archiveCategory(category.id);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticket.id } }), before);
    // Assert the observed value matches the intended post-condition.
    assert.equal(before.categoryLabelBg, "Стара категория");
  });
  // Case: option reorder is atomic for unknown, duplicate and late database errors.
  it("option reorder is atomic for unknown, duplicate and late database errors", async () => {
    // category: unique stamp so parallel runs do not collide.
    const category = await createCategory({ key: `c_${randomUUID().replaceAll("-", "").slice(0, 20)}`, nameBg: "Подредба", nameEn: "Order" }); categoryIds.push(category.id);
    // Execute the next setup or assertion step for this scenario.
    const ids: string[] = [];
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < 3; i++) ids.push((await createIssueOption({ maintenanceCategoryId: category.id, kind: "maintenance", nameBg: `Опция ${i}`, nameEn: `Option ${i}`, sortOrder: i })).id);
    // Bind read for later setup or assertions in this scope.
    const read = () => prisma.issueOption.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
    // Await async work before asserting or releasing locks.
    await reorderIssueOptions([...ids].reverse()); const before = await read();
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(ids.map(id => before.find(r => r.id === id)!.sortOrder), [2, 1, 0]);
    // Iterate to cover variants or wait until a condition holds.
    for (const invalid of [[ids[0]!, "unknown"], [ids[0]!, ids[0]!]]) { await assert.rejects(reorderIssueOptions(invalid), /Unknown/); assert.deepEqual(await read(), before); }
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION scenario_order_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${ids[1]}' AND EXISTS (SELECT 1 FROM "IssueOption" WHERE id = '${ids[0]}' AND "sortOrder" = 0) THEN RAISE EXCEPTION 'scenario_order_after_first_write'; END IF; RETURN NEW; END $$`);
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe('CREATE TRIGGER scenario_order_fail BEFORE UPDATE ON "IssueOption" FOR EACH ROW EXECUTE FUNCTION scenario_order_fail()');
    // Try path where partial failure must not leak suite state.
    try { await assert.rejects(reorderIssueOptions(ids), /scenario_order_after_first_write/); assert.deepEqual(await read(), before); }
    // Always run cleanup to preserve DB/server isolation across cases.
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER scenario_order_fail ON "IssueOption"'); await prisma.$executeRawUnsafe('DROP FUNCTION scenario_order_fail()'); }
  });
  // Case: overnight shift persists and invalid hours leave catalog unchanged.
  it("overnight shift persists and invalid hours leave catalog unchanged", async () => {
    // body: unique stamp so parallel runs do not collide.
    const body = { code: `S${randomUUID().slice(0, 7)}`, nameBg: "Нощна", nameEn: "Night", startTime: "22:00", endTime: "06:00" };
    // good: HTTP response captured for status/body checks.
    const good = await postJson(api, token, "/shifts", body); assert.equal(good.status, 201); shiftIds.push((good.body as any).id);
    // Assert the observed value matches the intended post-condition.
    assert.equal((await prisma.shift.findUniqueOrThrow({ where: { id: (good.body as any).id } })).endTime, "06:00");
    // count: synchronize actors so the race window is observable.
    const count = await prisma.shift.count();
    // Assert HTTP status matches the contract for this path.
    for (const invalid of ["24:00", "12:60", "9:30", "invalid"]) assert.equal((await postJson(api, token, "/shifts", { ...body, code: randomUUID(), endTime: invalid })).status, 400);
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.shift.count(), count);
  });
  // Case: impossible task and roster dates reject without rollover or partial writes.
  it("impossible task and roster dates reject without rollover or partial writes", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await prisma.cleaningTask.count({ where: { locationId: world.locationAId } });
    // rosters: synchronize actors so the race window is observable.
    const rosters = await prisma.employeeShiftRoster.findMany({ where: { employeeId: world.hk1.employeeId } });
    // Iterate to cover variants or wait until a condition holds.
    for (const hotelDate of ["2025-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10"]) {
      // Assert HTTP status matches the contract for this path.
      assert.equal((await postJson(api, token, "/cleaning/tasks", { locationId: world.locationAId, hotelDate })).status, 400, `task ${hotelDate}`);
    }
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.cleaningTask.count({ where: { locationId: world.locationAId } }), before);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await prisma.employeeShiftRoster.findMany({ where: { employeeId: world.hk1.employeeId } }), rosters);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await postJson(api, token, "/cleaning/tasks", { locationId: world.locationAId, hotelDate: "2028-02-29" })).status, 201);
  });
  // Case: roster rejects impossible date without deleting other hotel days.
  it("roster rejects impossible date without deleting other hotel days", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await prisma.employeeShiftRoster.findMany({ where: { employeeId: world.hk1.employeeId } });
    // Assert HTTP status matches the contract for this path.
    assert.equal((await putJson(api, token, "/shifts/roster", { hotelDate: "2026-02-30", entries: [{ employeeId: world.hk1.employeeId, shiftId: shiftIds[0] }] })).status, 400);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await prisma.employeeShiftRoster.findMany({ where: { employeeId: world.hk1.employeeId } }), before);
  });
  // Case: deleting plan row retains created task and applied room effects.
  it("deleting plan row retains created task and applied room effects", async () => {
    // Await async work before asserting or releasing locks.
    await prisma.location.update({ where: { id: world.locationAId }, data: { occupancy: "vacant", cleaningStatus: "dirty" } });
    // created: seeded entity required before the mutation under test.
    const created = await createDailyPlanEntry({ hotelDate: await todayHotelDateYmd(), locationId: world.locationAId, category: "arrival", assignedEmployeeId: world.hk1.employeeId, createdByEmployeeId: world.owner.employeeId });
    // entry: seeded entity required before the mutation under test.
    const entry = await prisma.dailyPlanEntry.findUniqueOrThrow({ where: { id: created.entry.id } }); assert.ok(entry.cleaningTaskId);
    // task: synchronize actors so the race window is observable.
    const task = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: entry.cleaningTaskId! } });
    // location: synchronize actors so the race window is observable.
    const location = await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } });
    // Assert HTTP status matches the contract for this path.
    assert.equal((await requestJson(api, token, "DELETE", `/daily-plan/${entry.id}`)).status, 200);
    // Assert the observed value matches the intended post-condition.
    assert.equal(await prisma.dailyPlanEntry.findUnique({ where: { id: entry.id } }), null);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } }), task);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } }), location);
  });
  // Case: malformed import envelopes are HTTP validation errors, with no new batches.
  it("malformed import envelopes are HTTP validation errors, with no new batches", async () => {
    // before: seeded entity required before the mutation under test.
    const before = await prisma.dailyPlanImportBatch.count({ where: { createdByEmployeeId: world.owner.employeeId } });
    // Assert HTTP status matches the contract for this path.
    for (const body of [{ hotelDate: "2026-10-19" }, { hotelDate: "2026-10-19", entries: {} }, [], null, "invalid"]) assert.equal((await postJson(api, token, "/daily-plan/import", body)).status, 400);
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.dailyPlanImportBatch.count({ where: { createdByEmployeeId: world.owner.employeeId } }), before);
  });
});
