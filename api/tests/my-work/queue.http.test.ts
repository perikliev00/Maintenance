/**
 * GET /my-work personal queue matrix.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient } from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Execute the next setup or assertion step for this scenario.
  getJson,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
// Execute the next setup or assertion step for this scenario.
} from "../httpHarness";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupMyWorkWorld,
  // Execute the next setup or assertion step for this scenario.
  createMyWorkWorld,
  // Shape MyWorkWorld documents the fixture/response fields this suite touches.
  type MyWorkWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Shape MyWorkBody documents the fixture/response fields this suite touches.
type MyWorkBody = {
  // Execute the next setup or assertion step for this scenario.
  tasks: Array<{ id: string }>;
  // Execute the next setup or assertion step for this scenario.
  tickets: Array<{ id: string }>;
  // Pagination step for list/contract coverage.
  ticketNextCursor: string | null;
  // Execute the next setup or assertion step for this scenario.
  summary: { taskCount: number; ticketCount: number };
  // Execute the next setup or assertion step for this scenario.
  filterShiftId: string | null;
  // Execute the next setup or assertion step for this scenario.
  rosterShiftId: string | null;
};

// Suite: my-work HTTP queue.
describe("my-work HTTP queue", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: MyWorkWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: import("node:http").Server;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createMyWorkWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Start or stop the in-process API server for this suite.
    await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupMyWorkWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: explicit shiftId filters morning ∪ null.
  it("explicit shiftId filters morning ∪ null", async () => {
    // hk: synchronize actors so the race window is observable.
    const hk = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.housekeeper.email,
      // Execute the next setup or assertion step for this scenario.
      world.password,
    );
    // res: HTTP response captured for status/body checks.
    const res = await getJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      hk.token,
      // Execute the next setup or assertion step for this scenario.
      `/my-work?hotelDate=${world.dayD}&shiftId=${world.shiftMorningId}`,
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Bind body for later setup or assertions in this scope.
    const body = res.body as MyWorkBody;
    // Bind ids for later setup or assertions in this scope.
    const ids = body.tasks.map((t) => t.id).sort();
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      ids,
      // Execute the next setup or assertion step for this scenario.
      [world.taskMorningId, world.taskNullShiftId].sort(),
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.summary.taskCount, 2);
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.filterShiftId, world.shiftMorningId);
    // Assert the observed value matches the intended post-condition.
    assert.ok(!ids.includes(world.taskEveningId));
    // Assert the observed value matches the intended post-condition.
    assert.ok(!ids.includes(world.taskOtherDayId));
  });

  // Case: roster fallback to evening ∪ null.
  it("roster fallback to evening ∪ null", async () => {
    // hk: synchronize actors so the race window is observable.
    const hk = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.housekeeper.email,
      // Execute the next setup or assertion step for this scenario.
      world.password,
    );
    // res: HTTP response captured for status/body checks.
    const res = await getJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      hk.token,
      // Execute the next setup or assertion step for this scenario.
      `/my-work?hotelDate=${world.dayD}`,
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Bind body for later setup or assertions in this scope.
    const body = res.body as MyWorkBody;
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.rosterShiftId, world.shiftEveningId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.filterShiftId, world.shiftEveningId);
    // Bind ids for later setup or assertions in this scope.
    const ids = body.tasks.map((t) => t.id).sort();
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      ids,
      // Execute the next setup or assertion step for this scenario.
      [world.taskEveningId, world.taskNullShiftId, world.cleaningForTechId].sort(),
    );
    // Assert the observed value matches the intended post-condition.
    assert.ok(!ids.includes(world.taskMorningId));
    // Assert the observed value matches the intended post-condition.
    assert.ok(!ids.includes(world.taskOtherDayId));
  });

  // Case: no roster → no shift filter (all active for day in assignee scope).
  it("no roster → no shift filter (all active for day in assignee scope)", async () => {
    // Await async work before asserting or releasing locks.
    await prisma.employeeShiftRoster.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.housekeeper.employeeId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${world.dayD}T00:00:00.000Z`),
      },
    });
    // hk: synchronize actors so the race window is observable.
    const hk = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.housekeeper.email,
      // Execute the next setup or assertion step for this scenario.
      world.password,
    );
    // res: HTTP response captured for status/body checks.
    const res = await getJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      hk.token,
      // Execute the next setup or assertion step for this scenario.
      `/my-work?hotelDate=${world.dayD}`,
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Bind body for later setup or assertions in this scope.
    const body = res.body as MyWorkBody;
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.rosterShiftId, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.filterShiftId, null);
    // Bind ids for later setup or assertions in this scope.
    const ids = body.tasks.map((t) => t.id).sort();
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      ids,
      [
        // Execute the next setup or assertion step for this scenario.
        world.taskMorningId,
        // Execute the next setup or assertion step for this scenario.
        world.taskNullShiftId,
        // Execute the next setup or assertion step for this scenario.
        world.taskEveningId,
        // Execute the next setup or assertion step for this scenario.
        world.cleaningForTechId,
      // Execute the next setup or assertion step for this scenario.
      ].sort(),
    );
    // restore roster for other tests
    await prisma.employeeShiftRoster.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.housekeeper.employeeId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${world.dayD}T00:00:00.000Z`),
        // Execute the next setup or assertion step for this scenario.
        shiftId: world.shiftEveningId,
      },
    });
  });

  // Case: explicit shift overrides roster.
  it("explicit shift overrides roster", async () => {
    // hk: synchronize actors so the race window is observable.
    const hk = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.housekeeper.email,
      // Execute the next setup or assertion step for this scenario.
      world.password,
    );
    // res: HTTP response captured for status/body checks.
    const res = await getJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      hk.token,
      // Execute the next setup or assertion step for this scenario.
      `/my-work?hotelDate=${world.dayD}&shiftId=${world.shiftMorningId}`,
    );
    // Bind body for later setup or assertions in this scope.
    const body = res.body as MyWorkBody;
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.rosterShiftId, world.shiftEveningId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.filterShiftId, world.shiftMorningId);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      body.tasks.map((t) => t.id).sort(),
      // Execute the next setup or assertion step for this scenario.
      [world.taskMorningId, world.taskNullShiftId].sort(),
    );
  });

  // Case: non-null foreign sector snapshot not visible to supervisor of other sector.
  it("non-null foreign sector snapshot not visible to supervisor of other sector", async () => {
    // sup: synchronize actors so the race window is observable.
    const sup = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.supervisor.email,
      // Execute the next setup or assertion step for this scenario.
      world.password,
    );
    // res: HTTP response captured for status/body checks.
    const res = await getJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      sup.token,
      // Execute the next setup or assertion step for this scenario.
      `/my-work?hotelDate=${world.dayD2}`,
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Bind body for later setup or assertions in this scope.
    const body = res.body as MyWorkBody;
    // Bind ids for later setup or assertions in this scope.
    const ids = new Set(body.tasks.map((t) => t.id));
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      !ids.has(world.taskForeignSectorId),
      // Execute the next setup or assertion step for this scenario.
      "stale foreign sectorId snapshot must not appear via live room membership",
    );
  });

  // Case: foreign assignee task on same day is absent from HK queue.
  it("foreign assignee task on same day is absent from HK queue", async () => {
    // hk: synchronize actors so the race window is observable.
    const hk = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.housekeeper.email,
      // Execute the next setup or assertion step for this scenario.
      world.password,
    );
    // res: HTTP response captured for status/body checks.
    const res = await getJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      hk.token,
      // Execute the next setup or assertion step for this scenario.
      `/my-work?hotelDate=${world.dayD}&shiftId=${world.shiftMorningId}`,
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Bind body for later setup or assertions in this scope.
    const body = res.body as MyWorkBody;
    // Bind ids for later setup or assertions in this scope.
    const ids = body.tasks.map((t) => t.id);
    // Assert the observed value matches the intended post-condition.
    assert.ok(!ids.includes(world.taskForeignAssigneeId));
  });

  // Case: completed and cancelled controls on D are absent.
  it("completed and cancelled controls on D are absent", async () => {
    // hk: synchronize actors so the race window is observable.
    const hk = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.housekeeper.email,
      // Execute the next setup or assertion step for this scenario.
      world.password,
    );
    // res: HTTP response captured for status/body checks.
    const res = await getJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      hk.token,
      // Execute the next setup or assertion step for this scenario.
      `/my-work?hotelDate=${world.dayD}`,
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Bind body for later setup or assertions in this scope.
    const body = res.body as MyWorkBody;
    // Bind ids for later setup or assertions in this scope.
    const ids = body.tasks.map((t) => t.id);
    // Assert the observed value matches the intended post-condition.
    assert.ok(!ids.includes(world.taskCompletedId));
    // Assert the observed value matches the intended post-condition.
    assert.ok(!ids.includes(world.taskCancelledId));
  });

  // Case: supervisor queue shrinks after sector primary removed.
  it("supervisor queue shrinks after sector primary removed", async () => {
    // Supervisor owns only sectorOwn: active dayD tasks with that sector snapshot.
    const expectedBeforeIds = [
      // Execute the next setup or assertion step for this scenario.
      world.taskMorningId,
      // Execute the next setup or assertion step for this scenario.
      world.taskNullShiftId,
      // Execute the next setup or assertion step for this scenario.
      world.taskForeignAssigneeId,
      // Execute the next setup or assertion step for this scenario.
      world.cleaningForTechId,
    // Execute the next setup or assertion step for this scenario.
    ].sort();

    // sup: synchronize actors so the race window is observable.
    const sup = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.supervisor.email,
      // Execute the next setup or assertion step for this scenario.
      world.password,
    );
    // token: credential/token material for auth flows.
    const token = sup.token;

    // Try path where partial failure must not leak suite state.
    try {
      // before: HTTP response captured for status/body checks.
      const before = await getJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        token,
        // Execute the next setup or assertion step for this scenario.
        `/my-work?hotelDate=${world.dayD}`,
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(before.status, 200);
      // Bind beforeBody for later setup or assertions in this scope.
      const beforeBody = before.body as MyWorkBody;
      // Bind beforeIds for later setup or assertions in this scope.
      const beforeIds = beforeBody.tasks.map((t) => t.id).sort();
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.deepEqual(beforeIds, expectedBeforeIds);
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.equal(beforeBody.summary.taskCount, expectedBeforeIds.length);
      // Assert collection size matches the expected post-condition.
      assert.equal(beforeBody.summary.taskCount, beforeBody.tasks.length);
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        beforeBody.summary.taskCount > 0,
        // Execute the next setup or assertion step for this scenario.
        "supervisor must see a non-empty sector queue before access is revoked",
      );

      // Await async work before asserting or releasing locks.
      await prisma.sector.update({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: world.sectorOwnId },
        // Execute the next setup or assertion step for this scenario.
        data: { primarySupervisorEmployeeId: null },
      });

      // Same session/token — scope must refresh on the next GET.
      const after = await getJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        token,
        // Execute the next setup or assertion step for this scenario.
        `/my-work?hotelDate=${world.dayD}`,
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(after.status, 200);
      // Bind afterBody for later setup or assertions in this scope.
      const afterBody = after.body as MyWorkBody;
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(afterBody.tasks, []);
      // Assert the observed value matches the intended post-condition.
      assert.equal(afterBody.summary.taskCount, 0);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.sector.update({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: world.sectorOwnId },
        // Execute the next setup or assertion step for this scenario.
        data: { primarySupervisorEmployeeId: world.supervisor.employeeId },
      });
    }
  });

  // Case: technician: empty cleaning; exact own open tickets.
  it("technician: empty cleaning; exact own open tickets", async () => {
    // tech: synchronize actors so the race window is observable.
    const tech = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.technician.email,
      // Execute the next setup or assertion step for this scenario.
      world.password,
    );
    // res: HTTP response captured for status/body checks.
    const res = await getJson(api, tech.token, `/my-work?hotelDate=${world.dayD}`);
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Bind body for later setup or assertions in this scope.
    const body = res.body as MyWorkBody;
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(body.tasks, []);
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.summary.taskCount, 0);
    // Bind ticketIds for later setup or assertions in this scope.
    const ticketIds = body.tickets.map((t) => t.id).sort();
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      ticketIds,
      [
        // Execute the next setup or assertion step for this scenario.
        world.ticketOwnOpenId,
        // Execute the next setup or assertion step for this scenario.
        world.ticketOwnAssignedId,
        // Execute the next setup or assertion step for this scenario.
        world.ticketOwnInProgressId,
        // Execute the next setup or assertion step for this scenario.
        world.ticketOwnWaitingId,
      // Execute the next setup or assertion step for this scenario.
      ].sort(),
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.summary.ticketCount, 4);
    // Assert the observed value matches the intended post-condition.
    assert.ok(!ticketIds.includes(world.ticketForeignOpenId));
    // Assert the observed value matches the intended post-condition.
    assert.ok(!ticketIds.includes(world.ticketOwnResolvedId));
    // Assert the observed value matches the intended post-condition.
    assert.ok(!ticketIds.includes(world.ticketOwnClosedId));
  });

  // Case: every assigned repair is reachable beyond 50 with stable equal-time ordering.
  it("every assigned repair is reachable beyond 50 with stable equal-time ordering", async () => {
    // tech: synchronize actors so the race window is observable.
    const tech = await loginBearer(api, world.technician.email, world.password);
    // Bind ids for later setup or assertions in this scope.
    const ids = Array.from({ length: 55 }, (_, i) => `mw-page-${world.stamp}-${String(i).padStart(3, "0")}`);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await prisma.maintenanceTicket.createMany({ data: ids.map((id) => ({
      // Execute the next setup or assertion step for this scenario.
      id,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locOwnId,
      // Execute the next setup or assertion step for this scenario.
      title: id,
      // Execute the next setup or assertion step for this scenario.
      categoryKey: "other",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelBg: "Друго",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelEn: "Other",
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      assigneeId: world.technician.employeeId,
      // Fixture field status for the seeded actor/entity.
      status: "assigned" as const,
      // Execute the next setup or assertion step for this scenario.
      openedAt: new Date("2099-01-01T12:00:00.000Z"),
    // Execute the next setup or assertion step for this scenario.
    })) });
    // Try path where partial failure must not leak suite state.
    try {
      // first: HTTP response captured for status/body checks.
      const first = await getJson(api, tech.token, "/my-work");
      // Assert HTTP status matches the contract for this path.
      assert.equal(first.status, 200);
      // Bind body for later setup or assertions in this scope.
      const body = first.body as MyWorkBody;
      // Assert collection size matches the expected post-condition.
      assert.equal(body.tickets.length, 50);
      // Assert the observed value matches the intended post-condition.
      assert.equal(body.summary.ticketCount, 59);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(body.tasks, []);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(body.tickets.map((t) => t.id), [...ids].sort().reverse().slice(0, 50));
      // Assert the observed value matches the intended post-condition.
      assert.ok(body.ticketNextCursor);

      // A resolved/deleted cursor row must not strand the next page (keyset, no row lookup).
      await prisma.maintenanceTicket.update({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: body.tickets.at(-1)!.id }, data: { status: "resolved" },
      });
      // next: HTTP response captured for status/body checks.
      const next = await getJson(api, tech.token, `/my-work?ticketCursor=${encodeURIComponent(body.ticketNextCursor)}`);
      // Assert HTTP status matches the contract for this path.
      assert.equal(next.status, 200);
      // Bind nextBody for later setup or assertions in this scope.
      const nextBody = next.body as MyWorkBody;
      // Assert collection size matches the expected post-condition.
      assert.equal(nextBody.tickets.length, 9);
      // Assert the observed value matches the intended post-condition.
      assert.equal(nextBody.ticketNextCursor, null);
      // Assert the observed value matches the intended post-condition.
      assert.equal(nextBody.summary.ticketCount, 58);
      // Bind allIds for later setup or assertions in this scope.
      const allIds = [...body.tickets, ...nextBody.tickets].map((t) => t.id);
      // Assert the observed value matches the intended post-condition.
      assert.equal(new Set(allIds).size, 59, "no skipped or duplicated original rows");
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual([...allIds].sort(), [...ids, world.ticketOwnOpenId, world.ticketOwnAssignedId,
        // Execute the next setup or assertion step for this scenario.
        world.ticketOwnInProgressId, world.ticketOwnWaitingId].sort());
      // Assert the observed value matches the intended post-condition.
      assert.ok(!allIds.includes(world.ticketForeignOpenId));
      // Assert the observed value matches the intended post-condition.
      assert.ok(!allIds.includes(world.ticketOwnClosedId));

      // A cursor conveys ordering, never another employee's authority.
      const other = await loginBearer(api, world.otherTech.email, world.password);
      // otherPage: HTTP response captured for status/body checks.
      const otherPage = await getJson(api, other.token, `/my-work?ticketCursor=${encodeURIComponent(body.ticketNextCursor)}`);
      // Assert HTTP status matches the contract for this path.
      assert.equal(otherPage.status, 200);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual((otherPage.body as MyWorkBody).tickets.map((t) => t.id), [world.ticketForeignOpenId]);
      // Iterate to cover variants or wait until a condition holds.
      for (const query of ["ticketCursor=invalid", "ticketPageSize=0", "ticketPageSize=101", "ticketPageSize=1.5"]) {
        // Assert HTTP status matches the contract for this path.
        assert.equal((await getJson(api, tech.token, `/my-work?${query}`)).status, 400, query);
      }
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.maintenanceTicket.deleteMany({ where: { id: { in: ids } } });
    }
  });
});
