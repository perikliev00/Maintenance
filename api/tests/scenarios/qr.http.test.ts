import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { prisma } from "../../src/db";
import { assertTestDatabase } from "../assertTestDatabase";
import { createScopeSmokeFixture, cleanupScopeSmokeFixture, type ScopeSmokeFixture } from "../fixtures";
import { closeServer, getJson, listenApp, loginBearer, postJson } from "../httpHarness";
import { randomUUID } from "node:crypto";
let fx: ScopeSmokeFixture; let api: string; let server: Awaited<ReturnType<typeof listenApp>>["server"]; let token: string;
before(async () => { await assertTestDatabase(prisma); process.env.E2E_DISABLE_RATE_LIMIT = "1"; fx = await createScopeSmokeFixture(prisma); ({ api, server } = await listenApp()); token = (await loginBearer(api, fx.supervisorA.email, fx.password)).token; });
after(async () => { if (server) await closeServer(server); if (fx) { await prisma.syncRun.deleteMany({ where: { userId: fx.supervisorA.userId } }); await cleanupScopeSmokeFixture(prisma, fx); } await prisma.$disconnect(); });
it("P2-46 P2-47 QR identity read preserves nonempty tasks/history; invalid/archived/foreign QR denies without DTO", async () => {
  const before = await prisma.location.findMany({ where: { id: { in: [fx.locAId, fx.locBId] } }, orderBy: { id: "asc" } });
  const a = before.find(r => r.id === fx.locAId)!; const b = before.find(r => r.id === fx.locBId)!;
  const tasks = await prisma.cleaningTask.findMany({ where: { id: { in: [fx.taskAId, fx.taskBId] } }, orderBy: { id: "asc" } }); assert.equal(tasks.length, 2);
  const audit = await prisma.auditEvent.findMany({ where: { locationId: { in: [fx.locAId, fx.locBId] } }, orderBy: { id: "asc" } }); assert.ok(audit.length > 0);
  const own = await getJson(api, token, `/locations/by-qr/${a.qrToken}`); assert.equal(own.status, 200); assert.equal((own.body as any).location.id, fx.locAId); assert.equal((own.body as any).qr.qrToken, a.qrToken);
  for (const [qr, status] of [["unknown-token", 404], [b.qrToken, 403]] as const) { const res = await getJson(api, token, `/locations/by-qr/${qr}`); assert.equal(res.status, status); assert.equal((res.body as any).location, undefined); assert.ok(!JSON.stringify(res.body).includes(b.number)); }
  await prisma.location.update({ where: { id: a.id }, data: { catalogStatus: "archived" } });
  try { const res = await getJson(api, token, `/locations/by-qr/${a.qrToken}`); assert.equal(res.status, 404); assert.equal((res.body as any).location, undefined); }
  finally { await prisma.location.update({ where: { id: a.id }, data: { catalogStatus: a.catalogStatus, updatedAt: a.updatedAt } }); }
  assert.deepEqual(await prisma.location.findMany({ where: { id: { in: [fx.locAId, fx.locBId] } }, orderBy: { id: "asc" } }), before);
  assert.deepEqual(await prisma.cleaningTask.findMany({ where: { id: { in: [fx.taskAId, fx.taskBId] } }, orderBy: { id: "asc" } }), tasks);
  assert.deepEqual(await prisma.auditEvent.findMany({ where: { locationId: { in: [fx.locAId, fx.locBId] } }, orderBy: { id: "asc" } }), audit);
  assert.equal(await prisma.cleaningSession.count({ where: { taskId: { in: [fx.taskAId, fx.taskBId] } } }), 0);
});
it("P1-105 P1-107 sync recomputes current sector scope even when expectedVersion is current", async () => {
  const before = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: fx.taskAId } });
  const location = await prisma.location.findUniqueOrThrow({ where: { id: fx.locAId } });
  const memberships = await prisma.sectorLocation.findMany({ where: { locationId: fx.locAId } }); assert.ok(memberships.some(r => r.sectorId === fx.sectorAId));
  await prisma.sectorLocation.deleteMany({ where: { locationId: fx.locAId } });
  await prisma.sectorLocation.create({ data: { sectorId: fx.sectorBId, locationId: fx.locAId } });
  try {
    const cmd = { commandId: randomUUID(), type: "cleaning.start", payload: { taskId: before.id, expectedVersion: before.version } };
    const res = await postJson(api, token, "/sync/push", { commands: [cmd] }); assert.equal(res.status, 200);
    assert.equal((res.body as any).results[0].status, "conflict"); assert.equal((res.body as any).results[0].code, "assignee_conflict");
    assert.deepEqual(await prisma.cleaningTask.findUniqueOrThrow({ where: { id: before.id } }), before);
    assert.deepEqual(await prisma.location.findUniqueOrThrow({ where: { id: location.id } }), location);
    assert.equal(await prisma.cleaningSession.count({ where: { taskId: before.id } }), 0);
  } finally { await prisma.sectorLocation.deleteMany({ where: { locationId: fx.locAId } }); await prisma.sectorLocation.createMany({ data: memberships }); }
});
