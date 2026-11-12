/**
 * 56 — deferred departure confirm assignee + scope (56).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  CleaningStatus,
  Occupancy,
  Priority,
  PrismaClient,
} from "@prisma/client";
import dotenv from "dotenv";
import {
  cleanupScopeSmokeFixture,
  createScopeSmokeFixture,
  // Shape ScopeSmokeFixture documents the fixture/response fields this suite touches.
  type ScopeSmokeFixture,
} from "../fixtures";
import { ensureDefaultRoleGrants } from "../../src/services/roleGrants";
import {
  PLAN_PASSWORD,
  assertLocationSnapEqual,
  cancelActiveTasks,
  cleanupPlanArtifacts,
  cleanupPlanWorld,
  closeServer,
  countActiveTasks,
  createActiveTask,
  createExtraHousekeeper,
  createPlanWorld,
  hotelTodayYmd,
  listenApp,
  loginBearer,
  postJson,
  prepareRoom,
  seedDeferredDeparture,
  snapshotLocation,
  ymdOffset,
  // Shape PlanWorld documents the fixture/response fields this suite touches.
  type PlanWorld,
  cleanupEmployeeGraph,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: daily plan departure confirm (56 / 56).
describe("daily plan departure confirm (56 / 56)", () => {
  let world: PlanWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let ownerToken: string;
  let today: string;
  let past: string;
  let pastOther: string;
  let hkA2: Awaited<ReturnType<typeof createExtraHousekeeper>>;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await ensureDefaultRoleGrants();
    world = await createPlanWorld(prisma);
    hkA2 = await createExtraHousekeeper(prisma, world.stamp, "CONF2");
    ({ server, api } = await listenApp());
    const login = await loginBearer(api, world.owner.email, PLAN_PASSWORD);
    ownerToken = login.token;
    today = await hotelTodayYmd();
    past = ymdOffset(today, -2);
    pastOther = ymdOffset(today, -5);
  });

  after(async () => {
    if (server) await closeServer(server);
    if (hkA2) await cleanupEmployeeGraph(prisma, [hkA2.employeeId]);
    if (world) await cleanupPlanWorld(prisma, world);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanupPlanArtifacts(prisma, [
      world.locationAId,
      world.locationBId,
      world.locationCId,
      world.archivedLocationId,
    ]);
  });

  // Case: confirm deferred creates task with preselected assignee/shift.
  it("confirm deferred creates task with preselected assignee/shift", async () => {
    await cancelActiveTasks(prisma, world.locationAId, past);
    // entry: seeded entity required before the mutation under test.
    const entry = await seedDeferredDeparture(prisma, {
      hotelDateYmd: past,
      locationId: world.locationAId,
      createdByEmployeeId: world.owner.employeeId,
      assignedEmployeeId: world.hk1.employeeId,
      shiftId: world.shiftId,
    });

    const res = await postJson(
      api,
      ownerToken,
      "/daily-plan/apply-departure-effects",
      { hotelDate: past, confirmEntryIds: [entry.id] },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const body = res.body as {
      applied: number;
      deferred: number;
    };
    assert.equal(body.applied, 1);
    assert.equal(body.deferred, 0);

    const updated = await prisma.dailyPlanEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    assert.ok(updated.roomEffectsAppliedAt);
    assert.ok(updated.cleaningTaskId);
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: updated.cleaningTaskId! },
    });
    assert.equal(task.priority, Priority.high);
    assert.equal(task.assignedEmployeeId, world.hk1.employeeId);
    assert.equal(task.shiftId, world.shiftId);
    const loc = await snapshotLocation(prisma, world.locationAId);
    assert.equal(loc.occupancy, Occupancy.vacant);
    assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
  });

  // Case: confirm links preexisting task and preserves its assignee/shift.
  it("confirm links preexisting task and preserves its assignee/shift", async () => {
    await cancelActiveTasks(prisma, world.locationAId, past);
    // entry: seeded entity required before the mutation under test.
    const entry = await seedDeferredDeparture(prisma, {
      hotelDateYmd: past,
      locationId: world.locationAId,
      createdByEmployeeId: world.owner.employeeId,
      assignedEmployeeId: hkA2.employeeId,
      shiftId: world.shift2Id,
    });
    // preexisting: seeded entity required before the mutation under test.
    const preexisting = await createActiveTask(prisma, {
      locationId: world.locationAId,
      hotelDateYmd: past,
      priority: Priority.normal,
      assignedEmployeeId: world.hk1.employeeId,
      shiftId: world.shiftId,
    });

    const res = await postJson(
      api,
      ownerToken,
      "/daily-plan/apply-departure-effects",
      { hotelDate: past, confirmEntryIds: [entry.id] },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((res.body as { applied: number }).applied, 1);

    const updated = await prisma.dailyPlanEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    assert.equal(updated.cleaningTaskId, preexisting.id);
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: preexisting.id },
    });
    assert.equal(task.priority, Priority.high);
    assert.equal(task.assignedEmployeeId, world.hk1.employeeId);
    assert.equal(task.shiftId, world.shiftId);
    assert.equal(await countActiveTasks(prisma, world.locationAId, past), 1);
  });

  // Case: confirm out-of-scope entry does not change foreign room.
  it("confirm out-of-scope entry does not change foreign room", async () => {
    let fx: ScopeSmokeFixture | null = null;
    try {
      fx = await createScopeSmokeFixture(prisma);
      await prisma.cleaningTask.updateMany({
        where: { locationId: { in: [fx.locAId, fx.locBId] } },
        data: { status: "cancelled" },
      });
      await cleanupPlanArtifacts(prisma, [fx.locAId, fx.locBId]);

      // entryA: seeded entity required before the mutation under test.
      const entryA = await seedDeferredDeparture(prisma, {
        hotelDateYmd: past,
        locationId: fx.locAId,
        createdByEmployeeId: fx.manager.employeeId,
      });
      // entryB: seeded entity required before the mutation under test.
      const entryB = await seedDeferredDeparture(prisma, {
        hotelDateYmd: past,
        locationId: fx.locBId,
        createdByEmployeeId: fx.manager.employeeId,
      });
      const beforeB = await snapshotLocation(prisma, fx.locBId);
      const entryBBefore = await prisma.dailyPlanEntry.findUniqueOrThrow({
        where: { id: entryB.id },
      });

      const { token: supTok } = await loginBearer(
        api,
        fx.supervisorA.email,
        fx.password,
      );

      // Negative: confirm only foreign B — should not apply B (out of scope pending list).
      const neg = await postJson(
        api,
        supTok,
        "/daily-plan/apply-departure-effects",
        { hotelDate: past, confirmEntryIds: [entryB.id] },
      );
      assert.equal(neg.status, 200, JSON.stringify(neg.body));
      assert.equal((neg.body as { applied: number }).applied, 0);
      assertLocationSnapEqual(
        await snapshotLocation(prisma, fx.locBId),
        beforeB,
        "56a locB after foreign confirm",
      );
      const entryBAfter = await prisma.dailyPlanEntry.findUniqueOrThrow({
        where: { id: entryB.id },
      });
      assert.equal(entryBAfter.roomEffectsAppliedAt, null);
      assert.equal(
        entryBAfter.cleaningTaskId,
        entryBBefore.cleaningTaskId,
      );

      // Positive: confirm A in scope.
      const pos = await postJson(
        api,
        supTok,
        "/daily-plan/apply-departure-effects",
        { hotelDate: past, confirmEntryIds: [entryA.id] },
      );
      assert.equal(pos.status, 200, JSON.stringify(pos.body));
      assert.equal((pos.body as { applied: number }).applied, 1);
      const locA = await snapshotLocation(prisma, fx.locAId);
      assert.equal(locA.occupancy, Occupancy.vacant);
      // B still untouched.
      assertLocationSnapEqual(
        await snapshotLocation(prisma, fx.locBId),
        beforeB,
        "56a locB after A confirm",
      );
    } finally {
      if (fx) {
        await cleanupPlanArtifacts(prisma, [fx.locAId, fx.locBId]);
        await cleanupScopeSmokeFixture(prisma, fx);
      }
    }
  });

  // Case: confirm other-day entry on separate room is a no-op for that room.
  it("confirm other-day entry on separate room is a no-op for that room", async () => {
    await cancelActiveTasks(prisma, world.locationAId, past);
    await cancelActiveTasks(prisma, world.locationCId, pastOther);

    // entryA: seeded entity required before the mutation under test.
    const entryA = await seedDeferredDeparture(prisma, {
      hotelDateYmd: past,
      locationId: world.locationAId,
      createdByEmployeeId: world.owner.employeeId,
    });
    // entryC: seeded entity required before the mutation under test.
    const entryC = await seedDeferredDeparture(prisma, {
      hotelDateYmd: pastOther,
      locationId: world.locationCId,
      createdByEmployeeId: world.owner.employeeId,
    });
    const beforeC = await snapshotLocation(prisma, world.locationCId);

    const res = await postJson(
      api,
      ownerToken,
      "/daily-plan/apply-departure-effects",
      {
        hotelDate: past,
        confirmEntryIds: [entryA.id, entryC.id],
      },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((res.body as { applied: number }).applied, 1);

    const entryCAfter = await prisma.dailyPlanEntry.findUniqueOrThrow({
      where: { id: entryC.id },
    });
    assert.equal(entryCAfter.roomEffectsAppliedAt, null);
    assertLocationSnapEqual(
      await snapshotLocation(prisma, world.locationCId),
      beforeC,
      "56b roomC other day",
    );
    const entryAAfter = await prisma.dailyPlanEntry.findUniqueOrThrow({
      where: { id: entryA.id },
    });
    assert.ok(entryAAfter.roomEffectsAppliedAt);
  });
});
