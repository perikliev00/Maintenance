/**
 * GET daily plan is read-only .
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  CleaningStatus,
  Occupancy,
  Priority,
  PrismaClient,
  TaskStatus,
} from "@prisma/client";
import dotenv from "dotenv";
import { withHotelNowForTests } from "../../src/services/hotelTime";
import {
  PLAN_PASSWORD,
  assertLocationSnapEqual,
  cancelActiveTasks,
  cleanupPlanArtifacts,
  cleanupPlanWorld,
  closeServer,
  countActiveTasks,
  createActiveTask,
  createPlanWorld,
  getJson,
  hotelTodayYmd,
  listenApp,
  loginBearer,
  postJson,
  prepareRoom,
  seedDeferredDeparture,
  snapshotEntry,
  snapshotLocation,
  ymdOffset,
  // Shape PlanWorld documents the fixture/response fields this suite touches.
  type PlanWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

const TASK_SNAP_SELECT = {
  id: true,
  status: true,
  priority: true,
  assignedEmployeeId: true,
  shiftId: true,
  cleaningCycle: true,
} as const;

// Shape PlanBody documents the fixture/response fields this suite touches.
type PlanBody = {
  date: string;
  departures: { id: string; category: string }[];
};

// Helper assertEntryInDepartures: assert expected post-condition.
function assertEntryInDepartures(body: unknown, entryId: string, label: string) {
  const plan = body as PlanBody;
  const ids = (plan.departures ?? []).map((e) => e.id);
  assert.ok(
    ids.includes(entryId),
    `${label}: entry ${entryId} missing from departures ${JSON.stringify(ids)}`,
  );
}

// Local helper snapshotTasks used by cases in this file.
async function snapshotTasks(locationId: string) {
  return prisma.cleaningTask.findMany({
    where: { locationId },
    orderBy: { id: "asc" },
    select: TASK_SNAP_SELECT,
  });
}

// Suite: daily plan read-only GET.
describe("daily plan read-only GET", () => {
  let world: PlanWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let ownerToken: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createPlanWorld(prisma);
    ({ server, api } = await listenApp());
    const login = await loginBearer(api, world.owner.email, PLAN_PASSWORD);
    ownerToken = login.token;
  });

  after(async () => {
    if (server) await closeServer(server);
    if (world) await cleanupPlanWorld(prisma, world);
    await prisma.$disconnect();
  });

  // Case: GET with past deferred departure does not apply effects.
  it("GET with past deferred departure does not apply effects", async () => withHotelNowForTests(new Date("2040-05-20T12:00:00Z"), async () => {
    const today = await hotelTodayYmd();
    const past = ymdOffset(today, -3);
    await cleanupPlanArtifacts(prisma, [
      world.locationAId,
      world.locationBId,
      world.locationCId,
      world.archivedLocationId,
    ]);
    await cancelActiveTasks(prisma, world.locationAId, past);

    // entry: seeded entity required before the mutation under test.
    const entry = await seedDeferredDeparture(prisma, {
      hotelDateYmd: past,
      locationId: world.locationAId,
      createdByEmployeeId: world.owner.employeeId,
    });
    const beforeLoc = await snapshotLocation(prisma, world.locationAId);
    const beforeEntry = await snapshotEntry(prisma, entry.id);
    const beforeTasks = await snapshotTasks(world.locationAId);

    const first = await getJson(
      api,
      ownerToken,
      `/daily-plan?hotelDate=${past}`,
    );
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assertEntryInDepartures(first.body, entry.id, "past GET#1");
    assertLocationSnapEqual(
      await snapshotLocation(prisma, world.locationAId),
      beforeLoc,
      "after first GET",
    );
    assert.deepEqual(await snapshotEntry(prisma, entry.id), beforeEntry);

    const second = await getJson(
      api,
      ownerToken,
      `/daily-plan?hotelDate=${past}`,
    );
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assertEntryInDepartures(second.body, entry.id, "past GET#2");
    assertLocationSnapEqual(
      await snapshotLocation(prisma, world.locationAId),
      beforeLoc,
      "after second GET",
    );
    assert.deepEqual(await snapshotEntry(prisma, entry.id), beforeEntry);
    assert.equal(
      (await snapshotEntry(prisma, entry.id)).roomEffectsAppliedAt,
      null,
    );
    assert.deepEqual(await snapshotTasks(world.locationAId), beforeTasks);
  }));

  // Case: GET today pending departure does not apply; apply endpoint does.
  it("GET today pending departure does not apply; apply endpoint does", async () => withHotelNowForTests(new Date("2040-05-20T12:00:00Z"), async () => {
    const today = await hotelTodayYmd();
    await cleanupPlanArtifacts(
      prisma,
      [
        world.locationAId,
        world.locationBId,
        world.locationCId,
        world.archivedLocationId,
      ],
      world.employeeIds,
    );
    await cancelActiveTasks(prisma, world.locationAId, today);

    const cycle = 42;
    await prepareRoom(prisma, world.locationAId, {
      occupancy: Occupancy.occupied,
      cleaningStatus: CleaningStatus.dirty,
      cleaningCycle: cycle,
    });
    const task = await createActiveTask(prisma, {
      locationId: world.locationAId,
      hotelDateYmd: today,
      priority: Priority.normal,
      assignedEmployeeId: world.hk1.employeeId,
      shiftId: world.shiftId,
      cleaningCycle: cycle,
    });

    // Direct pending fixture — not createDailyPlanEntry (which would apply today).
    const entry = await seedDeferredDeparture(prisma, {
      hotelDateYmd: today,
      locationId: world.locationAId,
      createdByEmployeeId: world.owner.employeeId,
      assignedEmployeeId: world.hk1.employeeId,
      shiftId: world.shiftId,
      cleaningTaskId: null,
      prepareOccupiedRoom: false,
      notes: "t-plan-57b today pending",
    });
    // Re-assert room still occupied at known cycle after seed (audits cleared only).
    const locCheck = await snapshotLocation(prisma, world.locationAId);
    assert.equal(locCheck.occupancy, Occupancy.occupied);
    assert.equal(locCheck.cleaningCycle, cycle);

    const beforeLoc = await snapshotLocation(prisma, world.locationAId);
    const beforeEntry = await snapshotEntry(prisma, entry.id);
    const beforeTasks = await snapshotTasks(world.locationAId);
    assert.equal(beforeTasks.length, 1);
    assert.equal(beforeTasks[0]!.id, task.id);
    assert.equal(beforeTasks[0]!.priority, Priority.normal);
    assert.equal(beforeTasks[0]!.assignedEmployeeId, world.hk1.employeeId);
    assert.equal(beforeTasks[0]!.shiftId, world.shiftId);
    assert.equal(beforeTasks[0]!.cleaningCycle, cycle);
    assert.equal(beforeEntry.roomEffectsAppliedAt, null);

    const first = await getJson(
      api,
      ownerToken,
      `/daily-plan?hotelDate=${today}`,
    );
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assertEntryInDepartures(first.body, entry.id, "today GET#1");
    assertLocationSnapEqual(
      await snapshotLocation(prisma, world.locationAId),
      beforeLoc,
      "today after GET#1",
    );
    assert.deepEqual(await snapshotEntry(prisma, entry.id), beforeEntry);
    assert.deepEqual(await snapshotTasks(world.locationAId), beforeTasks);
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);

    const second = await getJson(
      api,
      ownerToken,
      `/daily-plan?hotelDate=${today}`,
    );
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assertEntryInDepartures(second.body, entry.id, "today GET#2");
    assertLocationSnapEqual(
      await snapshotLocation(prisma, world.locationAId),
      beforeLoc,
      "today after GET#2",
    );
    const afterEntry = await snapshotEntry(prisma, entry.id);
    assert.deepEqual(afterEntry, beforeEntry);
    assert.equal(afterEntry.roomEffectsAppliedAt, null);
    assert.deepEqual(await snapshotTasks(world.locationAId), beforeTasks);
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);

    // Positive control: same prep must be appliable via the real apply endpoint.
    // Same-day occupied departure applies without confirmEntryIds.
    const applyRes = await postJson(
      api,
      ownerToken,
      "/daily-plan/apply-departure-effects",
      { hotelDate: today },
    );
    assert.equal(applyRes.status, 200, JSON.stringify(applyRes.body));
    // applied: in-process HTTP server handle for this suite.
    const applied = applyRes.body as {
      applied: number;
      deferred: number;
    };
    assert.equal(applied.applied, 1, JSON.stringify(applyRes.body));
    assert.equal(applied.deferred, 0);

    const stamped = await prisma.dailyPlanEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    assert.ok(stamped.roomEffectsAppliedAt, "apply must stamp roomEffectsAppliedAt");
    const afterLoc = await snapshotLocation(prisma, world.locationAId);
    assert.equal(afterLoc.occupancy, Occupancy.vacant);
    assert.equal(afterLoc.cleaningStatus, CleaningStatus.dirty);
    assert.ok(
      afterLoc.cleaningCycle > cycle,
      `apply should bump cycle from ${cycle}, got ${afterLoc.cleaningCycle}`,
    );
    const linkedTask = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(linkedTask.status, TaskStatus.assigned);
    assert.equal(linkedTask.priority, Priority.high);
    assert.equal(linkedTask.assignedEmployeeId, world.hk1.employeeId);
    assert.equal(linkedTask.shiftId, world.shiftId);
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);
  }));
});
