/**
 * Legacy filename kept so scenario runners that list `qr` still pick up the
 * remaining sync ownership regression (room QR HTTP coverage was removed).
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { prisma } from "../../src/db";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  createScopeSmokeFixture,
  cleanupScopeSmokeFixture,
  type ScopeSmokeFixture,
} from "../fixtures";
import { closeServer, listenApp, loginBearer, postJson } from "../httpHarness";
import { randomUUID } from "node:crypto";

let fx: ScopeSmokeFixture;
let api: string;
let server: Awaited<ReturnType<typeof listenApp>>["server"];
let token: string;

before(async () => {
  await assertTestDatabase(prisma);
  process.env.E2E_DISABLE_RATE_LIMIT = "1";
  fx = await createScopeSmokeFixture(prisma);
  ({ api, server } = await listenApp());
  token = (await loginBearer(api, fx.supervisorA.email, fx.password)).token;
});

after(async () => {
  if (server) await closeServer(server);
  if (fx) {
    await prisma.syncRun.deleteMany({ where: { userId: fx.supervisorA.userId } });
    await cleanupScopeSmokeFixture(prisma, fx);
  }
  await prisma.$disconnect();
});

it("P1-105 P1-107 sync recomputes supervisor sector ownership even when expectedVersion is current", async () => {
  // Losing supervision is actual access loss. Moving a room alone retains the
  // task's sector snapshot and supervisors intentionally bypass its assignee.
  await prisma.cleaningTask.update({
    where: { id: fx.taskAId },
    data: { hotelDate: new Date("2026-01-01") },
  });
  const before = await prisma.cleaningTask.findUniqueOrThrow({
    where: { id: fx.taskAId },
  });
  const location = await prisma.location.findUniqueOrThrow({
    where: { id: fx.locAId },
  });
  const sector = await prisma.sector.findUniqueOrThrow({
    where: { id: fx.sectorAId },
  });
  await prisma.sector.update({
    where: { id: sector.id },
    data: { primarySupervisorEmployeeId: fx.supervisorB.employeeId },
  });
  try {
    const cmd = {
      commandId: randomUUID(),
      type: "cleaning.start",
      payload: { taskId: before.id, expectedVersion: before.version },
    };
    const res = await postJson(api, token, "/sync/push", { commands: [cmd] });
    assert.equal(res.status, 200);
    assert.equal((res.body as any).results[0].status, "conflict");
    assert.equal((res.body as any).results[0].code, "assignee_conflict");
    assert.deepEqual(
      await prisma.cleaningTask.findUniqueOrThrow({ where: { id: before.id } }),
      before,
    );
    assert.deepEqual(
      await prisma.location.findUniqueOrThrow({ where: { id: location.id } }),
      location,
    );
    assert.equal(
      await prisma.cleaningSession.count({ where: { taskId: before.id } }),
      0,
    );
  } finally {
    await prisma.sector.update({
      where: { id: sector.id },
      data: {
        primarySupervisorEmployeeId: sector.primarySupervisorEmployeeId,
      },
    });
  }
});
