import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/db";
import { assertTestDatabase } from "../assertTestDatabase";
import { closeServer, getJson, listenApp, loginBearer, postJson } from "../httpHarness";
import { createScopeSmokeFixture, cleanupScopeSmokeFixture, type ScopeSmokeFixture } from "../fixtures";
import { createNotifications, recipientsForLocationOps } from "../../src/services/notifications";
import { getSetting, updateSetting } from "../../src/services/settings";
import { waitForBackendsBlockedByHolderChain } from "../attendance/fixtures";
import { createCleaningTask, inspectCleaningTask } from "../../src/services/cleaning";
import { resolveMaintenanceTicket } from "../../src/services/maintenance";

let fx: ScopeSmokeFixture;
let api: string;
let server: Awaited<ReturnType<typeof listenApp>>["server"];
let tokenA: string;
let tokenB: string;
const tag = randomUUID();
let original: Awaited<ReturnType<typeof getSetting<"notifications">>>;
const notification = (recipient: string, key: string) => ({ type: "scenario", title: "Българско известие", body: "Подробности", entityType: "scenario", entityId: tag, recipientEmployeeIds: [recipient], dedupeKey: `${tag}-${key}` });
async function clearInbox() { await prisma.notification.deleteMany({ where: { recipientEmployeeId: { in: [fx.housekeeper.employeeId, fx.otherHk.employeeId] } } }); }

