/**
 * T-MW-67 / T-MW-68 — GET /my-work personal queue matrix.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  closeServer,
  getJson,
  listenApp,
  loginBearer,
} from "../httpHarness";
import {
  cleanupMyWorkWorld,
  createMyWorkWorld,
  type MyWorkWorld,
} from "./fixtures";

const prisma = new PrismaClient();

type MyWorkBody = {
  tasks: Array<{ id: string }>;
  tickets: Array<{ id: string }>;
  summary: { taskCount: number; ticketCount: number };
  filterShiftId: string | null;
  rosterShiftId: string | null;
};

describe("my-work HTTP queue (T-MW-67 / T-MW-68)", () => {
  let world: MyWorkWorld;
  let api: string;
  let server: import("node:http").Server;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    world = await createMyWorkWorld(prisma);
    ({ server, api } = await listenApp());
  });

  after(async () => {
    await closeServer(server);
    if (world) await cleanupMyWorkWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("T-MW-67a explicit shiftId filters morning ∪ null", async () => {
    const hk = await loginBearer(
      api,
      world.housekeeper.email,
      world.password,
    );
    const res = await getJson(
      api,
      hk.token,
      `/my-work?hotelDate=${world.dayD}&shiftId=${world.shiftMorningId}`,
    );
    assert.equal(res.status, 200);
    const body = res.body as MyWorkBody;
    const ids = body.tasks.map((t) => t.id).sort();
    assert.deepEqual(
      ids,
      [world.taskMorningId, world.taskNullShiftId].sort(),
    );
    assert.equal(body.summary.taskCount, 2);
    assert.equal(body.filterShiftId, world.shiftMorningId);
    assert.ok(!ids.includes(world.taskEveningId));
    assert.ok(!ids.includes(world.taskOtherDayId));
  });

  it("T-MW-67b roster fallback to evening ∪ null", async () => {
    const hk = await loginBearer(
      api,
      world.housekeeper.email,
      world.password,
    );
    const res = await getJson(
      api,
      hk.token,
      `/my-work?hotelDate=${world.dayD}`,
    );
    assert.equal(res.status, 200);
    const body = res.body as MyWorkBody;
    assert.equal(body.rosterShiftId, world.shiftEveningId);
    assert.equal(body.filterShiftId, world.shiftEveningId);
    const ids = body.tasks.map((t) => t.id).sort();
    assert.deepEqual(
      ids,
      [world.taskEveningId, world.taskNullShiftId, world.cleaningForTechId].sort(),
    );
    assert.ok(!ids.includes(world.taskMorningId));
    assert.ok(!ids.includes(world.taskOtherDayId));
  });

  it("T-MW-67c no roster → no shift filter (all active for day in assignee scope)", async () => {
    await prisma.employeeShiftRoster.deleteMany({
      where: {
        employeeId: world.housekeeper.employeeId,
        hotelDate: new Date(`${world.dayD}T00:00:00.000Z`),
      },
    });
    const hk = await loginBearer(
      api,
      world.housekeeper.email,
      world.password,
    );
    const res = await getJson(
      api,
      hk.token,
      `/my-work?hotelDate=${world.dayD}`,
    );
    assert.equal(res.status, 200);
    const body = res.body as MyWorkBody;
    assert.equal(body.rosterShiftId, null);
    assert.equal(body.filterShiftId, null);
    const ids = body.tasks.map((t) => t.id).sort();
    assert.deepEqual(
      ids,
      [
        world.taskMorningId,
        world.taskNullShiftId,
        world.taskEveningId,
        world.cleaningForTechId,
      ].sort(),
    );
    // restore roster for other tests
    await prisma.employeeShiftRoster.create({
      data: {
        employeeId: world.housekeeper.employeeId,
        hotelDate: new Date(`${world.dayD}T00:00:00.000Z`),
        shiftId: world.shiftEveningId,
      },
    });
  });

  it("T-MW-67d explicit shift overrides roster", async () => {
    const hk = await loginBearer(
      api,
      world.housekeeper.email,
      world.password,
    );
    const res = await getJson(
      api,
      hk.token,
      `/my-work?hotelDate=${world.dayD}&shiftId=${world.shiftMorningId}`,
    );
    const body = res.body as MyWorkBody;
    assert.equal(body.rosterShiftId, world.shiftEveningId);
    assert.equal(body.filterShiftId, world.shiftMorningId);
    assert.deepEqual(
      body.tasks.map((t) => t.id).sort(),
      [world.taskMorningId, world.taskNullShiftId].sort(),
    );
  });

  it("T-MW-67e non-null foreign sector snapshot not visible to supervisor of other sector", async () => {
    const sup = await loginBearer(
      api,
      world.supervisor.email,
      world.password,
    );
    const res = await getJson(
      api,
      sup.token,
      `/my-work?hotelDate=${world.dayD2}`,
    );
    assert.equal(res.status, 200);
    const body = res.body as MyWorkBody;
    const ids = new Set(body.tasks.map((t) => t.id));
    assert.ok(
      !ids.has(world.taskForeignSectorId),
      "stale foreign sectorId snapshot must not appear via live room membership",
    );
  });

  it("T-MW-67f foreign assignee task on same day is absent from HK queue", async () => {
    const hk = await loginBearer(
      api,
      world.housekeeper.email,
      world.password,
    );
    const res = await getJson(
      api,
      hk.token,
      `/my-work?hotelDate=${world.dayD}&shiftId=${world.shiftMorningId}`,
    );
    assert.equal(res.status, 200);
    const body = res.body as MyWorkBody;
    const ids = body.tasks.map((t) => t.id);
    assert.ok(!ids.includes(world.taskForeignAssigneeId));
  });

  it("T-MW-67g completed and cancelled controls on D are absent", async () => {
    const hk = await loginBearer(
      api,
      world.housekeeper.email,
      world.password,
    );
    const res = await getJson(
      api,
      hk.token,
      `/my-work?hotelDate=${world.dayD}`,
    );
    assert.equal(res.status, 200);
    const body = res.body as MyWorkBody;
    const ids = body.tasks.map((t) => t.id);
    assert.ok(!ids.includes(world.taskCompletedId));
    assert.ok(!ids.includes(world.taskCancelledId));
  });

  it("T-MW-67h supervisor queue shrinks after sector primary removed", async () => {
    // Supervisor owns only sectorOwn: active dayD tasks with that sector snapshot.
    const expectedBeforeIds = [
      world.taskMorningId,
      world.taskNullShiftId,
      world.taskForeignAssigneeId,
      world.cleaningForTechId,
    ].sort();

    const sup = await loginBearer(
      api,
      world.supervisor.email,
      world.password,
    );
    const token = sup.token;

    try {
      const before = await getJson(
        api,
        token,
        `/my-work?hotelDate=${world.dayD}`,
      );
      assert.equal(before.status, 200);
      const beforeBody = before.body as MyWorkBody;
      const beforeIds = beforeBody.tasks.map((t) => t.id).sort();
      assert.deepEqual(beforeIds, expectedBeforeIds);
      assert.equal(beforeBody.summary.taskCount, expectedBeforeIds.length);
      assert.equal(beforeBody.summary.taskCount, beforeBody.tasks.length);
      assert.ok(
        beforeBody.summary.taskCount > 0,
        "supervisor must see a non-empty sector queue before access is revoked",
      );

      await prisma.sector.update({
        where: { id: world.sectorOwnId },
        data: { primarySupervisorEmployeeId: null },
      });

      // Same session/token — scope must refresh on the next GET.
      const after = await getJson(
        api,
        token,
        `/my-work?hotelDate=${world.dayD}`,
      );
      assert.equal(after.status, 200);
      const afterBody = after.body as MyWorkBody;
      assert.deepEqual(afterBody.tasks, []);
      assert.equal(afterBody.summary.taskCount, 0);
    } finally {
      await prisma.sector.update({
        where: { id: world.sectorOwnId },
        data: { primarySupervisorEmployeeId: world.supervisor.employeeId },
      });
    }
  });

  it("T-MW-68 technician: empty cleaning; exact own open tickets", async () => {
    const tech = await loginBearer(
      api,
      world.technician.email,
      world.password,
    );
    const res = await getJson(api, tech.token, `/my-work?hotelDate=${world.dayD}`);
    assert.equal(res.status, 200);
    const body = res.body as MyWorkBody;
    assert.deepEqual(body.tasks, []);
    assert.equal(body.summary.taskCount, 0);
    const ticketIds = body.tickets.map((t) => t.id).sort();
    assert.deepEqual(
      ticketIds,
      [
        world.ticketOwnOpenId,
        world.ticketOwnAssignedId,
        world.ticketOwnInProgressId,
        world.ticketOwnWaitingId,
      ].sort(),
    );
    assert.equal(body.summary.ticketCount, 4);
    assert.ok(!ticketIds.includes(world.ticketForeignOpenId));
    assert.ok(!ticketIds.includes(world.ticketOwnResolvedId));
    assert.ok(!ticketIds.includes(world.ticketOwnClosedId));
  });
});
