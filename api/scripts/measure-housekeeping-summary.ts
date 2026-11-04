/**
 * Measurement harness for housekeeping + maintenance analytics (CODE-05 / TD point 6).
 *
 * Two modes (run from the API package):
 *
 * 1. Read-only against whatever DATABASE_URL points at (original behaviour):
 *      npx tsx scripts/measure-housekeeping-summary.ts [--days=7] [--explain]
 *
 * 2. Synthetic volume in the ISOLATED test database (maintenance_p1_test):
 *      node --expose-gc --import tsx scripts/measure-housekeeping-summary.ts \
 *        --seed=500 --days=30 --runs=5 --explain [--out=../docs/testing/data.json]
 *    `--seed=<rooms>` loads tests/preloadIsolatedTestEnv (DATABASE_URL is rewritten to
 *    maintenance_p1_test and asserted), bulk-inserts ~0.85 completed tasks/room/day for
 *    2 × days (current + prior window), sessions, inspections, tickets and reopen
 *    events, measures, then deletes everything it created (unless --keep).
 *    Package alias: `npm run measure:analytics -- --seed=500 --days=30`.
 *    `--keep` leaves the rows (report.seed.prefix); remove later with `--cleanup=<prefix>`.
 *
 * Reported per entry point (getHousekeepingSummary / getMaintenanceSummary, unscoped
 * and assignee-scoped): wall latency (cold + warm runs), Prisma statement count and
 * summed DB time, rows hydrated, JSON payload size, heap/RSS growth.
 *
 * Budgets (see docs/testing/ANALYTICS_AGGREGATION_MEASUREMENT.md) are evaluated for
 * each measured summary; use --enforce to exit non-zero when exceeded.
 *
 * Do not rewrite aggregations to SQL until this harness shows a clear hotspot
 * and result parity for anomaly / rework / timezone semantics is verified.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

/** Budgets for a 30-day window on a 500-room property (~13k tasks / window). */
const BUDGET = {
  warmMedianMs: 2000,
  statements: 30,
  heapDeltaMb: 256,
};

type QueryEvent = { query: string; duration: number };
const queryLog: QueryEvent[] = [];

/** Make every PrismaClient emit query events so the shared singleton can be observed. */
function patchPrismaClientForQueryEvents() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("@prisma/client") as { PrismaClient: new (o?: any) => any };
  const Base = mod.PrismaClient;
  mod.PrismaClient = class extends Base {
    constructor(opts: any = {}) {
      super({ ...opts, log: [{ emit: "event", level: "query" }] });
      (this as any).$on("query", (e: QueryEvent) => queryLog.push(e));
    }
  } as never;
}

