/**
 * 49/50 — import precedence, mixed batch counters, scoped import (50).
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
  DailyPlanCategory,
  // Execute the next setup or assertion step for this scenario.
  Occupancy,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  createScopeSmokeFixture,
  // Execute the next setup or assertion step for this scenario.
  cleanupScopeSmokeFixture,
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
  cleanupPlanArtifacts,
  // Execute the next setup or assertion step for this scenario.
  cleanupPlanWorld,
  // Execute the next setup or assertion step for this scenario.
  countActiveTasks,
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
  // Execute the next setup or assertion step for this scenario.
  snapshotEntry,
  // Execute the next setup or assertion step for this scenario.
  snapshotLocation,
  // Shape PlanWorld documents the fixture/response fields this suite touches.
  type PlanWorld,
  // Start or stop the in-process API server for this suite.
  closeServer,
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

// Suite: daily plan import lifecycle (50 / 50).
describe("daily plan import lifecycle (50 / 50)", () => {
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

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Await async work before asserting or releasing locks.
    await ensureDefaultRoleGrants();
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createPlanWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
    // login: synchronize actors so the race window is observable.
    const login = await loginBearer(api, world.owner.email, PLAN_PASSWORD);
    // Session/CSRF step exercising auth lifecycle.
    ownerToken = login.token;
    // Await async work before asserting or releasing locks.
    today = await hotelTodayYmd();
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
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, world.locationAId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
    });
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, world.locationBId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
    });
  });

  // Case: import skips existing manual entry without mutating it.
  it("import skips existing manual entry without mutating it", async () => {
    // createRes: seeded entity required before the mutation under test.
    const createRes = await postJson(api, ownerToken, "/daily-plan", {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      category: "arrival",
      // Execute the next setup or assertion step for this scenario.
      notes: "manual-keep-me",
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
    // entryId: unique stamp so parallel runs do not collide.
    const entryId = (createRes.body as { entry: { id: string } }).entry.id;
    // beforeEntry: synchronize actors so the race window is observable.
    const beforeEntry = await snapshotEntry(prisma, entryId);
    // beforeLoc: synchronize actors so the race window is observable.
    const beforeLoc = await snapshotLocation(prisma, world.locationAId);
    // beforeTasks: synchronize actors so the race window is observable.
    const beforeTasks = await countActiveTasks(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      today,
    );

    // importRes: HTTP response captured for status/body checks.
    const importRes = await postJson(api, ownerToken, "/daily-plan/import", {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      sourceLabel: "t-plan-48",
      // Execute the next setup or assertion step for this scenario.
      entries: [
        {
          // Execute the next setup or assertion step for this scenario.
          buildingCode: world.buildingCode,
          // Execute the next setup or assertion step for this scenario.
          roomNumber: world.roomANumber,
          // Execute the next setup or assertion step for this scenario.
          category: "arrival",
          // Execute the next setup or assertion step for this scenario.
          notes: "should-skip",
          // Execute the next setup or assertion step for this scenario.
          externalId: `t48-skip-${world.stamp}`,
        },
      ],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(importRes.status, 201, JSON.stringify(importRes.body));
    // Bind batch for later setup or assertions in this scope.
    const batch = (importRes.body as { batch: Record<string, number> }).batch;
    // Assert the observed value matches the intended post-condition.
    assert.equal(batch.createdCount, 0);
    // Assert the observed value matches the intended post-condition.
    assert.equal(batch.skippedCount, 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(batch.errorCount, 0);

    // afterEntry: synchronize actors so the race window is observable.
    const afterEntry = await snapshotEntry(prisma, entryId);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(afterEntry, beforeEntry);
    // Delivery/replay step for async notification paths.
    assertLocationSnapEqual(
      // Await async work before asserting or releasing locks.
      await snapshotLocation(prisma, world.locationAId),
      // Execute the next setup or assertion step for this scenario.
      beforeLoc,
      // Execute the next setup or assertion step for this scenario.
      "room",
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await countActiveTasks(prisma, world.locationAId, today),
      // Execute the next setup or assertion step for this scenario.
      beforeTasks,
    );
    // entryCount: synchronize actors so the race window is observable.
    const entryCount = await prisma.dailyPlanEntry.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${today}T00:00:00.000Z`),
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        category: DailyPlanCategory.arrival,
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(entryCount, 1);
  });

  // Case: mixed batch 1 created / 2 skipped / 2 errors.
  it("mixed batch 1 created / 2 skipped / 2 errors", async () => {
    // manual: HTTP response captured for status/body checks.
    const manual = await postJson(api, ownerToken, "/daily-plan", {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationBId,
      // Execute the next setup or assertion step for this scenario.
      category: "departure",
      // Execute the next setup or assertion step for this scenario.
      notes: "manual-M",
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(manual.status, 201, JSON.stringify(manual.body));
    // manualId: unique stamp so parallel runs do not collide.
    const manualId = (manual.body as { entry: { id: string } }).entry.id;
    // archivedBefore: synchronize actors so the race window is observable.
    const archivedBefore = await snapshotLocation(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.archivedLocationId,
    );

    // importRes: HTTP response captured for status/body checks.
    const importRes = await postJson(api, ownerToken, "/daily-plan/import", {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      sourceLabel: "t-plan-49",
      // Execute the next setup or assertion step for this scenario.
      entries: [
        {
          // Execute the next setup or assertion step for this scenario.
          buildingCode: world.buildingCode,
          // Execute the next setup or assertion step for this scenario.
          roomNumber: world.roomANumber,
          // Execute the next setup or assertion step for this scenario.
          category: "arrival",
          // Execute the next setup or assertion step for this scenario.
          externalId: `t49-v-${world.stamp}`,
        },
        {
          // Execute the next setup or assertion step for this scenario.
          buildingCode: world.buildingCode,
          // Execute the next setup or assertion step for this scenario.
          roomNumber: world.roomBNumber,
          // Execute the next setup or assertion step for this scenario.
          category: "departure",
          // Execute the next setup or assertion step for this scenario.
          externalId: `t49-m-${world.stamp}`,
        },
        {
          // Execute the next setup or assertion step for this scenario.
          buildingCode: world.buildingCode,
          // Execute the next setup or assertion step for this scenario.
          roomNumber: world.roomANumber,
          // Execute the next setup or assertion step for this scenario.
          category: "arrival",
          // Execute the next setup or assertion step for this scenario.
          externalId: `t49-v-dup-${world.stamp}`,
        },
        {
          // Execute the next setup or assertion step for this scenario.
          buildingCode: world.buildingCode,
          // Execute the next setup or assertion step for this scenario.
          roomNumber: "NO-SUCH-ROOM",
          // Execute the next setup or assertion step for this scenario.
          category: "arrival",
          // Execute the next setup or assertion step for this scenario.
          externalId: `t49-missing-${world.stamp}`,
        },
        {
          // Execute the next setup or assertion step for this scenario.
          buildingCode: world.buildingCode,
          // Execute the next setup or assertion step for this scenario.
          roomNumber: world.archivedNumber,
          // Execute the next setup or assertion step for this scenario.
          category: "arrival",
          // Execute the next setup or assertion step for this scenario.
          externalId: `t49-arch-${world.stamp}`,
        },
      ],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(importRes.status, 201, JSON.stringify(importRes.body));
    // Bind batch for later setup or assertions in this scope.
    const batch = (
      // Execute the next setup or assertion step for this scenario.
      importRes.body as {
        // Execute the next setup or assertion step for this scenario.
        batch: {
          // Execute the next setup or assertion step for this scenario.
          totalCount: number;
          // Execute the next setup or assertion step for this scenario.
          createdCount: number;
          // Execute the next setup or assertion step for this scenario.
          skippedCount: number;
          // Execute the next setup or assertion step for this scenario.
          errorCount: number;
          // Fixture field status for the seeded actor/entity.
          status: string;
          // Execute the next setup or assertion step for this scenario.
          errors: { index: number; reason: string }[];
        };
      }
    // Execute the next setup or assertion step for this scenario.
    ).batch;
    // Assert the observed value matches the intended post-condition.
    assert.equal(batch.totalCount, 5);
    // Assert the observed value matches the intended post-condition.
    assert.equal(batch.createdCount, 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(batch.skippedCount, 2);
    // Assert the observed value matches the intended post-condition.
    assert.equal(batch.errorCount, 2);
    // Assert HTTP status matches the contract for this path.
    assert.equal(batch.status, "partial");
    // Bind byIndex for later setup or assertions in this scope.
    const byIndex = new Map(batch.errors.map((e) => [e.index, e.reason]));
    // Assert the observed value matches the intended post-condition.
    assert.equal(byIndex.get(3), "Room not found");
    // Assert the observed value matches the intended post-condition.
    assert.equal(byIndex.get(4), "Room is archived");

    // importEntries: synchronize actors so the race window is observable.
    const importEntries = await prisma.dailyPlanEntry.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${today}T00:00:00.000Z`),
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        category: DailyPlanCategory.arrival,
        // Execute the next setup or assertion step for this scenario.
        source: "import",
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(importEntries, 1);
    // manualStill: synchronize actors so the race window is observable.
    const manualStill = await prisma.dailyPlanEntry.findUnique({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: manualId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(manualStill);
    // Assert the observed value matches the intended post-condition.
    assert.equal(manualStill.source, "manual");
    // Delivery/replay step for async notification paths.
    assertLocationSnapEqual(
      // Await async work before asserting or releasing locks.
      await snapshotLocation(prisma, world.archivedLocationId),
      // Execute the next setup or assertion step for this scenario.
      archivedBefore,
      // Execute the next setup or assertion step for this scenario.
      "archived",
    );
  });

  // Case: scoped supervisor import 1 created / 0 skipped / 1 error.
  it("scoped supervisor import 1 created / 0 skipped / 1 error", async () => {
    // Execute the next setup or assertion step for this scenario.
    let fx: ScopeSmokeFixture | null = null;
    // Try path where partial failure must not leak suite state.
    try {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      fx = await createScopeSmokeFixture(prisma);
      // building: synchronize actors so the race window is observable.
      const building = await prisma.building.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: fx.buildingId },
      });
      // locA: synchronize actors so the race window is observable.
      const locA = await prisma.location.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: fx.locAId },
      });
      // locB: synchronize actors so the race window is observable.
      const locB = await prisma.location.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: fx.locBId },
      });
      // Await async work before asserting or releasing locks.
      await prepareRoom(prisma, fx.locAId, {
        // Execute the next setup or assertion step for this scenario.
        occupancy: Occupancy.vacant,
        // Execute the next setup or assertion step for this scenario.
        cleaningStatus: CleaningStatus.dirty,
      });
      // Await async work before asserting or releasing locks.
      await prepareRoom(prisma, fx.locBId, {
        // Execute the next setup or assertion step for this scenario.
        occupancy: Occupancy.occupied,
        // Execute the next setup or assertion step for this scenario.
        cleaningStatus: CleaningStatus.dirty,
      });
      // Await async work before asserting or releasing locks.
      await cleanupPlanArtifacts(prisma, [fx.locAId, fx.locBId]);
      // Cancel fixture 2099 tasks so they don't confuse active-task counts for today.
      await prisma.cleaningTask.updateMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { locationId: { in: [fx.locAId, fx.locBId] } },
        // Execute the next setup or assertion step for this scenario.
        data: { status: "cancelled" },
      });
      // beforeB: synchronize actors so the race window is observable.
      const beforeB = await snapshotLocation(prisma, fx.locBId);
      // tasksBBefore: synchronize actors so the race window is observable.
      const tasksBBefore = await prisma.cleaningTask.findMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { locationId: fx.locBId },
        // Execute the next setup or assertion step for this scenario.
        orderBy: { id: "asc" },
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
      // importRes: HTTP response captured for status/body checks.
      const importRes = await postJson(api, supTok, "/daily-plan/import", {
        // Execute the next setup or assertion step for this scenario.
        hotelDate: today,
        // Execute the next setup or assertion step for this scenario.
        sourceLabel: "t-plan-50",
        // Execute the next setup or assertion step for this scenario.
        entries: [
          {
            // Execute the next setup or assertion step for this scenario.
            buildingCode: building.code,
            // Execute the next setup or assertion step for this scenario.
            roomNumber: locA.number,
            // Execute the next setup or assertion step for this scenario.
            category: "arrival",
            // Execute the next setup or assertion step for this scenario.
            externalId: `t50-a-${world.stamp}`,
          },
          {
            // Execute the next setup or assertion step for this scenario.
            buildingCode: building.code,
            // Execute the next setup or assertion step for this scenario.
            roomNumber: locB.number,
            // Execute the next setup or assertion step for this scenario.
            category: "arrival",
            // Execute the next setup or assertion step for this scenario.
            externalId: `t50-b-${world.stamp}`,
          },
        ],
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(importRes.status, 201, JSON.stringify(importRes.body));
      // Bind batch for later setup or assertions in this scope.
      const batch = (
        // Execute the next setup or assertion step for this scenario.
        importRes.body as {
          // Execute the next setup or assertion step for this scenario.
          batch: {
            // Execute the next setup or assertion step for this scenario.
            totalCount: number;
            // Execute the next setup or assertion step for this scenario.
            createdCount: number;
            // Execute the next setup or assertion step for this scenario.
            skippedCount: number;
            // Execute the next setup or assertion step for this scenario.
            errorCount: number;
            // Fixture field status for the seeded actor/entity.
            status: string;
            // Execute the next setup or assertion step for this scenario.
            errors: { reason: string }[];
          };
        }
      // Execute the next setup or assertion step for this scenario.
      ).batch;
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.totalCount, 2);
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.createdCount, 1);
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.skippedCount, 0);
      // Assert the observed value matches the intended post-condition.
      assert.equal(batch.errorCount, 1);
      // Assert HTTP status matches the contract for this path.
      assert.equal(batch.status, "partial");
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        batch.errors[0]?.reason,
        // Execute the next setup or assertion step for this scenario.
        "Outside your permitted data scope",
      );

      // Delivery/replay step for async notification paths.
      assertLocationSnapEqual(
        // Await async work before asserting or releasing locks.
        await snapshotLocation(prisma, fx.locBId),
        // Execute the next setup or assertion step for this scenario.
        beforeB,
        // Execute the next setup or assertion step for this scenario.
        "locB",
      );
      // tasksBAfter: synchronize actors so the race window is observable.
      const tasksBAfter = await prisma.cleaningTask.findMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { locationId: fx.locBId },
        // Execute the next setup or assertion step for this scenario.
        orderBy: { id: "asc" },
      });
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(
        // Execute the next setup or assertion step for this scenario.
        tasksBAfter.map((t) => ({
          // Execute the next setup or assertion step for this scenario.
          id: t.id,
          // Fixture field status for the seeded actor/entity.
          status: t.status,
          // Execute the next setup or assertion step for this scenario.
          priority: t.priority,
          // Execute the next setup or assertion step for this scenario.
          cleaningCycle: t.cleaningCycle,
        })),
        // Execute the next setup or assertion step for this scenario.
        tasksBBefore.map((t) => ({
          // Execute the next setup or assertion step for this scenario.
          id: t.id,
          // Fixture field status for the seeded actor/entity.
          status: t.status,
          // Execute the next setup or assertion step for this scenario.
          priority: t.priority,
          // Execute the next setup or assertion step for this scenario.
          cleaningCycle: t.cleaningCycle,
        })),
      );
      // createdA: seeded entity required before the mutation under test.
      const createdA = await prisma.dailyPlanEntry.count({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          locationId: fx.locAId,
          // Execute the next setup or assertion step for this scenario.
          hotelDate: new Date(`${today}T00:00:00.000Z`),
        },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(createdA, 1);
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
});
