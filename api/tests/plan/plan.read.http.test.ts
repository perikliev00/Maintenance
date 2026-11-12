/**
 * GET daily plan is read-only .
 */
import assert from "node:assert/strict";
// Import bindings from node:path.
import path from "node:path";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
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
  TaskStatus,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import bindings from ../../src/services/hotelTime.
import { withHotelNowForTests } from "../../src/services/hotelTime";
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
  createPlanWorld,
  // Execute the next setup or assertion step for this scenario.
  getJson,
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
  snapshotEntry,
  // Execute the next setup or assertion step for this scenario.
  snapshotLocation,
  // Pagination step for list/contract coverage.
  ymdOffset,
  // Shape PlanWorld documents the fixture/response fields this suite touches.
  type PlanWorld,
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

// Bind TASK_SNAP_SELECT for later setup or assertions in this scope.
const TASK_SNAP_SELECT = {
  // Execute the next setup or assertion step for this scenario.
  id: true,
  // Fixture field status for the seeded actor/entity.
  status: true,
  // Execute the next setup or assertion step for this scenario.
  priority: true,
  // Execute the next setup or assertion step for this scenario.
  assignedEmployeeId: true,
  // Execute the next setup or assertion step for this scenario.
  shiftId: true,
  // Execute the next setup or assertion step for this scenario.
  cleaningCycle: true,
// Execute the next setup or assertion step for this scenario.
} as const;

// Shape PlanBody documents the fixture/response fields this suite touches.
type PlanBody = {
  // Execute the next setup or assertion step for this scenario.
  date: string;
  // Execute the next setup or assertion step for this scenario.
  departures: { id: string; category: string }[];
};

// Helper assertEntryInDepartures: assert expected post-condition.
function assertEntryInDepartures(body: unknown, entryId: string, label: string) {
  // Bind plan for later setup or assertions in this scope.
  const plan = body as PlanBody;
  // Bind ids for later setup or assertions in this scope.
  const ids = (plan.departures ?? []).map((e) => e.id);
  // Assert the observed value matches the intended post-condition.
  assert.ok(
    // Execute the next setup or assertion step for this scenario.
    ids.includes(entryId),
    // Execute the next setup or assertion step for this scenario.
    `${label}: entry ${entryId} missing from departures ${JSON.stringify(ids)}`,
  );
}

// Local helper snapshotTasks used by cases in this file.
async function snapshotTasks(locationId: string) {
  // Return the arranged value/result to the caller.
  return prisma.cleaningTask.findMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId },
    // Execute the next setup or assertion step for this scenario.
    orderBy: { id: "asc" },
    // SQL fragment used to observe locks or assert DB state.
    select: TASK_SNAP_SELECT,
  });
}

