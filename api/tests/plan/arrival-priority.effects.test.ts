/**
 * 54 — arrival / priority plan effects (54).
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
import { createDailyPlanEntry } from "../../src/services/dailyPlan";
import {
  cancelActiveTasks,
  cleanupPlanArtifacts,
  cleanupPlanWorld,
  countActiveTasks,
  createActiveTask,
  createExtraHousekeeper,
  createPlanWorld,
  hotelTodayYmd,
  prepareRoom,
  snapshotLocation,
  type PlanWorld,
  cleanupEmployeeGraph,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

describe("daily plan arrival/priority effects (54 / 54)", () => {
  let world: PlanWorld;
  let today: string;
  let hkA2: Awaited<ReturnType<typeof createExtraHousekeeper>>;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createPlanWorld(prisma);
    hkA2 = await createExtraHousekeeper(prisma, world.stamp, "A2");
    today = await hotelTodayYmd();
  });

  after(async () => {
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

  it("arrival on dirty room creates high-priority task", async () => {
    await prepareRoom(prisma, world.locationAId, {
      occupancy: Occupancy.occupied,
      cleaningStatus: CleaningStatus.dirty,
    });
    await cancelActiveTasks(prisma, world.locationAId, today);

    const result = await createDailyPlanEntry({
      hotelDate: today,
      locationId: world.locationAId,
      category: "arrival",
      createdByEmployeeId: world.owner.employeeId,
    });
    assert.equal(result.effects.task, "created");
    assert.ok(result.effects.cleaningTaskId);
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: result.effects.cleaningTaskId! },
    });
    assert.equal(task.priority, Priority.high);
    const loc = await snapshotLocation(prisma, world.locationAId);
    assert.equal(loc.occupancy, Occupancy.occupied);
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);
  });

  it("arrival bumps existing normal task to high", async () => {
    await prepareRoom(prisma, world.locationAId, {
      occupancy: Occupancy.occupied,
      cleaningStatus: CleaningStatus.dirty,
    });
    await cancelActiveTasks(prisma, world.locationAId, today);
    const existing = await createActiveTask(prisma, {
      locationId: world.locationAId,
      hotelDateYmd: today,
      priority: Priority.normal,
    });

    const result = await createDailyPlanEntry({
      hotelDate: today,
      locationId: world.locationAId,
      category: "arrival",
      createdByEmployeeId: world.owner.employeeId,
    });
    assert.equal(result.effects.task, "bumped");
    assert.equal(result.effects.cleaningTaskId, existing.id);
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: existing.id },
    });
    assert.equal(task.priority, Priority.high);
    assert.equal(
      (await snapshotLocation(prisma, world.locationAId)).occupancy,
      Occupancy.occupied,
    );
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);
  });

  it("arrival on verified_clean skips task", async () => {
    await prepareRoom(prisma, world.locationAId, {
      occupancy: Occupancy.vacant,
      cleaningStatus: CleaningStatus.verified_clean,
      cleaningCycle: 5,
    });
    await cancelActiveTasks(prisma, world.locationAId, today);
    const before = await snapshotLocation(prisma, world.locationAId);

    const result = await createDailyPlanEntry({
      hotelDate: today,
      locationId: world.locationAId,
      category: "arrival",
      createdByEmployeeId: world.owner.employeeId,
    });
    assert.equal(result.effects.task, "skipped");
    assert.equal(result.effects.cleaningTaskId, null);
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 0);
    const after = await snapshotLocation(prisma, world.locationAId);
    assert.equal(after.occupancy, before.occupancy);
    assert.equal(after.cleaningStatus, before.cleaningStatus);
    assert.equal(after.cleaningCycle, before.cleaningCycle);
  });

  it("priority creates urgent task with assignee/shift", async () => {
    await prepareRoom(prisma, world.locationAId, {
      occupancy: Occupancy.occupied,
      cleaningStatus: CleaningStatus.dirty,
    });
    await cancelActiveTasks(prisma, world.locationAId, today);

    const result = await createDailyPlanEntry({
      hotelDate: today,
      locationId: world.locationAId,
      category: "priority",
      assignedEmployeeId: world.hk1.employeeId,
      shiftId: world.shiftId,
      createdByEmployeeId: world.owner.employeeId,
    });
    assert.equal(result.effects.task, "created");
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: result.effects.cleaningTaskId! },
    });
    assert.equal(task.priority, Priority.urgent);
    assert.equal(task.assignedEmployeeId, world.hk1.employeeId);
    assert.equal(task.shiftId, world.shiftId);
    assert.equal(
      (await snapshotLocation(prisma, world.locationAId)).occupancy,
      Occupancy.occupied,
    );
  });

  it("priority bumps high→urgent and preserves assignee/shift", async () => {
    await prepareRoom(prisma, world.locationAId, {
      occupancy: Occupancy.vacant,
      cleaningStatus: CleaningStatus.dirty,
    });
    await cancelActiveTasks(prisma, world.locationAId, today);
    const existing = await createActiveTask(prisma, {
      locationId: world.locationAId,
      hotelDateYmd: today,
      priority: Priority.high,
      assignedEmployeeId: world.hk1.employeeId,
      shiftId: world.shiftId,
    });

    const result = await createDailyPlanEntry({
      hotelDate: today,
      locationId: world.locationAId,
      category: "priority",
      assignedEmployeeId: hkA2.employeeId,
      shiftId: world.shift2Id,
      createdByEmployeeId: world.owner.employeeId,
    });
    assert.equal(result.effects.task, "bumped");
    assert.equal(result.effects.cleaningTaskId, existing.id);
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: existing.id },
    });
    assert.equal(task.priority, Priority.urgent);
    assert.equal(task.assignedEmployeeId, world.hk1.employeeId);
    assert.equal(task.shiftId, world.shiftId);
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);
  });

  it("priority links urgent task without downgrade or overwrite", async () => {
    await prepareRoom(prisma, world.locationAId, {
      occupancy: Occupancy.vacant,
      cleaningStatus: CleaningStatus.dirty,
    });
    await cancelActiveTasks(prisma, world.locationAId, today);
    const existing = await createActiveTask(prisma, {
      locationId: world.locationAId,
      hotelDateYmd: today,
      priority: Priority.urgent,
      assignedEmployeeId: world.hk1.employeeId,
      shiftId: world.shiftId,
    });

    const result = await createDailyPlanEntry({
      hotelDate: today,
      locationId: world.locationAId,
      category: "priority",
      assignedEmployeeId: hkA2.employeeId,
      shiftId: world.shift2Id,
      createdByEmployeeId: world.owner.employeeId,
    });
    assert.equal(result.effects.task, "linked");
    assert.equal(result.effects.cleaningTaskId, existing.id);
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: existing.id },
    });
    assert.equal(task.priority, Priority.urgent);
    assert.equal(task.assignedEmployeeId, world.hk1.employeeId);
    assert.equal(task.shiftId, world.shiftId);
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);
  });
});