/** Deterministic PRNG so repeated seeds have the same shape. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

async function main() {
  const days = Number(argValue("days", "7"));
  const runs = Math.max(1, Number(argValue("runs", "3")));
  const rooms = Number(argValue("seed", "0"));
  const wantExplain = hasFlag("explain");
  const keep = hasFlag("keep");
  const enforce = hasFlag("enforce");
  const outFile = argValue("out", "");
  const cleanupOnly = argValue("cleanup", "") !== "";
  const seeding = rooms > 0 || cleanupOnly;

  if (seeding) await import("../tests/preloadIsolatedTestEnv");
  patchPrismaClientForQueryEvents();
  const { prisma } = await import("../src/db");
  const { getHousekeepingSummary } = await import(
    "../src/services/analytics/housekeepingSummary"
  );
  const { getMaintenanceSummary } = await import(
    "../src/services/analytics/maintenanceSummary"
  );
  const { CatalogStatus, LocationKind } = await import("@prisma/client");

  const cleanupPrefix = argValue("cleanup", "");
  const prefix = cleanupPrefix || `MEAS${Date.now().toString(36)}_`;
  const created = { employees: [] as string[], propertyId: "", buildingId: "" };
  let hkEmployeeId = "";

  async function seed() {
    const { assertTestDatabase } = await import("../tests/assertTestDatabase");
    await assertTestDatabase(prisma);
    const { createEmployeeWithUser } = await import("../tests/fixtures");
    const rnd = mulberry32(20261103);
    const t0 = Date.now();
    const mk = async (n: string, role: "housekeeper" | "manager" | "owner") =>
      createEmployeeWithUser(prisma, {
        employeeNumber: `${prefix}${n}`.slice(0, 32),
        email: `${prefix}${n}@test.local`.toLowerCase(),
        role,
        fullName: `Measure ${n}`,
        password: "x",
      });
    const hks = [] as string[];
    for (let i = 0; i < 25; i++) hks.push((await mk(`hk${i}`, "housekeeper")).employeeId);
    const inspector = (await mk("insp", "manager")).employeeId;
    const reporter = (await mk("own", "owner")).employeeId;
    created.employees.push(...hks, inspector, reporter);
    hkEmployeeId = hks[0]!;

    const property = await prisma.property.create({ data: { name: `${prefix}P` } });
    const building = await prisma.building.create({
      data: { propertyId: property.id, name: `${prefix}B`, code: prefix.slice(0, 12) },
    });
    created.propertyId = property.id;
    created.buildingId = building.id;
    const floorCount = Math.ceil(rooms / 25);
    const floorIds: string[] = [];
    await prisma.floor.createMany({
      data: Array.from({ length: floorCount }, (_, i) => {
        const id = `${prefix}F${i}`;
        floorIds.push(id);
        return { id, buildingId: building.id, number: i + 1, name: `F${i + 1}` };
      }),
    });
    const locIds: string[] = [];
    await prisma.location.createMany({
      data: Array.from({ length: rooms }, (_, i) => {
        const id = `${prefix}L${i}`;
        locIds.push(id);
        return {
          id,
          floorId: floorIds[Math.floor(i / 25)]!,
          number: `${prefix}${String(i).padStart(4, "0")}`,
          kind: i % 20 === 0 ? LocationKind.common_area : LocationKind.room,
          catalogStatus: CatalogStatus.active,
          occupancy: (["vacant", "occupied", "unknown"] as const)[i % 3],
          cleaningStatus: (["verified_clean", "dirty", "pending_inspection"] as const)[i % 3],
        };
      }),
    });

    const now = Date.now();
    const tasks: any[] = [];
    const sessions: any[] = [];
    const inspections: any[] = [];
    let n = 0;
    const tasksPerDay = Math.round(rooms * 0.85);
    for (let d = 0; d < days * 2; d++) {
      for (let k = 0; k < tasksPerDay; k++) {
        const id = `${prefix}T${n++}`;
        const completedAt = new Date(now - d * DAY - Math.floor(rnd() * DAY));
        const hasDue = rnd() > 0.12;
        const dueAt = hasDue ? new Date(completedAt.getTime() + (rnd() - 0.2) * 3_600_000) : null;
        tasks.push({
          id,
          locationId: locIds[Math.floor(rnd() * rooms)]!,
          hotelDate: new Date(completedAt.toISOString().slice(0, 10)),
          serviceType: rnd() > 0.45 ? "stayover" : "departure",
          priority: rnd() > 0.9 ? "high" : "normal",
          dueAt,
          assignedEmployeeId: hks[Math.floor(rnd() * hks.length)],
          status: "completed",
          completedAt,
          cleaningCycle: 0,
        });
        const sessionCount = rnd() > 0.8 ? 2 : 1;
        for (let s = 0; s < sessionCount; s++) {
          const minutes = rnd() > 0.02 ? 12 + rnd() * 40 : 400 + rnd() * 200;
          const finishedAt = new Date(completedAt.getTime() - s * 1_800_000);
          sessions.push({
            id: `${id}S${s}`,
            taskId: id,
            employeeId: tasks[tasks.length - 1].assignedEmployeeId,
            startedAt: new Date(finishedAt.getTime() - minutes * 60000),
            finishedAt,
            status: "completed",
            anomalyFlags: rnd() > 0.99 ? ["clock_skew"] : [],
            startCommandId: randomUUID(),
            completeCommandId: randomUUID(),
          });
        }
        const r = rnd();
        if (r < 0.55 || r > 0.92) {
          // reject (rework) then approve ~8%, plain approve ~55%
          if (r > 0.92) {
            inspections.push({
              id: `${id}I0`,
              taskId: id,
              inspectorEmployeeId: inspector,
              inspectedAt: new Date(completedAt.getTime() - 600_000),
              result: "rejected",
              findings: "rework",
              commandId: randomUUID(),
            });
          }
          inspections.push({
            id: `${id}I1`,
            taskId: id,
            inspectorEmployeeId: inspector,
            inspectedAt: completedAt,
            result: "approved",
            commandId: randomUUID(),
          });
        }
        // else: auto-accepted (no approved inspection)
      }
    }
    const chunk = async <T>(rows: T[], fn: (r: T[]) => Promise<unknown>, size = 4000) => {
      for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
    };
    await chunk(tasks, (data) => prisma.cleaningTask.createMany({ data }));
    await chunk(sessions, (data) => prisma.cleaningSession.createMany({ data }));
    await chunk(inspections, (data) => prisma.inspection.createMany({ data }));

    const ticketsPerDay = Math.max(1, Math.round(rooms * 0.05));
    const tickets: any[] = [];
    const reopens: any[] = [];
    const cats = ["plumbing", "electrical", "hvac", "furniture", "other"];
    let tn = 0;
    for (let d = 0; d < days * 2; d++) {
      for (let k = 0; k < ticketsPerDay; k++) {
        const id = `${prefix}K${tn++}`;
        const openedAt = new Date(now - d * DAY - Math.floor(rnd() * DAY));
        const dueAt = new Date(openedAt.getTime() + 24 * 3_600_000);
        const resolved = rnd() < 0.7;
        const resolvedAt = resolved
          ? new Date(openedAt.getTime() + rnd() * 48 * 3_600_000)
          : null;
        tickets.push({
          id,
          locationId: locIds[Math.floor(rnd() * rooms)],
          title: "Measure",
          categoryKey: cats[Math.floor(rnd() * cats.length)],
          categoryLabelBg: "Друго",
          categoryLabelEn: "Other",
          priority: rnd() > 0.85 ? "high" : "normal",
          blocksRoom: rnd() < 0.1,
          status: resolved ? (rnd() > 0.5 ? "resolved" : "closed") : rnd() > 0.5 ? "new" : "in_progress",
          reportedByEmployeeId: reporter,
          openedAt,
          dueAt,
          resolvedAt,
        });
        if (resolved && rnd() < 0.03) {
          reopens.push({
            id: `${id}R`,
            ticketId: id,
            reopenedAt: new Date(resolvedAt!.getTime() + 3_600_000),
            reopenedByEmployeeId: reporter,
            previousStatus: "resolved",
          });
        }
      }
    }
    await chunk(tickets, (data) => prisma.maintenanceTicket.createMany({ data }));
    await chunk(reopens, (data) => prisma.ticketReopenEvent.createMany({ data }));
    return {
      seedMs: Date.now() - t0,
      rooms,
      tasks: tasks.length,
      sessions: sessions.length,
      inspections: inspections.length,
      tickets: tickets.length,
      reopens: reopens.length,
    };
  }

  async function cleanup() {
    const like = { startsWith: prefix };
    await prisma.ticketReopenEvent.deleteMany({ where: { id: like } });
    await prisma.ticketEvent.deleteMany({ where: { ticketId: like } });
    await prisma.maintenanceTicket.deleteMany({ where: { id: like } });
    await prisma.inspection.deleteMany({ where: { id: like } });
    await prisma.cleaningSession.deleteMany({ where: { id: like } });
    await prisma.cleaningTask.deleteMany({ where: { id: like } });
    await prisma.location.deleteMany({ where: { id: like } });
    await prisma.floor.deleteMany({ where: { id: like } });
    if (created.buildingId) await prisma.building.deleteMany({ where: { id: created.buildingId } });
    if (created.propertyId) await prisma.property.deleteMany({ where: { id: created.propertyId } });
    if (created.employees.length) {
      const { cleanupEmployeeGraph } = await import("../tests/fixtures");
      await cleanupEmployeeGraph(prisma, created.employees);
    }
  }

  const to = new Date();
  const from = new Date(to.getTime() - days * DAY);
  const period = { from, to, now: to };

  async function measure(
    name: string,
    fn: () => Promise<unknown>,
  ) {
    const wall: number[] = [];
    let statements = 0;
    let dbMs = 0;
    let heapDelta = 0;
    let rssDelta = 0;
    let bytes = 0;
    let sample: Record<string, unknown> = {};
    const slow: Array<{ ms: number; sql: string }> = [];
    for (let i = 0; i < runs; i++) {
      (globalThis as any).gc?.();
      const before = process.memoryUsage();
      let peakRss = before.rss;
      let peakHeap = before.heapUsed;
      const timer = setInterval(() => {
        const m = process.memoryUsage();
        peakRss = Math.max(peakRss, m.rss);
        peakHeap = Math.max(peakHeap, m.heapUsed);
      }, 5);
      queryLog.length = 0;
      const t = performance.now();
      let result: any;
      try {
        result = await fn();
      } finally {
        clearInterval(timer);
      }
      wall.push(performance.now() - t);
      const after = process.memoryUsage();
      peakRss = Math.max(peakRss, after.rss);
      peakHeap = Math.max(peakHeap, after.heapUsed);
      if (i === 0 || i === runs - 1) {
        const stmts = queryLog.filter((q) => !/^(BEGIN|COMMIT|ROLLBACK)/i.test(q.query));
        statements = stmts.length;
        dbMs = stmts.reduce((a, q) => a + q.duration, 0);
        slow.length = 0;
        for (const q of [...stmts].sort((a, b) => b.duration - a.duration).slice(0, 3)) {
          slow.push({ ms: q.duration, sql: q.query.replace(/\s+/g, " ").slice(0, 140) });
        }
        bytes = Buffer.byteLength(JSON.stringify(result));
        sample = result.kpis;
      }
      heapDelta = Math.max(heapDelta, peakHeap - before.heapUsed);
      rssDelta = Math.max(rssDelta, peakRss - before.rss);
    }
    const row = {
      name,
      coldMs: Math.round(wall[0]!),
      warmMedianMs: Math.round(median(wall.slice(runs > 1 ? 1 : 0))),
      maxMs: Math.round(Math.max(...wall)),
      statements,
      dbTimeMsSummed: Math.round(dbMs),
      payloadKb: Math.round(bytes / 102.4) / 10,
      heapDeltaMb: mb(heapDelta),
      rssDeltaMb: mb(rssDelta),
      slowestStatements: slow,
      kpis: sample,
    };
    const exceeded: string[] = [];
    if (row.warmMedianMs > BUDGET.warmMedianMs) exceeded.push("latency");
    if (row.statements > BUDGET.statements) exceeded.push("statements");
    if (row.heapDeltaMb > BUDGET.heapDeltaMb) exceeded.push("heap");
    return { ...row, budgetExceeded: exceeded };
  }

  let seedInfo: unknown = null;
  const results: unknown[] = [];
  if (cleanupOnly) {
    // Remove rows left behind by an earlier `--seed=… --keep` run.
    const { assertTestDatabase } = await import("../tests/assertTestDatabase");
    await assertTestDatabase(prisma);
    const emps = await prisma.employee.findMany({
      where: { employeeNumber: { startsWith: prefix } },
      select: { id: true },
    });
    created.employees.push(...emps.map((e) => e.id));
    const b = await prisma.building.findFirst({ where: { name: `${prefix}B` } });
    const p = await prisma.property.findFirst({ where: { name: `${prefix}P` } });
    created.buildingId = b?.id ?? "";
    created.propertyId = p?.id ?? "";
    await cleanup();
    await prisma.$disconnect();
    console.log(`cleaned up ${prefix}`);
    return;
  }
  try {
    if (seeding) {
      seedInfo = { prefix, ...(await seed()) };
    }

    const scoped = hkEmployeeId
      ? {
          taskWhere: { assignedEmployeeId: hkEmployeeId },
          sessionWhere: { employeeId: hkEmployeeId },
          ticketWhere: { reportedByEmployeeId: hkEmployeeId },
        }
      : null;
    const specs: Array<[string, () => Promise<unknown>]> = [
      ["housekeeping unscoped", () => getHousekeepingSummary(period, 3, {})],
      ["maintenance unscoped", () => getMaintenanceSummary(period, 3, {})],
    ];
    if (scoped) {
      specs.push(
        ["housekeeping assignee-scoped", () => getHousekeepingSummary(period, 3, scoped)],
        ["maintenance reporter-scoped", () => getMaintenanceSummary(period, 3, scoped)],
      );
    }
    for (const [name, fn] of specs) {
      try {
        results.push(await measure(name, fn));
      } catch (err) {
        // Record hard failures (e.g. Prisma bind-variable limit) as evidence.
        const message = String((err as Error)?.message ?? err)
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(-1)[0];
        results.push({ name, error: message, budgetExceeded: ["error"] });
      }
    }

    const rowCounts = await prisma.$queryRaw<Array<Record<string, bigint>>>`
      SELECT
        (SELECT count(*) FROM "CleaningTask" WHERE status='completed' AND "completedAt" >= ${from} AND "completedAt" <= ${to}) AS tasks,
        (SELECT count(*) FROM "CleaningSession" s JOIN "CleaningTask" t ON t.id = s."taskId" WHERE s.status='completed' AND t.status='completed' AND t."completedAt" >= ${from} AND t."completedAt" <= ${to}) AS task_sessions,
        (SELECT count(*) FROM "CleaningSession" WHERE status='completed' AND "finishedAt" >= ${from} AND "finishedAt" <= ${to}) AS sessions,
        (SELECT count(*) FROM "Inspection" WHERE "inspectedAt" >= ${from} AND "inspectedAt" <= ${to} AND result='rejected') AS rejected,
        (SELECT count(*) FROM "MaintenanceTicket" WHERE "openedAt" >= ${from} AND "openedAt" <= ${to}) AS tickets,
        (SELECT count(*) FROM "Location" WHERE kind='room' AND "catalogStatus"='active') AS rooms
    `;
    const rows = Object.fromEntries(
      Object.entries(rowCounts[0] ?? {}).map(([k, v]) => [k, Number(v)]),
    );

    let explain: unknown = undefined;
    if (wantExplain) {
      const plan = async (sql: ReturnType<typeof Prisma_sql>) =>
        (await prisma.$queryRaw<Array<{ "QUERY PLAN": string }>>(sql)).map((r) => r["QUERY PLAN"]);
      explain = {
        task: await plan(
          Prisma_sql`EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM "CleaningTask" WHERE status = 'completed' AND "completedAt" >= ${from} AND "completedAt" <= ${to}`,
        ),
        session: await plan(
          Prisma_sql`EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM "CleaningSession" WHERE status = 'completed' AND "finishedAt" >= ${from} AND "finishedAt" <= ${to}`,
        ),
        ticket: await plan(
          Prisma_sql`EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM "MaintenanceTicket" WHERE "openedAt" >= ${from} AND "openedAt" <= ${to}`,
        ),
      };
    }

    const report = {
      generatedAt: new Date().toISOString(),
      node: process.version,
      period: { from: from.toISOString(), to: to.toISOString(), days },
      runs,
      budget: BUDGET,
      seed: seedInfo,
      rowsInWindow: rows,
      results,
      explain,
    };
    const json = JSON.stringify(report, null, 2);
    console.log(json);
    if (outFile) writeFileSync(outFile, json + "\n");
    if (enforce && results.some((r: any) => r.budgetExceeded.length)) {
      process.exitCode = 2;
    }
  } finally {
    if (seeding && !keep) await cleanup();
    await prisma.$disconnect();
  }

  // Tagged template helper kept at the bottom to avoid a top-level Prisma import
  // before the client constructor is patched.
  function Prisma_sql(strings: TemplateStringsArray, ...values: unknown[]) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("@prisma/client").Prisma as typeof import("@prisma/client").Prisma).sql(
      strings,
      ...(values as []),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
