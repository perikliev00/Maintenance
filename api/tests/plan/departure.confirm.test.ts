/**
 * 56 — deferred departure confirm assignee + scope (56).
 */
import assert from "node:assert/strict";
// Import bindings from node:path.
import path from "node:path";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CleaningStatus,
  // Execute the next setup or assertion step for this scenario.
  Occupancy,
  // Execute the next setup or assertion step for this scenario.
  Priority,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupScopeSmokeFixture,
  // Execute the next setup or assertion step for this scenario.
  createScopeSmokeFixture,
  // Shape ScopeSmokeFixture documents the fixture/response fields this suite touches.
  type ScopeSmokeFixture,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../fixtures";
// Import bindings from ../../src/services/roleGrants.
import { ensureDefaultRoleGrants } from "../../src/services/roleGrants";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  PLAN_PASSWORD,
  // Delivery/replay step for async notification paths.
  assertLocationSnapEqual,
  // Execute the next setup or assertion step for this scenario.
  cancelActiveTasks,
  // Execute the next setup or assertion step for this scenario.
  cleanupPlanArtifacts,
  // Execute the next setup or assertion step for this scenario.
  cleanupPlanWorld,
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Execute the next setup or assertion step for this scenario.
  countActiveTasks,
  // Execute the next setup or assertion step for this scenario.
  createActiveTask,
  // Execute the next setup or assertion step for this scenario.
  createExtraHousekeeper,
  // Execute the next setup or assertion step for this scenario.
  createPlanWorld,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  postJson,
  // Execute the next setup or assertion step for this scenario.
  prepareRoom,
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  seedDeferredDeparture,
  // Execute the next setup or assertion step for this scenario.
  snapshotLocation,
  // Pagination step for list/contract coverage.
  ymdOffset,
  // Shape PlanWorld documents the fixture/response fields this suite touches.
  type PlanWorld,
  // Execute the next setup or assertion step for this scenario.
  cleanupEmployeeGraph,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Execute the next setup or assertion step for this scenario.
