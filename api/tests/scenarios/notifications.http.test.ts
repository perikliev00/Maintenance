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
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, getJson, listenApp, loginBearer, postJson } from "../httpHarness";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createScopeSmokeFixture, cleanupScopeSmokeFixture, type ScopeSmokeFixture } from "../fixtures";
// Import bindings from ../../src/services/notifications.
import { createNotifications, recipientsForLocationOps } from "../../src/services/notifications";
// Import bindings from ../../src/services/settings.
import { getSetting, updateSetting } from "../../src/services/settings";
// Shared test fixtures for seeding users, locations, and domain entities.
import { waitForBackendsBlockedByHolderChain } from "../attendance/fixtures";
// Import bindings from ../../src/services/cleaning.
import { createCleaningTask, inspectCleaningTask } from "../../src/services/cleaning";
// Import bindings from ../../src/services/maintenance.
import { closeMaintenanceTicket, reopenMaintenanceTicket, resolveMaintenanceTicket } from "../../src/services/maintenance";

// Execute the next setup or assertion step for this scenario.
let fx: ScopeSmokeFixture;
// Execute the next setup or assertion step for this scenario.
let api: string;
// Execute the next setup or assertion step for this scenario.
let server: Awaited<ReturnType<typeof listenApp>>["server"];
// Execute the next setup or assertion step for this scenario.
let tokenA: string;
// Execute the next setup or assertion step for this scenario.
let tokenB: string;
// tag: unique stamp so parallel runs do not collide.
const tag = randomUUID();
// Delivery/replay step for async notification paths.
let original: Awaited<ReturnType<typeof getSetting<"notifications">>>;
// Bind notification for later setup or assertions in this scope.
const notification = (recipient: string, key: string) => ({ type: "scenario", title: "Българско известие", body: "Подробности", entityType: "scenario", entityId: tag, recipientEmployeeIds: [recipient], dedupeKey: `${tag}-${key}` });
// Local helper clearInbox used by cases in this file.
async function clearInbox() { await prisma.notification.deleteMany({ where: { recipientEmployeeId: { in: [fx.housekeeper.employeeId, fx.otherHk.employeeId] } } }); }

