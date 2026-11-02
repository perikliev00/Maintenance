/**
 * Measurement harness for housekeeping analytics (TD point 6).
 *
 * Usage (API package, with DATABASE_URL pointing at a populated DB):
 *   npx tsx scripts/measure-housekeeping-summary.ts [--days=7] [--explain]
 *
 * Prints wall-clock duration for getHousekeepingSummary. With --explain,
 * also runs EXPLAIN (ANALYZE, BUFFERS) on the heaviest findMany-shaped queries
 * (completed tasks + completed sessions) for the same period window.
 *
 * Do not rewrite aggregations to SQL until this harness shows a clear hotspot
 * and result parity for anomaly / rework / timezone semantics is verified.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { getHousekeepingSummary } from "../src/services/analytics/housekeepingSummary";

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

async function main() {
  const days = Number(argValue("days", "7"));
  const wantExplain = process.argv.includes("--explain");
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const period = { from, to, now: to };

  const t0 = performance.now();
  const summary = await getHousekeepingSummary(period, 3, {});
  const ms = performance.now() - t0;

  console.log(
    JSON.stringify(
      {
        period: { from: from.toISOString(), to: to.toISOString(), days },
        durationMs: Math.round(ms),
        cleanedTasks: summary.kpis.cleanedTasks,
        completedSessions: summary.kpis.completedSessions,
        riskRooms: summary.kpis.riskRooms,
      },
      null,
      2,
    ),
  );

  if (!wantExplain) {
    console.log(
      "Tip: pass --explain to run EXPLAIN (ANALYZE, BUFFERS) on hot queries.",
    );
    return;
  }

  const taskExplain = await prisma.$queryRaw<Array<{ "QUERY PLAN": unknown }>>`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id FROM "CleaningTask"
    WHERE status = 'completed'
      AND "completedAt" >= ${from}
      AND "completedAt" <= ${to}
  `;
  const sessionExplain = await prisma.$queryRaw<
    Array<{ "QUERY PLAN": unknown }>
  >`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id FROM "CleaningSession"
    WHERE status = 'completed'
      AND "finishedAt" >= ${from}
      AND "finishedAt" <= ${to}
  `;

  console.log("--- EXPLAIN CleaningTask (completed in period) ---");
  console.log(taskExplain);
  console.log("--- EXPLAIN CleaningSession (completed in period) ---");
  console.log(sessionExplain);
  void Prisma;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