describe("P1 notifications / P2 inbox", () => {
  before(async () => {
    await assertTestDatabase(prisma); process.env.E2E_DISABLE_RATE_LIMIT = "1";
    fx = await createScopeSmokeFixture(prisma); original = await getSetting("notifications");
    await updateSetting({ key: "notifications", value: { ...original, in_app: { ...original.in_app, enabled: true } }, actorEmployeeId: fx.manager.employeeId, reason: "scenario baseline" });
    ({ api, server } = await listenApp());
    tokenA = (await loginBearer(api, fx.housekeeper.email, fx.password)).token;
    tokenB = (await loginBearer(api, fx.otherHk.email, fx.password)).token;
  });
  after(async () => {
    if (server) await closeServer(server);
    if (fx) {
      await updateSetting({ key: "notifications", value: original, actorEmployeeId: fx.manager.employeeId, reason: "scenario restore" });
      await prisma.notification.deleteMany({ where: { OR: [{ entityId: tag }, { locationId: { in: [fx.locAId, fx.locBId] } }] } });
      await prisma.auditEvent.deleteMany({ where: { actorEmployeeId: fx.manager.employeeId } });
      await prisma.ticketEvent.deleteMany({ where: { ticketId: { in: [fx.ticketAId, fx.ticketBId] } } });
      await prisma.inspection.deleteMany({ where: { taskId: { in: [fx.taskAId, fx.taskBId] } } });
      await prisma.cleaningTask.deleteMany({ where: { locationId: fx.locAId, id: { notIn: [fx.taskAId, fx.taskOtherHkId] } } });
      await cleanupScopeSmokeFixture(prisma, fx);
    }
    await prisma.$disconnect();
  });
  it("P1-119 location recipients contain local supervisor and exclude foreign supervisor", async () => {
    const recipients = await recipientsForLocationOps(fx.locAId, "tickets.assign");
    const ids = [fx.supervisorA.employeeId, fx.supervisorB.employeeId, fx.supervisorEmpty.employeeId, fx.manager.employeeId, fx.housekeeper.employeeId, fx.otherHk.employeeId];
    assert.deepEqual(recipients.filter(id => ids.includes(id)).sort(), [fx.supervisorA.employeeId, fx.manager.employeeId].sort());
    await createNotifications({ ...notification(fx.supervisorA.employeeId, "scope"), locationId: fx.locAId, recipientEmployeeIds: recipients });
    assert.equal(await prisma.notification.count({ where: { dedupeKey: `${tag}-scope`, recipientEmployeeId: fx.supervisorB.employeeId } }), 0);
  });
  it("P1-120 real task assignment targets the assignee with matching task and location", async () => {
    const task = await createCleaningTask({ locationId: fx.locAId, hotelDate: "2099-06-20", assignedEmployeeId: fx.housekeeper.employeeId, actorEmployeeId: fx.manager.employeeId });
    const rows = await prisma.notification.findMany({ where: { entityId: task.id } });
    assert.equal(rows.length, 1); assert.equal(rows[0]!.type, "cleaning.assigned"); assert.equal(rows[0]!.recipientEmployeeId, fx.housekeeper.employeeId);
    assert.equal(rows[0]!.locationId, fx.locAId); assert.equal((rows[0]!.payload as any).taskId, task.id);
  });
  it("P1-120 inspection outcome reaches only current assignee and retry does not duplicate", async () => {
    await prisma.cleaningTask.update({ where: { id: fx.taskAId }, data: { status: "awaiting_inspection" } });
    const input = { taskId: fx.taskAId, inspectorEmployeeId: fx.supervisorA.employeeId, commandId: randomUUID(), result: "rejected" as const, findings: "Rework proof" };
    await inspectCleaningTask(input); await inspectCleaningTask(input);
    const rows = await prisma.notification.findMany({ where: { entityId: fx.taskAId, type: "cleaning.inspected" } });
    assert.equal(rows.length, 1); assert.equal(rows[0]!.recipientEmployeeId, fx.housekeeper.employeeId); assert.equal(rows[0]!.locationId, fx.locAId);
    assert.equal((rows[0]!.payload as any).taskId, fx.taskAId); assert.match(rows[0]!.body, /rejected/);
  });
  it("P1-120 resolution reaches exact reporter and assignee, excludes unrelated employee and dedupes retry", async () => {
    await prisma.maintenanceTicket.update({ where: { id: fx.ticketAId }, data: { status: "in_progress", assigneeId: fx.housekeeper.employeeId, reportedByEmployeeId: fx.otherHk.employeeId } });
    const input = { ticketId: fx.ticketAId, resolvedByEmployeeId: fx.manager.employeeId, bypassAssigneeCheck: true, commandId: randomUUID(), resolutionNotes: "Resolved proof" };
    await resolveMaintenanceTicket(input); await resolveMaintenanceTicket(input);
    const rows = await prisma.notification.findMany({ where: { entityId: fx.ticketAId, type: "ticket.resolved" } });
    assert.deepEqual(rows.map(r => r.recipientEmployeeId).sort(), [fx.housekeeper.employeeId, fx.otherHk.employeeId].sort());
    assert.ok(rows.every(r => r.locationId === fx.locAId && (r.payload as any).ticketId === fx.ticketAId));
  });
  it("P2-38 overlapping creates blocked on real recipient row dedupe each recipient and exclude actor", async () => {
    await clearInbox();
    let release!: () => void; let held!: (pid: number) => void;
    const gate = new Promise<void>(r => { release = r; }); const ready = new Promise<number>(r => { held = r; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${fx.housekeeper.employeeId} FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; held(pid!); await gate;
    }, { timeout: 20000 });
    const pid = await ready;
    const input = { ...notification(fx.housekeeper.employeeId, "dedupe"), actorEmployeeId: fx.manager.employeeId, recipientEmployeeIds: [fx.housekeeper.employeeId, fx.housekeeper.employeeId, fx.otherHk.employeeId, fx.manager.employeeId] };
    const operations = [createNotifications(input), createNotifications(input)];
    try { await waitForBackendsBlockedByHolderChain(prisma, pid, 2, 12000); } finally { release(); }
    await holder; const results = await Promise.all(operations);
    assert.equal(results.reduce((n, r) => n + r.created, 0), 2);
    const rows = await prisma.notification.findMany({ where: { dedupeKey: input.dedupeKey }, include: { deliveries: true } });
    assert.deepEqual(rows.map(r => r.recipientEmployeeId).sort(), [fx.housekeeper.employeeId, fx.otherHk.employeeId].sort());
    assert.ok(rows.every(r => r.deliveries.length === 3));
    assert.equal((await createNotifications(input)).created, 0);
  });
  it("P1-121 P2-39 real HTTP read/dismiss/read-all only change caller inbox and exact unread count", async () => {
    await clearInbox();
    for (let i = 0; i < 3; i++) await createNotifications(notification(fx.housekeeper.employeeId, `read-a-${i}`));
    await createNotifications(notification(fx.otherHk.employeeId, "read-b"));
    const a = await prisma.notification.findMany({ where: { recipientEmployeeId: fx.housekeeper.employeeId }, orderBy: { id: "asc" } });
    const b = await prisma.notification.findFirstOrThrow({ where: { recipientEmployeeId: fx.otherHk.employeeId } });
    const count = async (token: string) => (await getJson(api, token, "/notifications/unread-count")).body as { count: number };
    assert.equal((await count(tokenA)).count, 3);
    for (const verb of ["read", "dismiss"]) assert.equal((await postJson(api, tokenA, `/notifications/${b.id}/${verb}`, {})).status, 404);
    const listing = (await getJson(api, tokenA, "/notifications")).body as any;
    assert.deepEqual(new Set(listing.items.map((r: any) => r.id)), new Set(a.map(r => r.id)));
    for (let i = 0; i < 2; i++) assert.equal((await postJson(api, tokenA, `/notifications/${a[0]!.id}/read`, {})).status, 200);
    assert.equal((await count(tokenA)).count, 2);
    for (let i = 0; i < 2; i++) assert.equal((await postJson(api, tokenA, `/notifications/${a[1]!.id}/dismiss`, {})).status, 200);
    assert.equal((await count(tokenA)).count, 1);
    assert.deepEqual((await postJson(api, tokenA, "/notifications/read-all", {})).body, { updated: 1 });
    assert.deepEqual((await postJson(api, tokenA, "/notifications/read-all", {})).body, { updated: 0 });
    assert.equal((await count(tokenA)).count, 0); assert.equal((await count(tokenB)).count, 1);
    assert.deepEqual(await prisma.notification.findUniqueOrThrow({ where: { id: b.id } }), b);
  });
  it("P2-40 createdAt/id cursor pagination visits independent IDs and timestamp ties exactly once with filters", async () => {
    await clearInbox();
    const ids = ["z", "a", "y", "b", "x", "c", "w"].map(s => `${tag}-${s}`);
    for (let i = 0; i < ids.length; i++) await prisma.notification.create({ data: { id: ids[i], recipientEmployeeId: fx.housekeeper.employeeId, type: "scenario", title: "test", body: "test", entityType: "scenario", entityId: tag, dedupeKey: ids[i]!, createdAt: new Date(`2026-10-${String(19 - Math.floor(i / 2)).padStart(2, "0")}T10:00:00Z`), ...(i === 5 ? { readAt: new Date() } : {}), ...(i === 6 ? { dismissedAt: new Date() } : {}) } });
    for (const [filter, expected] of [["", ids.slice(0, 6)], ["&unread=1", ids.slice(0, 5)], ["&includeDismissed=1", ids]] as const) {
      const seen: string[] = []; let cursor: string | null = null;
      do {
        const res = await getJson(api, tokenA, `/notifications?limit=2${filter}${cursor ? `&cursor=${cursor}` : ""}`);
        assert.equal(res.status, 200); const body = res.body as any;
        seen.push(...body.items.map((r: any) => r.id)); cursor = body.nextCursor;
        assert.ok(seen.length <= 10, "cursor must terminate");
      } while (cursor);
      assert.equal(new Set(seen).size, seen.length);
      assert.deepEqual(new Set(seen), new Set(expected));
    }
  });
  it("P2-41 P2-42 disabled inbox keeps existing rows and main action; adapters never claim delivery", async () => {
    await clearInbox();
    await createNotifications(notification(fx.housekeeper.employeeId, "preserve"));
    const existing = await prisma.notification.findMany({ where: { recipientEmployeeId: fx.housekeeper.employeeId } });
    try {
      await updateSetting({ key: "notifications", value: { ...original, in_app: { ...original.in_app, enabled: false } }, actorEmployeeId: fx.manager.employeeId, reason: "disable" });
      const task = await createCleaningTask({ locationId: fx.locAId, hotelDate: "2099-06-21", assignedEmployeeId: fx.housekeeper.employeeId, actorEmployeeId: fx.manager.employeeId });
      assert.equal(task.status, "assigned");
      assert.deepEqual(await prisma.notification.findMany({ where: { recipientEmployeeId: fx.housekeeper.employeeId } }), existing);
      await updateSetting({ key: "notifications", value: { ...original, in_app: { ...original.in_app, enabled: true }, email: { ...original.email, enabled: true }, device_push: { ...original.device_push, enabled: true } }, actorEmployeeId: fx.manager.employeeId, reason: "adapter contract" });
      assert.equal((await getSetting("notifications")).device_push.enabled, false);
      await createNotifications(notification(fx.housekeeper.employeeId, "adapters"));
      const row = await prisma.notification.findFirstOrThrow({ where: { dedupeKey: `${tag}-adapters` }, include: { deliveries: true } });
      for (const channel of ["email", "device_push"]) {
        const delivery = row.deliveries.find(d => d.channel === channel)!;
        assert.equal(delivery.status, "not_configured"); assert.equal(delivery.deliveredAt, null);
      }
    } finally { await updateSetting({ key: "notifications", value: { ...original, in_app: { ...original.in_app, enabled: true } }, actorEmployeeId: fx.manager.employeeId, reason: "restore" }); }
  });
});