// Suite: P1 notifications / P2 inbox.
describe("P1 notifications / P2 inbox", () => {
  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma); process.env.E2E_DISABLE_RATE_LIMIT = "1";
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    fx = await createScopeSmokeFixture(prisma); original = await getSetting("notifications");
    // Await async work before asserting or releasing locks.
    await updateSetting({ key: "notifications", value: { ...original, in_app: { ...original.in_app, enabled: true } }, actorEmployeeId: fx.manager.employeeId, reason: "scenario baseline" });
    // Start or stop the in-process API server for this suite.
    ({ api, server } = await listenApp());
    // Await async work before asserting or releasing locks.
    tokenA = (await loginBearer(api, fx.housekeeper.email, fx.password)).token;
    // Await async work before asserting or releasing locks.
    tokenB = (await loginBearer(api, fx.otherHk.email, fx.password)).token;
  });
  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (fx) {
      // Await async work before asserting or releasing locks.
      await updateSetting({ key: "notifications", value: original, actorEmployeeId: fx.manager.employeeId, reason: "scenario restore" });
      // Await async work before asserting or releasing locks.
      await prisma.notification.deleteMany({ where: { OR: [{ entityId: tag }, { locationId: { in: [fx.locAId, fx.locBId] } }] } });
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.deleteMany({ where: { actorEmployeeId: fx.manager.employeeId } });
      // Await async work before asserting or releasing locks.
      await prisma.ticketEvent.deleteMany({ where: { ticketId: { in: [fx.ticketAId, fx.ticketBId] } } });
      // Await async work before asserting or releasing locks.
      await prisma.ticketReopenEvent.deleteMany({ where: { ticketId: { in: [fx.ticketAId, fx.ticketBId] } } });
      // Await async work before asserting or releasing locks.
      await prisma.inspection.deleteMany({ where: { taskId: { in: [fx.taskAId, fx.taskBId] } } });
      // Await async work before asserting or releasing locks.
      await prisma.cleaningTask.deleteMany({ where: { locationId: fx.locAId, id: { notIn: [fx.taskAId, fx.taskOtherHkId] } } });
      // Await async work before asserting or releasing locks.
      await cleanupScopeSmokeFixture(prisma, fx);
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });
  // Case: location recipients contain local supervisor and exclude foreign supervisor.
  it("location recipients contain local supervisor and exclude foreign supervisor", async () => {
    // recipients: synchronize actors so the race window is observable.
    const recipients = await recipientsForLocationOps(fx.locAId, "tickets.assign");
    // Bind ids for later setup or assertions in this scope.
    const ids = [fx.supervisorA.employeeId, fx.supervisorB.employeeId, fx.supervisorEmpty.employeeId, fx.manager.employeeId, fx.housekeeper.employeeId, fx.otherHk.employeeId];
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(recipients.filter(id => ids.includes(id)).sort(), [fx.supervisorA.employeeId, fx.manager.employeeId].sort());
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await createNotifications({ ...notification(fx.supervisorA.employeeId, "scope"), locationId: fx.locAId, recipientEmployeeIds: recipients });
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.notification.count({ where: { dedupeKey: `${tag}-scope`, recipientEmployeeId: fx.supervisorB.employeeId } }), 0);
  });
  // Case: real task assignment targets the assignee with matching task and location.
  it("real task assignment targets the assignee with matching task and location", async () => {
    // task: seeded entity required before the mutation under test.
    const task = await createCleaningTask({ locationId: fx.locAId, hotelDate: "2099-06-20", assignedEmployeeId: fx.housekeeper.employeeId, actorEmployeeId: fx.manager.employeeId });
    // rows: synchronize actors so the race window is observable.
    const rows = await prisma.notification.findMany({ where: { entityId: task.id } });
    // Assert collection size matches the expected post-condition.
    assert.equal(rows.length, 1); assert.equal(rows[0]!.type, "cleaning.assigned"); assert.equal(rows[0]!.recipientEmployeeId, fx.housekeeper.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(rows[0]!.locationId, fx.locAId); assert.equal((rows[0]!.payload as any).taskId, task.id);
  });
  // Case: inspection outcome reaches only current assignee and retry does not duplicate.
  it("inspection outcome reaches only current assignee and retry does not duplicate", async () => {
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.update({ where: { id: fx.taskAId }, data: { status: "awaiting_inspection" } });
    // input: unique stamp so parallel runs do not collide.
    const input = { taskId: fx.taskAId, inspectorEmployeeId: fx.supervisorA.employeeId, commandId: randomUUID(), result: "rejected" as const, findings: "Rework proof" };
    // Await async work before asserting or releasing locks.
    await inspectCleaningTask(input); await inspectCleaningTask(input);
    // rows: synchronize actors so the race window is observable.
    const rows = await prisma.notification.findMany({ where: { entityId: fx.taskAId, type: "cleaning.inspected" } });
    // Assert collection size matches the expected post-condition.
    assert.equal(rows.length, 1); assert.equal(rows[0]!.recipientEmployeeId, fx.housekeeper.employeeId); assert.equal(rows[0]!.locationId, fx.locAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal((rows[0]!.payload as any).taskId, fx.taskAId); assert.match(rows[0]!.body, /rejected/);
  });
  // Case: resolution reaches exact reporter and assignee, excludes unrelated employee and dedupes retry.
  it("resolution reaches exact reporter and assignee, excludes unrelated employee and dedupes retry", async () => {
    // Await async work before asserting or releasing locks.
    await prisma.maintenanceTicket.update({ where: { id: fx.ticketAId }, data: { status: "in_progress", assigneeId: fx.housekeeper.employeeId, reportedByEmployeeId: fx.otherHk.employeeId } });
    // input: unique stamp so parallel runs do not collide.
    const input = { ticketId: fx.ticketAId, resolvedByEmployeeId: fx.manager.employeeId, bypassAssigneeCheck: true, commandId: randomUUID(), resolutionNotes: "Resolved proof" };
    // Await async work before asserting or releasing locks.
    await resolveMaintenanceTicket(input); await resolveMaintenanceTicket(input);
    // rows: synchronize actors so the race window is observable.
    const rows = await prisma.notification.findMany({ where: { entityId: fx.ticketAId, type: "ticket.resolved" } });
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(rows.map(r => r.recipientEmployeeId).sort(), [fx.housekeeper.employeeId, fx.otherHk.employeeId].sort());
    // Assert the observed value matches the intended post-condition.
    assert.ok(rows.every(r => r.locationId === fx.locAId && (r.payload as any).ticketId === fx.ticketAId));
  });
  // Case: resolve/close notify each lifecycle event, while command retries stay deduplicated.
  it("resolve/close notify each lifecycle event, while command retries stay deduplicated", async () => {
    // Await async work before asserting or releasing locks.
    await prisma.maintenanceTicket.update({ where: { id: fx.ticketBId }, data: { status: "in_progress", assigneeId: fx.housekeeper.employeeId, reportedByEmployeeId: fx.otherHk.employeeId } });
    // Iterate to cover variants or wait until a condition holds.
    for (let cycle = 1; cycle <= 3; cycle++) {
      // resolve: unique stamp so parallel runs do not collide.
      const resolve = { ticketId: fx.ticketBId, resolvedByEmployeeId: fx.manager.employeeId, bypassAssigneeCheck: true, commandId: cycle < 3 ? randomUUID() : undefined };
      // close: unique stamp so parallel runs do not collide.
      const close = { ticketId: fx.ticketBId, closedByEmployeeId: fx.manager.employeeId, commandId: cycle < 3 ? randomUUID() : undefined };
      // Await async work before asserting or releasing locks.
      await resolveMaintenanceTicket(resolve);
      // Await async work before asserting or releasing locks.
      await closeMaintenanceTicket(close);
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (cycle < 3) {
        // Await async work before asserting or releasing locks.
        await resolveMaintenanceTicket(resolve);
        // Await async work before asserting or releasing locks.
        await closeMaintenanceTicket(close);
      }
      // Iterate to cover variants or wait until a condition holds.
      for (const type of ["ticket.resolved", "ticket.closed"]) {
        // rows: synchronize actors so the race window is observable.
        const rows = await prisma.notification.findMany({ where: { entityId: fx.ticketBId, type } });
        // Assert collection size matches the expected post-condition.
        assert.equal(rows.length, 2 * cycle);
        // Assert collection size matches the expected post-condition.
        for (const recipient of [fx.housekeeper.employeeId, fx.otherHk.employeeId]) assert.equal(rows.filter(r => r.recipientEmployeeId === recipient).length, cycle);
        // Assert the observed value matches the intended post-condition.
        assert.ok(rows.every(r => r.recipientEmployeeId !== fx.manager.employeeId));
        // Assert the observed value matches the intended post-condition.
        assert.equal(new Set(rows.map(r => r.dedupeKey)).size, cycle);
      }
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (cycle < 3) await reopenMaintenanceTicket({ ticketId: fx.ticketBId, reopenedByEmployeeId: fx.manager.employeeId, commandId: randomUUID() });
    }
  });
  // Case probes concurrency/isolation: overlapping creates blocked on real recipient row dedupe each recipient and exclude actor.
  it("overlapping creates blocked on real recipient row dedupe each recipient and exclude actor", async () => {
    // Await async work before asserting or releasing locks.
    await clearInbox();
    // Execute the next setup or assertion step for this scenario.
    let release!: () => void; let held!: (pid: number) => void;
    // Bind gate for later setup or assertions in this scope.
    const gate = new Promise<void>(r => { release = r; }); const ready = new Promise<number>(r => { held = r; });
    // Bind holder for later setup or assertions in this scope.
    const holder = prisma.$transaction(async tx => {
      // Await async work before asserting or releasing locks.
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${fx.housekeeper.employeeId} FOR UPDATE`;
      // Await async work before asserting or releasing locks.
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; held(pid!); await gate;
    // Runner option controlling stability or isolation of the suite.
    }, { timeout: 20000 });
    // pid: unique stamp so parallel runs do not collide.
    const pid = await ready;
    // Bind input for later setup or assertions in this scope.
    const input = { ...notification(fx.housekeeper.employeeId, "dedupe"), actorEmployeeId: fx.manager.employeeId, recipientEmployeeIds: [fx.housekeeper.employeeId, fx.housekeeper.employeeId, fx.otherHk.employeeId, fx.manager.employeeId] };
    // Bind operations for later setup or assertions in this scope.
    const operations = [createNotifications(input), createNotifications(input)];
    // Try path where partial failure must not leak suite state.
    try { await waitForBackendsBlockedByHolderChain(prisma, pid, 2, 12000); } finally { release(); }
    // Run actors together to expose races and serialization bugs.
    await holder; const results = await Promise.all(operations);
    // Assert the observed value matches the intended post-condition.
    assert.equal(results.reduce((n, r) => n + r.created, 0), 2);
    // rows: HTTP response captured for status/body checks.
    const rows = await prisma.notification.findMany({ where: { dedupeKey: input.dedupeKey }, include: { deliveries: true } });
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(rows.map(r => r.recipientEmployeeId).sort(), [fx.housekeeper.employeeId, fx.otherHk.employeeId].sort());
    // Assert collection size matches the expected post-condition.
    assert.ok(rows.every(r => r.deliveries.length === 3));
    // Assert the observed value matches the intended post-condition.
    assert.equal((await createNotifications(input)).created, 0);
  });
  // Case: real HTTP read/dismiss/read-all only change caller inbox and exact unread count.
  it("real HTTP read/dismiss/read-all only change caller inbox and exact unread count", async () => {
    // Await async work before asserting or releasing locks.
    await clearInbox();
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < 3; i++) await createNotifications(notification(fx.housekeeper.employeeId, `read-a-${i}`));
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await createNotifications(notification(fx.otherHk.employeeId, "read-b"));
    // a: synchronize actors so the race window is observable.
    const a = await prisma.notification.findMany({ where: { recipientEmployeeId: fx.housekeeper.employeeId }, orderBy: { id: "asc" } });
    // b: synchronize actors so the race window is observable.
    const b = await prisma.notification.findFirstOrThrow({ where: { recipientEmployeeId: fx.otherHk.employeeId } });
    // count: HTTP response captured for status/body checks.
    const count = async (token: string) => (await getJson(api, token, "/notifications/unread-count")).body as { count: number };
    // Assert collection size matches the expected post-condition.
    assert.equal((await count(tokenA)).count, 3);
    // Assert HTTP status matches the contract for this path.
    for (const verb of ["read", "dismiss"]) assert.equal((await postJson(api, tokenA, `/notifications/${b.id}/${verb}`, {})).status, 404);
    // listing: HTTP response captured for status/body checks.
    const listing = (await getJson(api, tokenA, "/notifications")).body as any;
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(new Set(listing.items.map((r: any) => r.id)), new Set(a.map(r => r.id)));
    // Assert HTTP status matches the contract for this path.
    for (let i = 0; i < 2; i++) assert.equal((await postJson(api, tokenA, `/notifications/${a[0]!.id}/read`, {})).status, 200);
    // Assert collection size matches the expected post-condition.
    assert.equal((await count(tokenA)).count, 2);
    // Assert HTTP status matches the contract for this path.
    for (let i = 0; i < 2; i++) assert.equal((await postJson(api, tokenA, `/notifications/${a[1]!.id}/dismiss`, {})).status, 200);
    // Assert collection size matches the expected post-condition.
    assert.equal((await count(tokenA)).count, 1);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual((await postJson(api, tokenA, "/notifications/read-all", {})).body, { updated: 1 });
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual((await postJson(api, tokenA, "/notifications/read-all", {})).body, { updated: 0 });
    // Assert collection size matches the expected post-condition.
    assert.equal((await count(tokenA)).count, 0); assert.equal((await count(tokenB)).count, 1);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await prisma.notification.findUniqueOrThrow({ where: { id: b.id } }), b);
  });
  // Case: createdAt/id cursor pagination visits independent IDs and timestamp ties exactly once with filters.
  it("createdAt/id cursor pagination visits independent IDs and timestamp ties exactly once with filters", async () => {
    // Await async work before asserting or releasing locks.
    await clearInbox();
    // Bind ids for later setup or assertions in this scope.
    const ids = ["z", "a", "y", "b", "x", "c", "w"].map(s => `${tag}-${s}`);
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < ids.length; i++) await prisma.notification.create({ data: { id: ids[i], recipientEmployeeId: fx.housekeeper.employeeId, type: "scenario", title: "test", body: "test", entityType: "scenario", entityId: tag, dedupeKey: ids[i]!, createdAt: new Date(`2026-10-${String(19 - Math.floor(i / 2)).padStart(2, "0")}T10:00:00Z`), ...(i === 5 ? { readAt: new Date() } : {}), ...(i === 6 ? { dismissedAt: new Date() } : {}) } });
    // Iterate to cover variants or wait until a condition holds.
    for (const [filter, expected] of [["", ids.slice(0, 6)], ["&unread=1", ids.slice(0, 5)], ["&includeDismissed=1", ids]] as const) {
      // Pagination step for list/contract coverage.
      const seen: string[] = []; let cursor: string | null = null;
      // Execute the next setup or assertion step for this scenario.
      do {
        // res: HTTP response captured for status/body checks.
        const res = await getJson(api, tokenA, `/notifications?limit=2${filter}${cursor ? `&cursor=${cursor}` : ""}`);
        // Assert HTTP status matches the contract for this path.
        assert.equal(res.status, 200); const body = res.body as any;
        // Pagination step for list/contract coverage.
        seen.push(...body.items.map((r: any) => r.id)); cursor = body.nextCursor;
        // Assert collection size matches the expected post-condition.
        assert.ok(seen.length <= 10, "cursor must terminate");
      // Pagination step for list/contract coverage.
      } while (cursor);
      // Assert collection size matches the expected post-condition.
      assert.equal(new Set(seen).size, seen.length);
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.deepEqual(new Set(seen), new Set(expected));
    }
  });
  // Case: disabled inbox keeps existing rows and main action; adapters never claim delivery.
  it("disabled inbox keeps existing rows and main action; adapters never claim delivery", async () => {
    // Await async work before asserting or releasing locks.
    await clearInbox();
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await createNotifications(notification(fx.housekeeper.employeeId, "preserve"));
    // existing: synchronize actors so the race window is observable.
    const existing = await prisma.notification.findMany({ where: { recipientEmployeeId: fx.housekeeper.employeeId } });
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await updateSetting({ key: "notifications", value: { ...original, in_app: { ...original.in_app, enabled: false } }, actorEmployeeId: fx.manager.employeeId, reason: "disable" });
      // task: seeded entity required before the mutation under test.
      const task = await createCleaningTask({ locationId: fx.locAId, hotelDate: "2099-06-21", assignedEmployeeId: fx.housekeeper.employeeId, actorEmployeeId: fx.manager.employeeId });
      // Assert HTTP status matches the contract for this path.
      assert.equal(task.status, "assigned");
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await prisma.notification.findMany({ where: { recipientEmployeeId: fx.housekeeper.employeeId } }), existing);
      // Await async work before asserting or releasing locks.
      await updateSetting({ key: "notifications", value: { ...original, in_app: { ...original.in_app, enabled: true }, email: { ...original.email, enabled: true }, device_push: { ...original.device_push, enabled: true } }, actorEmployeeId: fx.manager.employeeId, reason: "adapter contract" });
      // Assert the observed value matches the intended post-condition.
      assert.equal((await getSetting("notifications")).device_push.enabled, false);
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await createNotifications(notification(fx.housekeeper.employeeId, "adapters"));
      // row: synchronize actors so the race window is observable.
      const row = await prisma.notification.findFirstOrThrow({ where: { dedupeKey: `${tag}-adapters` }, include: { deliveries: true } });
      // Iterate to cover variants or wait until a condition holds.
      for (const channel of ["email", "device_push"]) {
        // Bind delivery for later setup or assertions in this scope.
        const delivery = row.deliveries.find(d => d.channel === channel)!;
        // Assert HTTP status matches the contract for this path.
        assert.equal(delivery.status, "not_configured"); assert.equal(delivery.deliveredAt, null);
      }
    // Await async work before asserting or releasing locks.
    } finally { await updateSetting({ key: "notifications", value: { ...original, in_app: { ...original.in_app, enabled: true } }, actorEmployeeId: fx.manager.employeeId, reason: "restore" }); }
  });
});