// Suite: daily plan read-only GET.
describe("daily plan read-only GET", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: PlanWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Execute the next setup or assertion step for this scenario.
  let ownerToken: string;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createPlanWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
    // login: synchronize actors so the race window is observable.
    const login = await loginBearer(api, world.owner.email, PLAN_PASSWORD);
    // Session/CSRF step exercising auth lifecycle.
    ownerToken = login.token;
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupPlanWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: GET with past deferred departure does not apply effects.
  it("GET with past deferred departure does not apply effects", async () => withHotelNowForTests(new Date("2040-05-20T12:00:00Z"), async () => {
    // today: synchronize actors so the race window is observable.
    const today = await hotelTodayYmd();
    // Bind past for later setup or assertions in this scope.
    const past = ymdOffset(today, -3);
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
    });
    // beforeLoc: synchronize actors so the race window is observable.
    const beforeLoc = await snapshotLocation(prisma, world.locationAId);
    // beforeEntry: synchronize actors so the race window is observable.
    const beforeEntry = await snapshotEntry(prisma, entry.id);
    // beforeTasks: synchronize actors so the race window is observable.
    const beforeTasks = await snapshotTasks(world.locationAId);

    // first: HTTP response captured for status/body checks.
    const first = await getJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      `/daily-plan?hotelDate=${past}`,
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(first.status, 200, JSON.stringify(first.body));
    // Delivery/replay step for async notification paths.
    assertEntryInDepartures(first.body, entry.id, "past GET#1");
    // Delivery/replay step for async notification paths.
    assertLocationSnapEqual(
      // Await async work before asserting or releasing locks.
      await snapshotLocation(prisma, world.locationAId),
      // Execute the next setup or assertion step for this scenario.
      beforeLoc,
      // Execute the next setup or assertion step for this scenario.
      "after first GET",
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await snapshotEntry(prisma, entry.id), beforeEntry);

    // second: HTTP response captured for status/body checks.
    const second = await getJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      `/daily-plan?hotelDate=${past}`,
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(second.status, 200, JSON.stringify(second.body));
    // Delivery/replay step for async notification paths.
    assertEntryInDepartures(second.body, entry.id, "past GET#2");
    // Delivery/replay step for async notification paths.
    assertLocationSnapEqual(
      // Await async work before asserting or releasing locks.
      await snapshotLocation(prisma, world.locationAId),
      // Execute the next setup or assertion step for this scenario.
      beforeLoc,
      // Execute the next setup or assertion step for this scenario.
      "after second GET",
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await snapshotEntry(prisma, entry.id), beforeEntry);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      (await snapshotEntry(prisma, entry.id)).roomEffectsAppliedAt,
      // Execute the next setup or assertion step for this scenario.
      null,
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await snapshotTasks(world.locationAId), beforeTasks);
  }));

  // Case: GET today pending departure does not apply; apply endpoint does.
  it("GET today pending departure does not apply; apply endpoint does", async () => withHotelNowForTests(new Date("2040-05-20T12:00:00Z"), async () => {
    // today: synchronize actors so the race window is observable.
    const today = await hotelTodayYmd();
    // Await async work before asserting or releasing locks.
    await cleanupPlanArtifacts(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      [
        // Execute the next setup or assertion step for this scenario.
        world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        world.locationBId,
        // Execute the next setup or assertion step for this scenario.
        world.locationCId,
        // Execute the next setup or assertion step for this scenario.
        world.archivedLocationId,
      ],
      // Execute the next setup or assertion step for this scenario.
      world.employeeIds,
    );
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, world.locationAId, today);

    // Bind cycle for later setup or assertions in this scope.
    const cycle = 42;
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, world.locationAId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.occupied,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: cycle,
    });
    // task: seeded entity required before the mutation under test.
    const task = await createActiveTask(prisma, {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      hotelDateYmd: today,
      // Execute the next setup or assertion step for this scenario.
      priority: Priority.normal,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: world.shiftId,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: cycle,
    });

    // Direct pending fixture — not createDailyPlanEntry (which would apply today).
    const entry = await seedDeferredDeparture(prisma, {
      // Execute the next setup or assertion step for this scenario.
      hotelDateYmd: today,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: world.shiftId,
      // Execute the next setup or assertion step for this scenario.
      cleaningTaskId: null,
      // Execute the next setup or assertion step for this scenario.
      prepareOccupiedRoom: false,
      // Execute the next setup or assertion step for this scenario.
      notes: "t-plan-57b today pending",
    });
    // Re-assert room still occupied at known cycle after seed (audits cleared only).
    const locCheck = await snapshotLocation(prisma, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(locCheck.occupancy, Occupancy.occupied);
    // Assert the observed value matches the intended post-condition.
    assert.equal(locCheck.cleaningCycle, cycle);

    // beforeLoc: synchronize actors so the race window is observable.
    const beforeLoc = await snapshotLocation(prisma, world.locationAId);
    // beforeEntry: synchronize actors so the race window is observable.
    const beforeEntry = await snapshotEntry(prisma, entry.id);
    // beforeTasks: synchronize actors so the race window is observable.
    const beforeTasks = await snapshotTasks(world.locationAId);
    // Assert collection size matches the expected post-condition.
    assert.equal(beforeTasks.length, 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(beforeTasks[0]!.id, task.id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(beforeTasks[0]!.priority, Priority.normal);
    // Assert the observed value matches the intended post-condition.
    assert.equal(beforeTasks[0]!.assignedEmployeeId, world.hk1.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(beforeTasks[0]!.shiftId, world.shiftId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(beforeTasks[0]!.cleaningCycle, cycle);
    // Assert the observed value matches the intended post-condition.
    assert.equal(beforeEntry.roomEffectsAppliedAt, null);

    // first: HTTP response captured for status/body checks.
    const first = await getJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      `/daily-plan?hotelDate=${today}`,
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(first.status, 200, JSON.stringify(first.body));
    // Delivery/replay step for async notification paths.
    assertEntryInDepartures(first.body, entry.id, "today GET#1");
    // Delivery/replay step for async notification paths.
    assertLocationSnapEqual(
      // Await async work before asserting or releasing locks.
      await snapshotLocation(prisma, world.locationAId),
      // Execute the next setup or assertion step for this scenario.
      beforeLoc,
      // Execute the next setup or assertion step for this scenario.
      "today after GET#1",
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await snapshotEntry(prisma, entry.id), beforeEntry);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await snapshotTasks(world.locationAId), beforeTasks);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);

    // second: HTTP response captured for status/body checks.
    const second = await getJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      `/daily-plan?hotelDate=${today}`,
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(second.status, 200, JSON.stringify(second.body));
    // Delivery/replay step for async notification paths.
    assertEntryInDepartures(second.body, entry.id, "today GET#2");
    // Delivery/replay step for async notification paths.
    assertLocationSnapEqual(
      // Await async work before asserting or releasing locks.
      await snapshotLocation(prisma, world.locationAId),
      // Execute the next setup or assertion step for this scenario.
      beforeLoc,
      // Execute the next setup or assertion step for this scenario.
      "today after GET#2",
    );
    // afterEntry: synchronize actors so the race window is observable.
    const afterEntry = await snapshotEntry(prisma, entry.id);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(afterEntry, beforeEntry);
    // Assert the observed value matches the intended post-condition.
    assert.equal(afterEntry.roomEffectsAppliedAt, null);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await snapshotTasks(world.locationAId), beforeTasks);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);

    // Positive control: same prep must be appliable via the real apply endpoint.
    // Same-day occupied departure applies without confirmEntryIds.
    const applyRes = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      "/daily-plan/apply-departure-effects",
      // Execute the next setup or assertion step for this scenario.
      { hotelDate: today },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(applyRes.status, 200, JSON.stringify(applyRes.body));
    // applied: in-process HTTP server handle for this suite.
    const applied = applyRes.body as {
      // Execute the next setup or assertion step for this scenario.
      applied: number;
      // Execute the next setup or assertion step for this scenario.
      deferred: number;
    };
    // Assert the observed value matches the intended post-condition.
    assert.equal(applied.applied, 1, JSON.stringify(applyRes.body));
    // Assert the observed value matches the intended post-condition.
    assert.equal(applied.deferred, 0);

    // stamped: unique stamp so parallel runs do not collide.
    const stamped = await prisma.dailyPlanEntry.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: entry.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(stamped.roomEffectsAppliedAt, "apply must stamp roomEffectsAppliedAt");
    // afterLoc: synchronize actors so the race window is observable.
    const afterLoc = await snapshotLocation(prisma, world.locationAId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(afterLoc.occupancy, Occupancy.vacant);
    // Assert the observed value matches the intended post-condition.
    assert.equal(afterLoc.cleaningStatus, CleaningStatus.dirty);
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      afterLoc.cleaningCycle > cycle,
      // Execute the next setup or assertion step for this scenario.
      `apply should bump cycle from ${cycle}, got ${afterLoc.cleaningCycle}`,
    );
    // linkedTask: synchronize actors so the race window is observable.
    const linkedTask = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: task.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(linkedTask.status, TaskStatus.assigned);
    // Assert the observed value matches the intended post-condition.
    assert.equal(linkedTask.priority, Priority.high);
    // Assert the observed value matches the intended post-condition.
    assert.equal(linkedTask.assignedEmployeeId, world.hk1.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(linkedTask.shiftId, world.shiftId);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);
  }));
});
