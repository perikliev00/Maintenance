/**
 * 49/50 — import precedence, mixed batch counters, scoped import (50).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  CleaningStatus,
  DailyPlanCategory,
  Occupancy,
  PrismaClient,
} from "@prisma/client";
import dotenv from "dotenv";
import {
  createScopeSmokeFixture,
  cleanupScopeSmokeFixture,
  // Shape ScopeSmokeFixture documents the fixture/response fields this suite touches.
  type ScopeSmokeFixture,
} from "../fixtures";
import { ensureDefaultRoleGrants } from "../../src/services/roleGrants";
import {
  PLAN_PASSWORD,
  assertLocationSnapEqual,
  cleanupPlanArtifacts,
  cleanupPlanWorld,
  countActiveTasks,
  createPlanWorld,
  hotelTodayYmd,
  listenApp,
  loginBearer,
  postJson,
  prepareRoom,
  snapshotEntry,
  snapshotLocation,
  // Shape PlanWorld documents the fixture/response fields this suite touches.
  type PlanWorld,
  closeServer,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: daily plan import lifecycle (50 / 50).
describe("daily plan import lifecycle (50 / 50)", () => {
  let world: PlanWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let ownerToken: string;
  let today: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await ensureDefaultRoleGrants();
    world = await createPlanWorld(prisma);
    ({ server, api } = await listenApp());
    const login = await loginBearer(api, world.owner.email, PLAN_PASSWORD);
    ownerToken = login.token;
    today = await hotelTodayYmd();
  });

  after(async () => {
    if (server) await closeServer(server);
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
    await prepareRoom(prisma, world.locationAId, {
      occupancy: Occupancy.vacant,
      cleaningStatus: CleaningStatus.dirty,
    });
    await prepareRoom(prisma, world.locationBId, {
      occupancy: Occupancy.vacant,
      cleaningStatus: CleaningStatus.dirty,
    });
  });

  // Case: import skips existing manual entry without mutating it.
  it("import skips existing manual entry without mutating it", async () => {
    // createRes: seeded entity required before the mutation under test.
    const createRes = await postJson(api, ownerToken, "/daily-plan", {
      hotelDate: today,
      locationId: world.locationAId,
      category: "arrival",
      notes: "manual-keep-me",
    });
    assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
    const entryId = (createRes.body as { entry: { id: string } }).entry.id;
    const beforeEntry = await snapshotEntry(prisma, entryId);
    const beforeLoc = await snapshotLocation(prisma, world.locationAId);
    const beforeTasks = await countActiveTasks(
      prisma,
      world.locationAId,
      today,
    );

    const importRes = await postJson(api, ownerToken, "/daily-plan/import", {
      hotelDate: today,
      sourceLabel: "t-plan-48",
      entries: [
        {
          buildingCode: world.buildingCode,
          roomNumber: world.roomANumber,
          category: "arrival",
          notes: "should-skip",
          externalId: `t48-skip-${world.stamp}`,
        },
      ],
    });
    assert.equal(importRes.status, 201, JSON.stringify(importRes.body));
    const batch = (importRes.body as { batch: Record<string, number> }).batch;
    assert.equal(batch.createdCount, 0);
    assert.equal(batch.skippedCount, 1);
    assert.equal(batch.errorCount, 0);

    const afterEntry = await snapshotEntry(prisma, entryId);
    assert.deepEqual(afterEntry, beforeEntry);
    assertLocationSnapEqual(
      await snapshotLocation(prisma, world.locationAId),
      beforeLoc,
      "room",
    );
    assert.equal(
      await countActiveTasks(prisma, world.locationAId, today),
      beforeTasks,
    );
    const entryCount = await prisma.dailyPlanEntry.count({
      where: {
        hotelDate: new Date(`${today}T00:00:00.000Z`),
        locationId: world.locationAId,
        category: DailyPlanCategory.arrival,
      },
    });
    assert.equal(entryCount, 1);
  });

  // Case: mixed batch 1 created / 2 skipped / 2 errors.
  it("mixed batch 1 created / 2 skipped / 2 errors", async () => {
    const manual = await postJson(api, ownerToken, "/daily-plan", {
      hotelDate: today,
      locationId: world.locationBId,
      category: "departure",
      notes: "manual-M",
    });
    assert.equal(manual.status, 201, JSON.stringify(manual.body));
    const manualId = (manual.body as { entry: { id: string } }).entry.id;
    const archivedBefore = await snapshotLocation(
      prisma,
      world.archivedLocationId,
    );

    const importRes = await postJson(api, ownerToken, "/daily-plan/import", {
      hotelDate: today,
      sourceLabel: "t-plan-49",
      entries: [
        {
          buildingCode: world.buildingCode,
          roomNumber: world.roomANumber,
          category: "arrival",
          externalId: `t49-v-${world.stamp}`,
        },
        {
          buildingCode: world.buildingCode,
          roomNumber: world.roomBNumber,
          category: "departure",
          externalId: `t49-m-${world.stamp}`,
        },
        {
          buildingCode: world.buildingCode,
          roomNumber: world.roomANumber,
          category: "arrival",
          externalId: `t49-v-dup-${world.stamp}`,
        },
        {
          buildingCode: world.buildingCode,
          roomNumber: "NO-SUCH-ROOM",
          category: "arrival",
          externalId: `t49-missing-${world.stamp}`,
        },
        {
          buildingCode: world.buildingCode,
          roomNumber: world.archivedNumber,
          category: "arrival",
          externalId: `t49-arch-${world.stamp}`,
        },
      ],
    });
    assert.equal(importRes.status, 201, JSON.stringify(importRes.body));
    const batch = (
      importRes.body as {
        batch: {
          totalCount: number;
          createdCount: number;
          skippedCount: number;
          errorCount: number;
          status: string;
          errors: { index: number; reason: string }[];
        };
      }
    ).batch;
    assert.equal(batch.totalCount, 5);
    assert.equal(batch.createdCount, 1);
    assert.equal(batch.skippedCount, 2);
    assert.equal(batch.errorCount, 2);
    assert.equal(batch.status, "partial");
    const byIndex = new Map(batch.errors.map((e) => [e.index, e.reason]));
    assert.equal(byIndex.get(3), "Room not found");
    assert.equal(byIndex.get(4), "Room is archived");

    const importEntries = await prisma.dailyPlanEntry.count({
      where: {
        hotelDate: new Date(`${today}T00:00:00.000Z`),
        locationId: world.locationAId,
        category: DailyPlanCategory.arrival,
        source: "import",
      },
    });
    assert.equal(importEntries, 1);
    const manualStill = await prisma.dailyPlanEntry.findUnique({
      where: { id: manualId },
    });
    assert.ok(manualStill);
    assert.equal(manualStill.source, "manual");
    assertLocationSnapEqual(
      await snapshotLocation(prisma, world.archivedLocationId),
      archivedBefore,
      "archived",
    );
  });

  // Case: scoped supervisor import 1 created / 0 skipped / 1 error.
  it("scoped supervisor import 1 created / 0 skipped / 1 error", async () => {
    let fx: ScopeSmokeFixture | null = null;
    try {
      fx = await createScopeSmokeFixture(prisma);
      const building = await prisma.building.findUniqueOrThrow({
        where: { id: fx.buildingId },
      });
      const locA = await prisma.location.findUniqueOrThrow({
        where: { id: fx.locAId },
      });
      const locB = await prisma.location.findUniqueOrThrow({
        where: { id: fx.locBId },
      });
      await prepareRoom(prisma, fx.locAId, {
        occupancy: Occupancy.vacant,
        cleaningStatus: CleaningStatus.dirty,
      });
      await prepareRoom(prisma, fx.locBId, {
        occupancy: Occupancy.occupied,
        cleaningStatus: CleaningStatus.dirty,
      });
      await cleanupPlanArtifacts(prisma, [fx.locAId, fx.locBId]);
      // Cancel fixture 2099 tasks so they don't confuse active-task counts for today.
      await prisma.cleaningTask.updateMany({
        where: { locationId: { in: [fx.locAId, fx.locBId] } },
        data: { status: "cancelled" },
      });
      const beforeB = await snapshotLocation(prisma, fx.locBId);
      const tasksBBefore = await prisma.cleaningTask.findMany({
        where: { locationId: fx.locBId },
        orderBy: { id: "asc" },
      });

      const { token: supTok } = await loginBearer(
        api,
        fx.supervisorA.email,
        fx.password,
      );
      const importRes = await postJson(api, supTok, "/daily-plan/import", {
        hotelDate: today,
        sourceLabel: "t-plan-50",
        entries: [
          {
            buildingCode: building.code,
            roomNumber: locA.number,
            category: "arrival",
            externalId: `t50-a-${world.stamp}`,
          },
          {
            buildingCode: building.code,
            roomNumber: locB.number,
            category: "arrival",
            externalId: `t50-b-${world.stamp}`,
          },
        ],
      });
      assert.equal(importRes.status, 201, JSON.stringify(importRes.body));
      const batch = (
        importRes.body as {
          batch: {
            totalCount: number;
            createdCount: number;
            skippedCount: number;
            errorCount: number;
            status: string;
            errors: { reason: string }[];
          };
        }
      ).batch;
      assert.equal(batch.totalCount, 2);
      assert.equal(batch.createdCount, 1);
      assert.equal(batch.skippedCount, 0);
      assert.equal(batch.errorCount, 1);
      assert.equal(batch.status, "partial");
      assert.equal(
        batch.errors[0]?.reason,
        "Outside your permitted data scope",
      );

      assertLocationSnapEqual(
        await snapshotLocation(prisma, fx.locBId),
        beforeB,
        "locB",
      );
      const tasksBAfter = await prisma.cleaningTask.findMany({
        where: { locationId: fx.locBId },
        orderBy: { id: "asc" },
      });
      assert.deepEqual(
        tasksBAfter.map((t) => ({
          id: t.id,
          status: t.status,
          priority: t.priority,
          cleaningCycle: t.cleaningCycle,
        })),
        tasksBBefore.map((t) => ({
          id: t.id,
          status: t.status,
          priority: t.priority,
          cleaningCycle: t.cleaningCycle,
        })),
      );
      // createdA: seeded entity required before the mutation under test.
      const createdA = await prisma.dailyPlanEntry.count({
        where: {
          locationId: fx.locAId,
          hotelDate: new Date(`${today}T00:00:00.000Z`),
        },
      });
      assert.equal(createdA, 1);
    } finally {
      if (fx) {
        await cleanupPlanArtifacts(prisma, [fx.locAId, fx.locBId]);
        await cleanupScopeSmokeFixture(prisma, fx);
      }
    }
  });
});
