/**
 * Catalog pagination performance on realistic volumes (1k / 10k).
 * Separates index presence/usability from result, pagination, and latency.
 * 100k is opt-in via LOCATIONS_PERF_100K=1 (slow; skipped by default).
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { CatalogStatus, LocationKind, PrismaClient } from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  catalogOrderBy,
  // Execute the next setup or assertion step for this scenario.
  listLocationsCatalog,
  // Execute the next setup or assertion step for this scenario.
  locationInclude,
  // Execute the next setup or assertion step for this scenario.
  resolveCatalogListWhere,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/locations";
// Import bindings from ./explainCatalogPrisma.
import { explainPrismaLocationFindMany } from "./explainCatalogPrisma";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();
// Bind PREFIX for later setup or assertions in this scope.
const PREFIX = `PERFLOC_${Date.now().toString(36)}_`;

// Shape PerfWorld documents the fixture/response fields this suite touches.
type PerfWorld = {
  // Execute the next setup or assertion step for this scenario.
  propertyId: string;
  // Execute the next setup or assertion step for this scenario.
  buildingId: string;
  // Execute the next setup or assertion step for this scenario.
  floorId: string;
};

// Helper seedLocations: arrange fixture data for the case.
async function seedLocations(
  // Execute the next setup or assertion step for this scenario.
  world: PerfWorld,
  // Execute the next setup or assertion step for this scenario.
  count: number,
  // Execute the next setup or assertion step for this scenario.
  startIndex = 0,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Bind batch for later setup or assertions in this scope.
  const batch = 500;
  // Iterate to cover variants or wait until a condition holds.
  for (let offset = 0; offset < count; offset += batch) {
    // Bind n for later setup or assertions in this scope.
    const n = Math.min(batch, count - offset);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await prisma.location.createMany({
      // Execute the next setup or assertion step for this scenario.
      data: Array.from({ length: n }, (_, i) => {
        // Bind idx for later setup or assertions in this scope.
        const idx = startIndex + offset + i;
        // Return the arranged value/result to the caller.
        return {
          // Execute the next setup or assertion step for this scenario.
          floorId: world.floorId,
          // Execute the next setup or assertion step for this scenario.
          number: `${PREFIX}${String(idx).padStart(6, "0")}`,
          // Execute the next setup or assertion step for this scenario.
          kind: idx % 7 === 0 ? LocationKind.common_area : LocationKind.room,
          // Execute the next setup or assertion step for this scenario.
          catalogStatus: CatalogStatus.active,
        };
      }),
      // Execute the next setup or assertion step for this scenario.
      skipDuplicates: true,
    });
  }
}

// Local helper cleanup used by cases in this file.
async function cleanup(world: PerfWorld | null): Promise<void> {
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!world) return;
  // Await async work before asserting or releasing locks.
  await prisma.location.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { floorId: world.floorId, number: { startsWith: PREFIX } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.floor.deleteMany({ where: { id: world.floorId } });
  // Await async work before asserting or releasing locks.
  await prisma.building.deleteMany({ where: { id: world.buildingId } });
  // Await async work before asserting or releasing locks.
  await prisma.property.deleteMany({ where: { id: world.propertyId } });
}

/**
 * EXPLAIN the real Prisma findMany SQL that listLocationsCatalog emits
 * (same where / include / orderBy / skip / take).
 */
async function explainPagedCatalog(
  // Execute the next setup or assertion step for this scenario.
  q: string | undefined,
  // Execute the next setup or assertion step for this scenario.
  pageSize: number,
// Execute the next setup or assertion step for this scenario.
): Promise<string> {
  // where: synchronize actors so the race window is observable.
  const where = await resolveCatalogListWhere({
    // Execute the next setup or assertion step for this scenario.
    includeArchived: false,
    q,
  });
  // Return the arranged value/result to the caller.
  return explainPrismaLocationFindMany({
    // SQL fragment used to observe locks or assert DB state.
    where,
    // Execute the next setup or assertion step for this scenario.
    include: locationInclude,
    // Execute the next setup or assertion step for this scenario.
    orderBy: catalogOrderBy,
    // Execute the next setup or assertion step for this scenario.
    skip: 0,
    // Execute the next setup or assertion step for this scenario.
    take: pageSize,
  });
}

