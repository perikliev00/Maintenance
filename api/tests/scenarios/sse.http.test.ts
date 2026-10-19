import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { prisma } from "../../src/db";
import { assertTestDatabase } from "../assertTestDatabase";
import { createScopeSmokeFixture, cleanupScopeSmokeFixture, type ScopeSmokeFixture } from "../fixtures";
import { listenApp, closeServer, loginBearer } from "../httpHarness";
import { publish } from "../../src/events/bus";
import { createSession } from "../../src/services/authSessions";
let fx: ScopeSmokeFixture; let api: string; let server: Awaited<ReturnType<typeof listenApp>>["server"];
async function until(check: () => boolean, reason: string) {
  const end = Date.now() + 5000;
  while (!check()) { assert.ok(Date.now() < end, reason); await new Promise(r => setTimeout(r, 5)); }
}
before(async () => { await assertTestDatabase(prisma); process.env.E2E_DISABLE_RATE_LIMIT = "1"; fx = await createScopeSmokeFixture(prisma); ({ api, server } = await listenApp()); });
after(async () => { if (server) await closeServer(server); if (fx) await cleanupScopeSmokeFixture(prisma, fx); await prisma.$disconnect(); });
it("P1-115 real open SSE reloads changed sectors and closes on DB revoke/expiry at heartbeat", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const controllers: AbortController[] = []; const pumps: Promise<void>[] = [];
  try {
    for (const invalidation of ["revoke", "expiry"] as const) {
      const tokens = await createSession({ userId: fx.supervisorA.userId });
      const controller = new AbortController(); controllers.push(controller);
      const response = await fetch(`${api}/events/stream`, { headers: { Authorization: `Bearer ${tokens.accessToken}` }, signal: controller.signal });
      assert.equal(response.status, 200); assert.match(response.headers.get("content-type")!, /text\/event-stream/);
      let text = ""; let closed = false;
      const reader = response.body!.getReader(); const decoder = new TextDecoder();
      const pump = (async () => { try { while (true) { const result = await reader.read(); if (result.done) break; text += decoder.decode(result.value, { stream: true }); } } catch (err) { if (!controller.signal.aborted) throw err; } finally { closed = true; reader.releaseLock(); } })(); pumps.push(pump);
      await until(() => text.includes("event: connected"), "initial connected frame");
      if (invalidation === "revoke") {
        publish("location.changed", { locationId: fx.locBId }); publish("location.changed", { locationId: fx.locAId });
        await until(() => text.includes(fx.locAId), "allowed event must arrive");
        assert.equal(text.includes(fx.locBId), false);
        await prisma.$transaction([
          prisma.sector.update({ where: { id: fx.sectorAId }, data: { primarySupervisorEmployeeId: fx.supervisorB.employeeId } }),
          prisma.sector.update({ where: { id: fx.sectorBId }, data: { primarySupervisorEmployeeId: fx.supervisorA.employeeId } }),
        ]);
        t.mock.timers.tick(25000); await until(() => text.includes(": ping"), "heartbeat scope reload");
        const index = text.length;
        publish("location.changed", { locationId: fx.locAId }); publish("location.changed", { locationId: fx.locBId });
        await until(() => text.slice(index).includes(fx.locBId), "new sector event must arrive");
        assert.equal(text.slice(index).includes(fx.locAId), false);
        await prisma.authSession.update({ where: { id: tokens.sessionId }, data: { revokedAt: new Date() } });
      } else await prisma.authSession.update({ where: { id: tokens.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
      t.mock.timers.tick(25000); await until(() => closed, "revoked/expired stream must reach EOF");
      assert.match(text, /event: revoked/); assert.match(text, /session_revoked/);
      const end = text.length; publish("location.changed", { locationId: fx.locBId }); assert.equal(text.length, end);
    }
  } finally { for (const c of controllers) c.abort(); await Promise.allSettled(pumps); t.mock.timers.reset(); }
});
