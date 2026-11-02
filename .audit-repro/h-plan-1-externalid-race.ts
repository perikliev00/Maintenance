/**
 * Isolated audit repro: H-PLAN-1
 * Concurrent importDailyPlan with the SAME (source, externalId) + same room/category.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.cwd(), "package.json"));
const apiRoot = process.cwd();
const { PrismaClient, DailyPlanCategory, Occupancy, CleaningStatus } =
  require("@prisma/client");

function imp(rel: string) {
  return import(pathToFileURL(path.join(apiRoot, rel)).href);
}

async function main() {
  const { assertTestDatabase } = await imp("tests/assertTestDatabase.ts");
  const { importDailyPlan } = await imp("src/services/dailyPlan/index.ts");
  const {
    createPlanWorld,
    cleanupPlanWorld,
    cleanupPlanArtifacts,
    prepareRoom,
    cancelActiveTasks,
    hotelTodayYmd,
  } = await imp("tests/plan/fixtures.ts");

  const prisma = new PrismaClient();
  await assertTestDatabase(prisma);

  const world = await createPlanWorld(prisma);
  const today = await hotelTodayYmd();
  const externalId = `audit-hplan1-${world.stamp}-${Date.now()}`;
  const results: unknown[] = [];

  try {
    for (let rep = 1; rep <= 3; rep++) {
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
      await cancelActiveTasks(prisma, world.locationAId, today);

      const ext = `${externalId}-r${rep}`;
      const payload = {
        hotelDate: today,
        sourceLabel: "audit-hplan1",
        entries: [
          {
            buildingCode: world.buildingCode,
            roomNumber: world.roomANumber,
            category: DailyPlanCategory.arrival,
            externalId: ext,
          },
        ],
      };

      const [a, b] = await Promise.all([
        importDailyPlan(payload, world.manager.employeeId),
        importDailyPlan(payload, world.manager.employeeId),
      ]);

      const batches = [a.batch, b.batch].map((batch: {
        createdCount: number;
        skippedCount: number;
        errorCount: number;
        status: string;
        errors: unknown;
      }) => ({
        createdCount: batch.createdCount,
        skippedCount: batch.skippedCount,
        errorCount: batch.errorCount,
        status: batch.status,
        errors: batch.errors ?? [],
      }));
      results.push(...batches);

      const entryCount = await prisma.dailyPlanEntry.count({
        where: { source: "import", externalId: ext },
      });

      const summary = {
        rep,
        entryCount,
        batches,
        totalCreated: batches.reduce((s, x) => s + x.createdCount, 0),
        totalSkipped: batches.reduce((s, x) => s + x.skippedCount, 0),
        totalErrors: batches.reduce((s, x) => s + x.errorCount, 0),
      };
      console.log(JSON.stringify(summary));

      assert.equal(entryCount, 1, "exactly one entry for externalId");
      assert.equal(summary.totalCreated, 1, "exactly one createdCount");
      assert.equal(
        summary.totalErrors,
        0,
        "idempotent race must not report errorCount",
      );
      assert.equal(summary.totalSkipped, 1, "loser must be skippedCount");
    }
    console.log(
      "H-PLAN-1 RESULT: NO_FAILURE — race handled as skip (hypothesis falsified for identical rows)",
    );
  } catch (err) {
    console.error("H-PLAN-1 RESULT: FAILURE_OBSERVED");
    console.error(err);
    console.error("results", JSON.stringify(results, null, 2));
    process.exitCode = 1;
  } finally {
    await cleanupPlanWorld(prisma, world);
    await prisma.$disconnect();
  }
}

main();
