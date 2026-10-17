/**
 * T-PLAN-51 — concurrent create∥import with Location FOR UPDATE (P1-51).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  CleaningStatus,
  DailyPlanCategory,
  Occupancy,
  Priority,
  PrismaClient,
} from "@prisma/client";
import dotenv from "dotenv";
import { AppError } from "../../src/errors";
import {
  createDailyPlanEntry,
  importDailyPlan,
} from "../../src/services/dailyPlan";
import {
  PLAN_CONFLICT_MESSAGE,
  cancelActiveTasks,
  cleanupPlanArtifacts,
  cleanupPlanWorld,
  countActiveTasks,
  createActiveTask,
  createPlanWorld,
  hotelTodayYmd,
  prepareRoom,
  runWhileRowLockedBoth,
  snapshotLocation,
  type PlanWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

function isConflict(err: unknown): boolean {
  return (
    err instanceof AppError &&
    err.status === 409 &&
    err.code === "conflict" &&
    err.message === PLAN_CONFLICT_MESSAGE
  );
}

describe("daily plan create/import race (T-PLAN-51 / P1-51)", () => {
  let world: PlanWorld;
  let today: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createPlanWorld(prisma);
    today = await hotelTodayYmd();
  });

  after(async () => {
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

  it("T-PLAN-51 serial: manual then import skips", async () => {
    await prepareRoom(prisma, world.locationAId, {
      occupancy: Occupancy.vacant,
      cleaningStatus: CleaningStatus.dirty,
    });
    await cancelActiveTasks(prisma, world.locationAId, today);
    await createDailyPlanEntry({
      hotelDate: today,
      locationId: world.locationAId,
      category: "arrival",
      createdByEmployeeId: world.owner.employeeId,
    });
    const imp = await importDailyPlan(
      {
        hotelDate: today,
        sourceLabel: "t51-serial-mi",
        entries: [
          {
            buildingCode: world.buildingCode,
            roomNumber: world.roomANumber,
            category: DailyPlanCategory.arrival,
            externalId: `t51-mi-${world.stamp}`,
          },
        ],
      },
      world.owner.employeeId,
    );
    assert.equal(imp.batch.createdCount, 0);
    assert.equal(imp.batch.skippedCount, 1);
    assert.equal(imp.batch.errorCount, 0);
  });

  it("T-PLAN-51 serial: import then manual → 409", async () => {
    await prepareRoom(prisma, world.locationBId, {
      occupancy: Occupancy.vacant,
      cleaningStatus: CleaningStatus.dirty,
    });
    await cancelActiveTasks(prisma, world.locationBId, today);
    await importDailyPlan(
      {
        hotelDate: today,
        sourceLabel: "t51-serial-im",
        entries: [
          {
            buildingCode: world.buildingCode,
            roomNumber: world.roomBNumber,
            category: DailyPlanCategory.arrival,
            externalId: `t51-im-${world.stamp}`,
          },
        ],
      },
      world.owner.employeeId,
    );
    await assert.rejects(
      () =>
        createDailyPlanEntry({
          hotelDate: today,
          locationId: world.locationBId,
          category: "arrival",
          createdByEmployeeId: world.owner.employeeId,
        }),
      (err: unknown) => isConflict(err),
    );
  });

  it("T-PLAN-51a: concurrent arrival create∥import (no prior task)", async () => {
    await prepareRoom(prisma, world.locationAId, {
      occupancy: Occupancy.vacant,
      cleaningStatus: CleaningStatus.dirty,
      cleaningCycle: 10,
    });
    await cancelActiveTasks(prisma, world.locationAId, today);
    const c0 = (await snapshotLocation(prisma, world.locationAId))
      .cleaningCycle;

    const { resultA, resultB } = await runWhileRowLockedBoth({
      prisma,
      locationId: world.locationAId,
      startA: () =>
        createDailyPlanEntry({
          hotelDate: today,
          locationId: world.locationAId,
          category: "arrival",
          createdByEmployeeId: world.owner.employeeId,
        }),
      startB: () =>
        importDailyPlan(
          {
            hotelDate: today,
            sourceLabel: "t51a-race",
            entries: [
              {
                buildingCode: world.buildingCode,
                roomNumber: world.roomANumber,
                category: DailyPlanCategory.arrival,
                externalId: `t51a-${world.stamp}`,
              },
            ],
          },
          world.owner.employeeId,
        ),
    });

    const createOk = resultA.status === "fulfilled";
    const createConflict =
      resultA.status === "rejected" && isConflict(resultA.reason);
    assert.ok(
      createOk || createConflict,
      `create outcome unexpected: ${JSON.stringify(resultA)}`,
    );

    assert.equal(resultB.status, "fulfilled", JSON.stringify(resultB));
    const batch = (
      resultB as PromiseFulfilledResult<
        Awaited<ReturnType<typeof importDailyPlan>>
      >
    ).value.batch;

    if (createOk) {
      assert.equal(batch.createdCount, 0);
      assert.equal(batch.skippedCount, 1);
      assert.equal(batch.errorCount, 0);
    } else {
      assert.equal(batch.createdCount, 1);
      assert.equal(batch.skippedCount, 0);
      assert.equal(batch.errorCount, 0);
    }

    const entries = await prisma.dailyPlanEntry.count({
      where: {
        hotelDate: new Date(`${today}T00:00:00.000Z`),
        locationId: world.locationAId,
        category: DailyPlanCategory.arrival,
      },
    });
    assert.equal(entries, 1);
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);
    const loc = await snapshotLocation(prisma, world.locationAId);
    assert.equal(loc.cleaningCycle, c0 + 1);
    assert.equal(loc.occupancy, Occupancy.vacant);
  });

  it("T-PLAN-51b: concurrent departure create∥import with preexisting task", async () => {
    await prepareRoom(prisma, world.locationAId, {
      occupancy: Occupancy.vacant,
      cleaningStatus: CleaningStatus.dirty,
      cleaningCycle: 20,
    });
    await cancelActiveTasks(prisma, world.locationAId, today);
    const preexisting = await createActiveTask(prisma, {
      locationId: world.locationAId,
      hotelDateYmd: today,
      priority: Priority.normal,
    });
    const c0 = (await snapshotLocation(prisma, world.locationAId))
      .cleaningCycle;

    const { resultA, resultB } = await runWhileRowLockedBoth({
      prisma,
      locationId: world.locationAId,
      startA: () =>
        createDailyPlanEntry({
          hotelDate: today,
          locationId: world.locationAId,
          category: "departure",
          createdByEmployeeId: world.owner.employeeId,
        }),
      startB: () =>
        importDailyPlan(
          {
            hotelDate: today,
            sourceLabel: "t51b-race",
            entries: [
              {
                buildingCode: world.buildingCode,
                roomNumber: world.roomANumber,
                category: DailyPlanCategory.departure,
                externalId: `t51b-${world.stamp}`,
              },
            ],
          },
          world.owner.employeeId,
        ),
    });

    const createOk = resultA.status === "fulfilled";
    const createConflict =
      resultA.status === "rejected" && isConflict(resultA.reason);
    assert.ok(
      createOk || createConflict,
      `create outcome unexpected: ${JSON.stringify(resultA)}`,
    );
    assert.equal(resultB.status, "fulfilled", JSON.stringify(resultB));
    const batch = (
      resultB as PromiseFulfilledResult<
        Awaited<ReturnType<typeof importDailyPlan>>
      >
    ).value.batch;

    if (createOk) {
      assert.equal(batch.createdCount, 0);
      assert.equal(batch.skippedCount, 1);
      assert.equal(batch.errorCount, 0);
    } else {
      assert.equal(batch.createdCount, 1);
      assert.equal(batch.skippedCount, 0);
      assert.equal(batch.errorCount, 0);
    }

    const entries = await prisma.dailyPlanEntry.count({
      where: {
        hotelDate: new Date(`${today}T00:00:00.000Z`),
        locationId: world.locationAId,
        category: DailyPlanCategory.departure,
      },
    });
    assert.equal(entries, 1);
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 1);
    const task = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: preexisting.id },
    });
    assert.equal(task.priority, Priority.high);
    const loc = await snapshotLocation(prisma, world.locationAId);
    assert.equal(loc.cleaningCycle, c0 + 1);
    assert.equal(loc.occupancy, Occupancy.vacant);
  });
});