dotenv.config({
  // Execute the next setup or assertion step for this scenario.
  path: path.resolve(__dirname, "../../.env"),
  // Execute the next setup or assertion step for this scenario.
  override: true,
});

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: daily plan departure confirm (56 / 56).
describe("daily plan departure confirm (56 / 56)", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: PlanWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Execute the next setup or assertion step for this scenario.
  let ownerToken: string;
  // Execute the next setup or assertion step for this scenario.
  let today: string;
  // Execute the next setup or assertion step for this scenario.
  let past: string;
  // Execute the next setup or assertion step for this scenario.
  let pastOther: string;
  // Execute the next setup or assertion step for this scenario.
  let hkA2: Awaited<ReturnType<typeof createExtraHousekeeper>>;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Await async work before asserting or releasing locks.
    await ensureDefaultRoleGrants();
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createPlanWorld(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    hkA2 = await createExtraHousekeeper(prisma, world.stamp, "CONF2");
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
    // login: synchronize actors so the race window is observable.
    const login = await loginBearer(api, world.owner.email, PLAN_PASSWORD);
    // Session/CSRF step exercising auth lifecycle.
    ownerToken = login.token;
    // Await async work before asserting or releasing locks.
    today = await hotelTodayYmd();
    // Pagination step for list/contract coverage.
    past = ymdOffset(today, -2);
    // Pagination step for list/contract coverage.
    pastOther = ymdOffset(today, -5);
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (hkA2) await cleanupEmployeeGraph(prisma, [hkA2.employeeId]);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupPlanWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await cleanupPlanArtifacts(prisma, [
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      world.locationBId,
      // Execute the next setup or assertion step for this scenario.
      world.locationCId,
      // Execute the next setup or assertion step for this scenario.
      world.archivedLocationId,
    ]);
  });

  // Case: confirm deferred creates task with preselected assignee/shift.
  it("confirm deferred creates task with preselected assignee/shift", async () => {
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationAId, past);
    // entry: seeded entity required before the mutation under test.
    const entry = await seedDeferredDeparture(prisma, {
      // Execute the next setup or assertion step for this scenario.
      hotelDateYmd: past,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: world.shiftId,
    });

    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      "/daily-plan/apply-departure-effects",
      // Execute the next setup or assertion step for this scenario.
      { hotelDate: past, confirmEntryIds: [entry.id] },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Bind body for later setup or assertions in this scope.
    const body = res.body as {
      // Execute the next setup or assertion step for this scenario.
      applied: number;
      // Execute the next setup or assertion step for this scenario.
      deferred: number;
    };
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.applied, 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.deferred, 0);

    // updated: synchronize actors so the race window is observable.
    const updated = await prisma.dailyPlanEntry.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: entry.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(updated.roomEffectsAppliedAt);
    // Assert the observed value matches the intended post-condition.
    assert.ok(updated.cleaningTaskId);
    // task: synchronize actors so the race window is observable.
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: updated.cleaningTaskId! },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.priority, Priority.high);
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.assignedEmployeeId, world.hk1.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.shiftId, world.shiftId);
    // loc: synchronize actors so the race window is observable.
    const loc = await snapshotLocation(prisma, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.occupancy, Occupancy.vacant);
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
  });

  // Case: confirm links preexisting task and preserves its assignee/shift.
  it("confirm links preexisting task and preserves its assignee/shift", async () => {
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationAId, past);
    // entry: seeded entity required before the mutation under test.
    const entry = await seedDeferredDeparture(prisma, {
      // Execute the next setup or assertion step for this scenario.
      hotelDateYmd: past,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: hkA2.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: world.shift2Id,
    });
    // preexisting: seeded entity required before the mutation under test.
    const preexisting = await createActiveTask(prisma, {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      hotelDateYmd: past,
      // Execute the next setup or assertion step for this scenario.
      priority: Priority.normal,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: world.shiftId,
    });

    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      "/daily-plan/apply-departure-effects",
      // Execute the next setup or assertion step for this scenario.
      { hotelDate: past, confirmEntryIds: [entry.id] },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { applied: number }).applied, 1);

    // updated: synchronize actors so the race window is observable.
    const updated = await prisma.dailyPlanEntry.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: entry.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(updated.cleaningTaskId, preexisting.id);
    // task: synchronize actors so the race window is observable.
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: preexisting.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.priority, Priority.high);
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.assignedEmployeeId, world.hk1.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(task.shiftId, world.shiftId);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countActiveTasks(prisma, world.locationAId, past), 1);
  });

  // Case: confirm out-of-scope entry does not change foreign room.
  it("confirm out-of-scope entry does not change foreign room", async () => {
    // Execute the next setup or assertion step for this scenario.
    let fx: ScopeSmokeFixture | null = null;
    // Try path where partial failure must not leak suite state.
    try {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      fx = await createScopeSmokeFixture(prisma);
      // Await async work before asserting or releasing locks.
      await prisma.cleaningTask.updateMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { locationId: { in: [fx.locAId, fx.locBId] } },
        // Execute the next setup or assertion step for this scenario.
        data: { status: "cancelled" },
      });
      // Await async work before asserting or releasing locks.
      await cleanupPlanArtifacts(prisma, [fx.locAId, fx.locBId]);

      // entryA: seeded entity required before the mutation under test.
      const entryA = await seedDeferredDeparture(prisma, {
        // Execute the next setup or assertion step for this scenario.
        hotelDateYmd: past,
        // Execute the next setup or assertion step for this scenario.
        locationId: fx.locAId,
        // Execute the next setup or assertion step for this scenario.
        createdByEmployeeId: fx.manager.employeeId,
      });
      // entryB: seeded entity required before the mutation under test.
      const entryB = await seedDeferredDeparture(prisma, {
        // Execute the next setup or assertion step for this scenario.
        hotelDateYmd: past,
        // Execute the next setup or assertion step for this scenario.
        locationId: fx.locBId,
        // Execute the next setup or assertion step for this scenario.
        createdByEmployeeId: fx.manager.employeeId,
      });
      // beforeB: synchronize actors so the race window is observable.
      const beforeB = await snapshotLocation(prisma, fx.locBId);
      // entryBBefore: synchronize actors so the race window is observable.
      const entryBBefore = await prisma.dailyPlanEntry.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: entryB.id },
      });

      // Await async work before asserting or releasing locks.
      const { token: supTok } = await loginBearer(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        fx.supervisorA.email,
        // Execute the next setup or assertion step for this scenario.
        fx.password,
      );

      // Negative: confirm only foreign B — should not apply B (out of scope pending list).
      const neg = await postJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        supTok,
        // Execute the next setup or assertion step for this scenario.
        "/daily-plan/apply-departure-effects",
        // Execute the next setup or assertion step for this scenario.
        { hotelDate: past, confirmEntryIds: [entryB.id] },
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(neg.status, 200, JSON.stringify(neg.body));
      // Assert the observed value matches the intended post-condition.
      assert.equal((neg.body as { applied: number }).applied, 0);
      // Delivery/replay step for async notification paths.
      assertLocationSnapEqual(
        // Await async work before asserting or releasing locks.
        await snapshotLocation(prisma, fx.locBId),
        // Execute the next setup or assertion step for this scenario.
        beforeB,
        // Execute the next setup or assertion step for this scenario.
        "56a locB after foreign confirm",
      );
      // entryBAfter: synchronize actors so the race window is observable.
      const entryBAfter = await prisma.dailyPlanEntry.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: entryB.id },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(entryBAfter.roomEffectsAppliedAt, null);
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        entryBAfter.cleaningTaskId,
        // Execute the next setup or assertion step for this scenario.
        entryBBefore.cleaningTaskId,
      );

      // Positive: confirm A in scope.
      const pos = await postJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        supTok,
        // Execute the next setup or assertion step for this scenario.
        "/daily-plan/apply-departure-effects",
        // Execute the next setup or assertion step for this scenario.
        { hotelDate: past, confirmEntryIds: [entryA.id] },
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(pos.status, 200, JSON.stringify(pos.body));
      // Assert the observed value matches the intended post-condition.
      assert.equal((pos.body as { applied: number }).applied, 1);
      // locA: synchronize actors so the race window is observable.
      const locA = await snapshotLocation(prisma, fx.locAId);
      // Assert the observed value matches the intended post-condition.
      assert.equal(locA.occupancy, Occupancy.vacant);
      // B still untouched.
      assertLocationSnapEqual(
        // Await async work before asserting or releasing locks.
        await snapshotLocation(prisma, fx.locBId),
        // Execute the next setup or assertion step for this scenario.
        beforeB,
        // Execute the next setup or assertion step for this scenario.
        "56a locB after A confirm",
      );
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (fx) {
        // Await async work before asserting or releasing locks.
        await cleanupPlanArtifacts(prisma, [fx.locAId, fx.locBId]);
        // Await async work before asserting or releasing locks.
        await cleanupScopeSmokeFixture(prisma, fx);
      }
    }
  });

  // Case: confirm other-day entry on separate room is a no-op for that room.
  it("confirm other-day entry on separate room is a no-op for that room", async () => {
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationAId, past);
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationCId, pastOther);

    // entryA: seeded entity required before the mutation under test.
    const entryA = await seedDeferredDeparture(prisma, {
      // Execute the next setup or assertion step for this scenario.
      hotelDateYmd: past,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.owner.employeeId,
    });
    // entryC: seeded entity required before the mutation under test.
    const entryC = await seedDeferredDeparture(prisma, {
      // Execute the next setup or assertion step for this scenario.
      hotelDateYmd: pastOther,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationCId,
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.owner.employeeId,
    });
    // beforeC: synchronize actors so the race window is observable.
    const beforeC = await snapshotLocation(prisma, world.locationCId);

    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      "/daily-plan/apply-departure-effects",
      {
        // Execute the next setup or assertion step for this scenario.
        hotelDate: past,
        // Execute the next setup or assertion step for this scenario.
        confirmEntryIds: [entryA.id, entryC.id],
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { applied: number }).applied, 1);

    // entryCAfter: synchronize actors so the race window is observable.
    const entryCAfter = await prisma.dailyPlanEntry.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: entryC.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(entryCAfter.roomEffectsAppliedAt, null);
    // Delivery/replay step for async notification paths.
    assertLocationSnapEqual(
      // Await async work before asserting or releasing locks.
      await snapshotLocation(prisma, world.locationCId),
      // Execute the next setup or assertion step for this scenario.
      beforeC,
      // Execute the next setup or assertion step for this scenario.
      "56b roomC other day",
    );
    // entryAAfter: synchronize actors so the race window is observable.
    const entryAAfter = await prisma.dailyPlanEntry.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: entryA.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(entryAAfter.roomEffectsAppliedAt);
  });
});