// Local helper countNumberHits used by cases in this file.
async function countNumberHits(q: string): Promise<number> {
  // Return the arranged value/result to the caller.
  return prisma.location.count({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      catalogStatus: CatalogStatus.active,
      // Execute the next setup or assertion step for this scenario.
      number: { contains: q, mode: "insensitive" },
    },
  });
}

/** Assert the migration-backed GIN trgm index exists with the expected ops. */
async function assertNumberTrgmIndexPresent(): Promise<void> {
  // rows: synchronize actors so the race window is observable.
  const rows = await prisma.$queryRawUnsafe<
    // Execute the next setup or assertion step for this scenario.
    Array<{ indexname: string; indexdef: string }>
  // Execute the next setup or assertion step for this scenario.
  >(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = ANY (current_schemas(false))
      AND tablename = 'Location'
      AND indexname = 'Location_number_trgm_idx'
  `);
  // Assert collection size matches the expected post-condition.
  assert.equal(rows.length, 1, "Location_number_trgm_idx must exist");
  // Assert the observed value matches the intended post-condition.
  assert.match(
    // Execute the next setup or assertion step for this scenario.
    rows[0]!.indexdef,
    // Execute the next setup or assertion step for this scenario.
    /USING gin/i,
    // Execute the next setup or assertion step for this scenario.
    `expected GIN index, got: ${rows[0]!.indexdef}`,
  );
  // Assert the observed value matches the intended post-condition.
  assert.match(
    // Execute the next setup or assertion step for this scenario.
    rows[0]!.indexdef,
    // Execute the next setup or assertion step for this scenario.
    /gin_trgm_ops/i,
    // Execute the next setup or assertion step for this scenario.
    `expected gin_trgm_ops, got: ${rows[0]!.indexdef}`,
  );
}

/**
 * Prove the GIN trigram index can serve selective number ILIKE.
 *
 * enable_seqscan=off is a usability probe only — at ~10k rows the default
 * planner often Seq Scans the production catalog query in a few ms, which is
 * not evidence the index is missing.
 *
 * Probe shape is number-only (no catalogStatus). The production where clause
 * also filters catalogStatus, and with enable_seqscan=off PostgreSQL may still
 * pick Location_kind_catalogStatus_idx (Bitmap Index Scan + ILIKE Filter)
 * because that index remains legal. A competing btree must not decide whether
 * gin_trgm_ops is usable. Number-only ILIKE '%…%' with seqscan disabled has no
 * useful non-trgm plan: btree on number cannot supply an Index Cond for a
 * leading-wildcard pattern, so a missing/wrong trgm index falls back to Seq
 * Scan and fails this assertion.
 */
async function assertNumberTrgmIndexUsable(selectiveQ: string): Promise<void> {
  // Shared Prisma client bound to the isolated test database.
  const probe = new PrismaClient();
  // Try path where partial failure must not leak suite state.
  try {
    // Await async work before asserting or releasing locks.
    await probe.$connect();
    // Await async work before asserting or releasing locks.
    await probe.$transaction(async (tx) => {
      // Await async work before asserting or releasing locks.
      await tx.$executeRawUnsafe(`SET LOCAL enable_seqscan = off`);
      // Prefer bitmap paths (GIN's natural access); btree index scans cannot
      // apply leading-wildcard ILIKE as an Index Cond anyway.
      await tx.$executeRawUnsafe(`SET LOCAL enable_indexscan = off`);
      // Bind escaped for later setup or assertions in this scope.
      const escaped = selectiveQ.replace(/'/g, "''");
      // rows: synchronize actors so the race window is observable.
      const rows = await tx.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
        // Execute the next setup or assertion step for this scenario.
        `EXPLAIN (FORMAT TEXT)
         SELECT id FROM "Location"
         WHERE "number" ILIKE '%${escaped}%'
         LIMIT 25`,
      );
      // Bind text for later setup or assertions in this scope.
      const text = rows.map((r) => r["QUERY PLAN"]).join("\n");
      // Assert the observed value matches the intended post-condition.
      assert.match(
        // Execute the next setup or assertion step for this scenario.
        text,
        // Execute the next setup or assertion step for this scenario.
        /Location_number_trgm_idx/i,
        // Execute the next setup or assertion step for this scenario.
        `number-only ILIKE probe (seqscan/indexscan off) must select Location_number_trgm_idx\n${text}`,
      );
      // Assert the observed value matches the intended post-condition.
      assert.match(
        // Execute the next setup or assertion step for this scenario.
        text,
        // Execute the next setup or assertion step for this scenario.
        /Index Cond:\s*\(?number ~~\*/i,
        // Execute the next setup or assertion step for this scenario.
        `trgm usability probe must apply ILIKE via Index Cond, not a post-filter\n${text}`,
      );
    });
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Disconnect Prisma so the pool does not leak across suites.
    await probe.$disconnect();
  }
}

// Suite: locations catalog performance.
describe("locations catalog performance", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: PerfWorld | null = null;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // property: seeded entity required before the mutation under test.
    const property = await prisma.property.create({
      // Execute the next setup or assertion step for this scenario.
      data: { name: `${PREFIX}property` },
    });
    // building: seeded entity required before the mutation under test.
    const building = await prisma.building.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        propertyId: property.id,
        // Fixture field name for the seeded actor/entity.
        name: `${PREFIX}building`,
        // Execute the next setup or assertion step for this scenario.
        code: `PB${Date.now().toString(36)}`.slice(0, 16),
      },
    });
    // floor: seeded entity required before the mutation under test.
    const floor = await prisma.floor.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        buildingId: building.id,
        // Execute the next setup or assertion step for this scenario.
        number: 1,
        // Fixture field name for the seeded actor/entity.
        name: `${PREFIX}floor`,
      },
    });
    // Execute the next setup or assertion step for this scenario.
    world = {
      // Execute the next setup or assertion step for this scenario.
      propertyId: property.id,
      // Execute the next setup or assertion step for this scenario.
      buildingId: building.id,
      // Execute the next setup or assertion step for this scenario.
      floorId: floor.id,
    };
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Await async work before asserting or releasing locks.
    await cleanup(world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: 1_000 locations: paged list returns ≤ pageSize rows with plan evidence.
  it("1_000 locations: paged list returns ≤ pageSize rows with plan evidence", async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(world);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await seedLocations(world, 1_000);

    // Bind t0 for later setup or assertions in this scope.
    const t0 = Date.now();
    // page: synchronize actors so the race window is observable.
    const page = await listLocationsCatalog({
      // Execute the next setup or assertion step for this scenario.
      includeArchived: false,
      // Execute the next setup or assertion step for this scenario.
      page: 1,
      // Execute the next setup or assertion step for this scenario.
      pageSize: 25,
    });
    // Bind elapsedMs for later setup or assertions in this scope.
    const elapsedMs = Date.now() - t0;
    // Assert the observed value matches the intended post-condition.
    assert.ok(!Array.isArray(page));
    // Assert the observed value matches the intended post-condition.
    assert.equal(page.pageSize, 25);
    // Assert collection size matches the expected post-condition.
    assert.ok(page.items.length <= 25);
    // Assert the observed value matches the intended post-condition.
    assert.ok(page.total >= 1_000, `total=${page.total}`);
    // Assert the observed value matches the intended post-condition.
    assert.ok(elapsedMs < 5_000, `page1 took ${elapsedMs}ms`);

    // plan: synchronize actors so the race window is observable.
    const plan = await explainPagedCatalog(undefined, 25);
    // Assert the observed value matches the intended post-condition.
    assert.match(plan, /Index|Seq Scan|Bitmap/i);
    // Assert the observed value matches the intended post-condition.
    assert.match(plan, /Execution Time/i);
    // Execute the next setup or assertion step for this scenario.
    console.log("\n[PERF 1k] elapsedMs=", elapsedMs, "\n", plan, "\n");
  });

  // Case: 10_000 locations: broad prefix stays paged and number-first (no index plan mandate).
  it("10_000 locations: broad prefix stays paged and number-first (no index plan mandate)", async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(world);
    // existing: synchronize actors so the race window is observable.
    const existing = await prisma.location.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { floorId: world.floorId, number: { startsWith: PREFIX } },
    });
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (existing < 10_000) {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await seedLocations(world, 10_000 - existing, existing);
    }
    // seeded: seeded entity required before the mutation under test.
    const seeded = await prisma.location.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { floorId: world.floorId, number: { startsWith: PREFIX } },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(seeded >= 10_000, `seeded=${seeded}`);
    // Refresh planner stats after bulk insert so EXPLAIN is meaningful.
    await prisma.$executeRawUnsafe(`ANALYZE "Location"`);

    // numberHits: synchronize actors so the race window is observable.
    const numberHits = await countNumberHits(PREFIX);
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      numberHits >= 10_000,
      // Execute the next setup or assertion step for this scenario.
      `expected number-first path; numberHits=${numberHits}`,
    );

    // Broad prefix matches ~all fixtures — planner may Seq Scan / Bitmap Heap
    // without Location_number_trgm_idx. Assert pagination + latency, not plan.
    const first = await listLocationsCatalog({
      // Execute the next setup or assertion step for this scenario.
      includeArchived: false,
      // Execute the next setup or assertion step for this scenario.
      page: 1,
      // Execute the next setup or assertion step for this scenario.
      pageSize: 25,
      // Execute the next setup or assertion step for this scenario.
      q: PREFIX,
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(!Array.isArray(first));
    // Assert collection size matches the expected post-condition.
    assert.ok(first.items.length <= 25);
    // Assert the observed value matches the intended post-condition.
    assert.ok(first.total >= 10_000, `total=${first.total}`);
    // Assert collection size matches the expected post-condition.
    assert.equal(first.items.length, Math.min(25, first.total));

    // Bind midPage for later setup or assertions in this scope.
    const midPage = Math.min(200, first.totalPages);
    // Bind t0 for later setup or assertions in this scope.
    const t0 = Date.now();
    // mid: unique stamp so parallel runs do not collide.
    const mid = await listLocationsCatalog({
      // Execute the next setup or assertion step for this scenario.
      includeArchived: false,
      // Execute the next setup or assertion step for this scenario.
      page: midPage,
      // Execute the next setup or assertion step for this scenario.
      pageSize: 25,
      // Execute the next setup or assertion step for this scenario.
      q: PREFIX,
    });
    // Bind elapsedMs for later setup or assertions in this scope.
    const elapsedMs = Date.now() - t0;
    // Assert the observed value matches the intended post-condition.
    assert.ok(!Array.isArray(mid));
    // Assert collection size matches the expected post-condition.
    assert.ok(mid.items.length <= 25);
    // Assert the observed value matches the intended post-condition.
    assert.ok(elapsedMs < 8_000, `mid page took ${elapsedMs}ms`);

    // plan: synchronize actors so the race window is observable.
    const plan = await explainPagedCatalog(PREFIX, 25);
    // Execute the next setup or assertion step for this scenario.
    console.log(
      // Execute the next setup or assertion step for this scenario.
      "\n[PERF 10k broad prefix] midPage=",
      // Execute the next setup or assertion step for this scenario.
      midPage,
      // Execute the next setup or assertion step for this scenario.
      "elapsedMs=",
      // Execute the next setup or assertion step for this scenario.
      elapsedMs,
      // Execute the next setup or assertion step for this scenario.
      "total=",
      // Execute the next setup or assertion step for this scenario.
      first.total,
      // Execute the next setup or assertion step for this scenario.
      "numberHits=",
      // Execute the next setup or assertion step for this scenario.
      numberHits,
      // Execute the next setup or assertion step for this scenario.
      "\n",
      // Execute the next setup or assertion step for this scenario.
      plan,
      // Execute the next setup or assertion step for this scenario.
      "\n",
    );
    // Assert the observed value matches the intended post-condition.
    assert.match(plan, /Execution Time/i);
    // Number-first plan must not use the broad building/floor OR Join Filter.
    assert.doesNotMatch(
      // Execute the next setup or assertion step for this scenario.
      plan,
      // Execute the next setup or assertion step for this scenario.
      /Join Filter:.*~~\*.*OR/i,
      // Execute the next setup or assertion step for this scenario.
      "number-first EXPLAIN must not use broad OR Join Filter",
    );
  });

  // Case: 10_000 locations: selective number search — index, results, latency.
  it("10_000 locations: selective number search — index, results, latency", async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(world);
    // seeded: seeded entity required before the mutation under test.
    const seeded = await prisma.location.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { floorId: world.floorId, number: { startsWith: PREFIX } },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      seeded >= 10_000,
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      `selective case requires prior 10k seed; seeded=${seeded}`,
    );
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`ANALYZE "Location"`);
    // Await async work before asserting or releasing locks.
    await assertNumberTrgmIndexPresent();

    // Highly selective substring: one fixture row (PREFIX + zero-padded index).
    // Shared long PREFIX alone is not selective — the zero-padded suffix is.
    const selectiveQ = `${PREFIX}000042`;
    // hits: synchronize actors so the race window is observable.
    const hits = await countNumberHits(selectiveQ);
    // Assert the observed value matches the intended post-condition.
    assert.ok(hits >= 1 && hits <= 5, `selective hits=${hits}`);

    // Bind t0 for later setup or assertions in this scope.
    const t0 = Date.now();
    // page: synchronize actors so the race window is observable.
    const page = await listLocationsCatalog({
      // Execute the next setup or assertion step for this scenario.
      includeArchived: false,
      // Execute the next setup or assertion step for this scenario.
      page: 1,
      // Execute the next setup or assertion step for this scenario.
      pageSize: 25,
      // Execute the next setup or assertion step for this scenario.
      q: selectiveQ,
    });
    // Bind elapsedMs for later setup or assertions in this scope.
    const elapsedMs = Date.now() - t0;
    // Assert the observed value matches the intended post-condition.
    assert.ok(!Array.isArray(page));
    // Assert collection size matches the expected post-condition.
    assert.ok(page.items.length <= 25);
    // Assert the observed value matches the intended post-condition.
    assert.ok(page.total >= 1 && page.total <= 5, `total=${page.total}`);
    // Assert the observed value matches the intended post-condition.
    assert.ok(page.items.every((row) => row.number.includes(selectiveQ)));
    // Production path: correct results + latency budget (CI may Seq Scan ~5ms).
    assert.ok(elapsedMs < 2_000, `selective page took ${elapsedMs}ms`);

    // plan: synchronize actors so the race window is observable.
    const plan = await explainPagedCatalog(selectiveQ, 25);
    // Execute the next setup or assertion step for this scenario.
    console.log(
      // Execute the next setup or assertion step for this scenario.
      "\n[PERF 10k selective] q=",
      // Execute the next setup or assertion step for this scenario.
      selectiveQ,
      // Execute the next setup or assertion step for this scenario.
      "hits=",
      // Execute the next setup or assertion step for this scenario.
      hits,
      // Execute the next setup or assertion step for this scenario.
      "elapsedMs=",
      // Execute the next setup or assertion step for this scenario.
      elapsedMs,
      // Execute the next setup or assertion step for this scenario.
      "\n",
      // Execute the next setup or assertion step for this scenario.
      plan,
      // Execute the next setup or assertion step for this scenario.
      "\n",
    );
    // Assert the observed value matches the intended post-condition.
    assert.match(plan, /Execution Time/i);
    // Delivery/replay step for async notification paths.
    assert.doesNotMatch(
      // Execute the next setup or assertion step for this scenario.
      plan,
      // Execute the next setup or assertion step for this scenario.
      /Join Filter:.*~~\*.*OR/i,
      // Execute the next setup or assertion step for this scenario.
      "selective number-first must not use broad OR Join Filter",
    );
    // Await async work before asserting or releasing locks.
    await assertNumberTrgmIndexUsable(selectiveQ);
  });

  // Define an individual test case.
  it(
    // Execute the next setup or assertion step for this scenario.
    "100_000 locations selective (opt-in LOCATIONS_PERF_100K=1)",
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    { skip: process.env.LOCATIONS_PERF_100K !== "1" },
    // Execute the next setup or assertion step for this scenario.
    async () => {
      // Assert the observed value matches the intended post-condition.
      assert.ok(world);
      // existing: synchronize actors so the race window is observable.
      const existing = await prisma.location.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { floorId: world.floorId, number: { startsWith: PREFIX } },
      });
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (existing < 100_000) {
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        await seedLocations(world, 100_000 - existing, existing);
      }
      // Await async work before asserting or releasing locks.
      await prisma.$executeRawUnsafe(`ANALYZE "Location"`);
      // Await async work before asserting or releasing locks.
      await assertNumberTrgmIndexPresent();
      // numberHits: synchronize actors so the race window is observable.
      const numberHits = await countNumberHits(PREFIX);
      // Assert the observed value matches the intended post-condition.
      assert.ok(numberHits >= 100_000, `numberHits=${numberHits}`);

      // Broad prefix: pagination budget only (planner may skip trgm when ~all match).
      const broadT0 = Date.now();
      // broad: synchronize actors so the race window is observable.
      const broad = await listLocationsCatalog({
        // Execute the next setup or assertion step for this scenario.
        includeArchived: false,
        // Execute the next setup or assertion step for this scenario.
        page: 1,
        // Execute the next setup or assertion step for this scenario.
        pageSize: 50,
        // Execute the next setup or assertion step for this scenario.
        q: PREFIX,
      });
      // Bind broadMs for later setup or assertions in this scope.
      const broadMs = Date.now() - broadT0;
      // Assert the observed value matches the intended post-condition.
      assert.ok(!Array.isArray(broad));
      // Assert collection size matches the expected post-condition.
      assert.ok(broad.items.length <= 50);
      // Assert the observed value matches the intended post-condition.
      assert.ok(broad.total >= 100_000, `total=${broad.total}`);
      // Assert the observed value matches the intended post-condition.
      assert.ok(broadMs < 15_000, `100k broad page1 took ${broadMs}ms`);

      // Bind selectiveQ for later setup or assertions in this scope.
      const selectiveQ = `${PREFIX}000042`;
      // Bind t0 for later setup or assertions in this scope.
      const t0 = Date.now();
      // page: synchronize actors so the race window is observable.
      const page = await listLocationsCatalog({
        // Execute the next setup or assertion step for this scenario.
        includeArchived: false,
        // Execute the next setup or assertion step for this scenario.
        page: 1,
        // Execute the next setup or assertion step for this scenario.
        pageSize: 50,
        // Execute the next setup or assertion step for this scenario.
        q: selectiveQ,
      });
      // Bind elapsedMs for later setup or assertions in this scope.
      const elapsedMs = Date.now() - t0;
      // Assert the observed value matches the intended post-condition.
      assert.ok(!Array.isArray(page));
      // Assert collection size matches the expected post-condition.
      assert.ok(page.items.length <= 50);
      // Assert the observed value matches the intended post-condition.
      assert.ok(page.total >= 1 && page.total <= 5);

      // plan: synchronize actors so the race window is observable.
      const plan = await explainPagedCatalog(selectiveQ, 50);
      // Execute the next setup or assertion step for this scenario.
      console.log(
        // Execute the next setup or assertion step for this scenario.
        "\n[PERF 100k selective] elapsedMs=",
        // Execute the next setup or assertion step for this scenario.
        elapsedMs,
        // Execute the next setup or assertion step for this scenario.
        "broadMs=",
        // Execute the next setup or assertion step for this scenario.
        broadMs,
        // Execute the next setup or assertion step for this scenario.
        "total=",
        // Execute the next setup or assertion step for this scenario.
        page.total,
        // Execute the next setup or assertion step for this scenario.
        "\n",
        // Execute the next setup or assertion step for this scenario.
        plan,
        // Execute the next setup or assertion step for this scenario.
        "\n",
      );
      // Assert the observed value matches the intended post-condition.
      assert.match(plan, /Execution Time/i);
      // Delivery/replay step for async notification paths.
      assert.doesNotMatch(plan, /Join Filter:.*~~\*.*OR/i);
      // At 100k rows the default planner should prefer the GIN index for a
      // single-row selective ILIKE; keep this as a volume-gated regression.
      assert.match(
        // Execute the next setup or assertion step for this scenario.
        plan,
        // Execute the next setup or assertion step for this scenario.
        /Location_number_trgm_idx/i,
        // Execute the next setup or assertion step for this scenario.
        "100k selective EXPLAIN must use Location_number_trgm_idx",
      );
      // Assert the observed value matches the intended post-condition.
      assert.ok(elapsedMs < 15_000, `100k selective page1 took ${elapsedMs}ms`);
    },
  );
});
