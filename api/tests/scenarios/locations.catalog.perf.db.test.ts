/**
 * Catalog pagination performance on realistic volumes (1k / 10k).
 * Separates index presence/usability from result, pagination, and latency.
 * 100k is opt-in via LOCATIONS_PERF_100K=1 (slow; skipped by default).
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CatalogStatus, LocationKind, PrismaClient } from "@prisma/client";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  catalogOrderBy,
  listLocationsCatalog,
  locationInclude,
  resolveCatalogListWhere,
} from "../../src/services/locations";
import { explainPrismaLocationFindMany } from "./explainCatalogPrisma";

const prisma = new PrismaClient();
const PREFIX = `PERFLOC_${Date.now().toString(36)}_`;

type PerfWorld = {
  propertyId: string;
  buildingId: string;
  floorId: string;
};

async function seedLocations(
  world: PerfWorld,
  count: number,
  startIndex = 0,
): Promise<void> {
  const batch = 500;
  for (let offset = 0; offset < count; offset += batch) {
    const n = Math.min(batch, count - offset);
    await prisma.location.createMany({
      data: Array.from({ length: n }, (_, i) => {
        const idx = startIndex + offset + i;
        return {
          floorId: world.floorId,
          number: `${PREFIX}${String(idx).padStart(6, "0")}`,
          kind: idx % 7 === 0 ? LocationKind.common_area : LocationKind.room,
          catalogStatus: CatalogStatus.active,
        };
      }),
      skipDuplicates: true,
    });
  }
}

async function cleanup(world: PerfWorld | null): Promise<void> {
  if (!world) return;
  await prisma.location.deleteMany({
    where: { floorId: world.floorId, number: { startsWith: PREFIX } },
  });
  await prisma.floor.deleteMany({ where: { id: world.floorId } });
  await prisma.building.deleteMany({ where: { id: world.buildingId } });
  await prisma.property.deleteMany({ where: { id: world.propertyId } });
}

/**
 * EXPLAIN the real Prisma findMany SQL that listLocationsCatalog emits
 * (same where / include / orderBy / skip / take).
 */
async function explainPagedCatalog(
  q: string | undefined,
  pageSize: number,
): Promise<string> {
  const where = await resolveCatalogListWhere({
    includeArchived: false,
    q,
  });
  return explainPrismaLocationFindMany({
    where,
    include: locationInclude,
    orderBy: catalogOrderBy,
    skip: 0,
    take: pageSize,
  });
}

async function countNumberHits(q: string): Promise<number> {
  return prisma.location.count({
    where: {
      catalogStatus: CatalogStatus.active,
      number: { contains: q, mode: "insensitive" },
    },
  });
}

/** Assert the migration-backed GIN trgm index exists with the expected ops. */
async function assertNumberTrgmIndexPresent(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ indexname: string; indexdef: string }>
  >(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = ANY (current_schemas(false))
      AND tablename = 'Location'
      AND indexname = 'Location_number_trgm_idx'
  `);
  assert.equal(rows.length, 1, "Location_number_trgm_idx must exist");
  assert.match(
    rows[0]!.indexdef,
    /USING gin/i,
    `expected GIN index, got: ${rows[0]!.indexdef}`,
  );
  assert.match(
    rows[0]!.indexdef,
    /gin_trgm_ops/i,
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
  const probe = new PrismaClient();
  try {
    await probe.$connect();
    await probe.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL enable_seqscan = off`);
      // Prefer bitmap paths (GIN's natural access); btree index scans cannot
      // apply leading-wildcard ILIKE as an Index Cond anyway.
      await tx.$executeRawUnsafe(`SET LOCAL enable_indexscan = off`);
      const escaped = selectiveQ.replace(/'/g, "''");
      const rows = await tx.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
        `EXPLAIN (FORMAT TEXT)
         SELECT id FROM "Location"
         WHERE "number" ILIKE '%${escaped}%'
         LIMIT 25`,
      );
      const text = rows.map((r) => r["QUERY PLAN"]).join("\n");
      assert.match(
        text,
        /Location_number_trgm_idx/i,
        `number-only ILIKE probe (seqscan/indexscan off) must select Location_number_trgm_idx\n${text}`,
      );
      assert.match(
        text,
        /Index Cond:\s*\(?number ~~\*/i,
        `trgm usability probe must apply ILIKE via Index Cond, not a post-filter\n${text}`,
      );
    });
  } finally {
    await probe.$disconnect();
  }
}

describe("locations catalog performance", () => {
  let world: PerfWorld | null = null;

  before(async () => {
    await assertTestDatabase(prisma);
    const property = await prisma.property.create({
      data: { name: `${PREFIX}property` },
    });
    const building = await prisma.building.create({
      data: {
        propertyId: property.id,
        name: `${PREFIX}building`,
        code: `PB${Date.now().toString(36)}`.slice(0, 16),
      },
    });
    const floor = await prisma.floor.create({
      data: {
        buildingId: building.id,
        number: 1,
        name: `${PREFIX}floor`,
      },
    });
    world = {
      propertyId: property.id,
      buildingId: building.id,
      floorId: floor.id,
    };
  });

  after(async () => {
    await cleanup(world);
    await prisma.$disconnect();
  });

  it("1_000 locations: paged list returns ≤ pageSize rows with plan evidence", async () => {
    assert.ok(world);
    await seedLocations(world, 1_000);

    const t0 = Date.now();
    const page = await listLocationsCatalog({
      includeArchived: false,
      page: 1,
      pageSize: 25,
    });
    const elapsedMs = Date.now() - t0;
    assert.ok(!Array.isArray(page));
    assert.equal(page.pageSize, 25);
    assert.ok(page.items.length <= 25);
    assert.ok(page.total >= 1_000, `total=${page.total}`);
    assert.ok(elapsedMs < 5_000, `page1 took ${elapsedMs}ms`);

    const plan = await explainPagedCatalog(undefined, 25);
    assert.match(plan, /Index|Seq Scan|Bitmap/i);
    assert.match(plan, /Execution Time/i);
    console.log("\n[PERF 1k] elapsedMs=", elapsedMs, "\n", plan, "\n");
  });

  it("10_000 locations: broad prefix stays paged and number-first (no index plan mandate)", async () => {
    assert.ok(world);
    const existing = await prisma.location.count({
      where: { floorId: world.floorId, number: { startsWith: PREFIX } },
    });
    if (existing < 10_000) {
      await seedLocations(world, 10_000 - existing, existing);
    }
    const seeded = await prisma.location.count({
      where: { floorId: world.floorId, number: { startsWith: PREFIX } },
    });
    assert.ok(seeded >= 10_000, `seeded=${seeded}`);
    // Refresh planner stats after bulk insert so EXPLAIN is meaningful.
    await prisma.$executeRawUnsafe(`ANALYZE "Location"`);

    const numberHits = await countNumberHits(PREFIX);
    assert.ok(
      numberHits >= 10_000,
      `expected number-first path; numberHits=${numberHits}`,
    );

    // Broad prefix matches ~all fixtures — planner may Seq Scan / Bitmap Heap
    // without Location_number_trgm_idx. Assert pagination + latency, not plan.
    const first = await listLocationsCatalog({
      includeArchived: false,
      page: 1,
      pageSize: 25,
      q: PREFIX,
    });
    assert.ok(!Array.isArray(first));
    assert.ok(first.items.length <= 25);
    assert.ok(first.total >= 10_000, `total=${first.total}`);
    assert.equal(first.items.length, Math.min(25, first.total));

    const midPage = Math.min(200, first.totalPages);
    const t0 = Date.now();
    const mid = await listLocationsCatalog({
      includeArchived: false,
      page: midPage,
      pageSize: 25,
      q: PREFIX,
    });
    const elapsedMs = Date.now() - t0;
    assert.ok(!Array.isArray(mid));
    assert.ok(mid.items.length <= 25);
    assert.ok(elapsedMs < 8_000, `mid page took ${elapsedMs}ms`);

    const plan = await explainPagedCatalog(PREFIX, 25);
    console.log(
      "\n[PERF 10k broad prefix] midPage=",
      midPage,
      "elapsedMs=",
      elapsedMs,
      "total=",
      first.total,
      "numberHits=",
      numberHits,
      "\n",
      plan,
      "\n",
    );
    assert.match(plan, /Execution Time/i);
    // Number-first plan must not use the broad building/floor OR Join Filter.
    assert.doesNotMatch(
      plan,
      /Join Filter:.*~~\*.*OR/i,
      "number-first EXPLAIN must not use broad OR Join Filter",
    );
  });

  it("10_000 locations: selective number search — index, results, latency", async () => {
    assert.ok(world);
    const seeded = await prisma.location.count({
      where: { floorId: world.floorId, number: { startsWith: PREFIX } },
    });
    assert.ok(
      seeded >= 10_000,
      `selective case requires prior 10k seed; seeded=${seeded}`,
    );
    await prisma.$executeRawUnsafe(`ANALYZE "Location"`);
    await assertNumberTrgmIndexPresent();

    // Highly selective substring: one fixture row (PREFIX + zero-padded index).
    // Shared long PREFIX alone is not selective — the zero-padded suffix is.
    const selectiveQ = `${PREFIX}000042`;
    const hits = await countNumberHits(selectiveQ);
    assert.ok(hits >= 1 && hits <= 5, `selective hits=${hits}`);

    const t0 = Date.now();
    const page = await listLocationsCatalog({
      includeArchived: false,
      page: 1,
      pageSize: 25,
      q: selectiveQ,
    });
    const elapsedMs = Date.now() - t0;
    assert.ok(!Array.isArray(page));
    assert.ok(page.items.length <= 25);
    assert.ok(page.total >= 1 && page.total <= 5, `total=${page.total}`);
    assert.ok(page.items.every((row) => row.number.includes(selectiveQ)));
    // Production path: correct results + latency budget (CI may Seq Scan ~5ms).
    assert.ok(elapsedMs < 2_000, `selective page took ${elapsedMs}ms`);

    const plan = await explainPagedCatalog(selectiveQ, 25);
    console.log(
      "\n[PERF 10k selective] q=",
      selectiveQ,
      "hits=",
      hits,
      "elapsedMs=",
      elapsedMs,
      "\n",
      plan,
      "\n",
    );
    assert.match(plan, /Execution Time/i);
    assert.doesNotMatch(
      plan,
      /Join Filter:.*~~\*.*OR/i,
      "selective number-first must not use broad OR Join Filter",
    );
    await assertNumberTrgmIndexUsable(selectiveQ);
  });

  it(
    "100_000 locations selective (opt-in LOCATIONS_PERF_100K=1)",
    { skip: process.env.LOCATIONS_PERF_100K !== "1" },
    async () => {
      assert.ok(world);
      const existing = await prisma.location.count({
        where: { floorId: world.floorId, number: { startsWith: PREFIX } },
      });
      if (existing < 100_000) {
        await seedLocations(world, 100_000 - existing, existing);
      }
      await prisma.$executeRawUnsafe(`ANALYZE "Location"`);
      await assertNumberTrgmIndexPresent();
      const numberHits = await countNumberHits(PREFIX);
      assert.ok(numberHits >= 100_000, `numberHits=${numberHits}`);

      // Broad prefix: pagination budget only (planner may skip trgm when ~all match).
      const broadT0 = Date.now();
      const broad = await listLocationsCatalog({
        includeArchived: false,
        page: 1,
        pageSize: 50,
        q: PREFIX,
      });
      const broadMs = Date.now() - broadT0;
      assert.ok(!Array.isArray(broad));
      assert.ok(broad.items.length <= 50);
      assert.ok(broad.total >= 100_000, `total=${broad.total}`);
      assert.ok(broadMs < 15_000, `100k broad page1 took ${broadMs}ms`);

      const selectiveQ = `${PREFIX}000042`;
      const t0 = Date.now();
      const page = await listLocationsCatalog({
        includeArchived: false,
        page: 1,
        pageSize: 50,
        q: selectiveQ,
      });
      const elapsedMs = Date.now() - t0;
      assert.ok(!Array.isArray(page));
      assert.ok(page.items.length <= 50);
      assert.ok(page.total >= 1 && page.total <= 5);

      const plan = await explainPagedCatalog(selectiveQ, 50);
      console.log(
        "\n[PERF 100k selective] elapsedMs=",
        elapsedMs,
        "broadMs=",
        broadMs,
        "total=",
        page.total,
        "\n",
        plan,
        "\n",
      );
      assert.match(plan, /Execution Time/i);
      assert.doesNotMatch(plan, /Join Filter:.*~~\*.*OR/i);
      // At 100k rows the default planner should prefer the GIN index for a
      // single-row selective ILIKE; keep this as a volume-gated regression.
      assert.match(
        plan,
        /Location_number_trgm_idx/i,
        "100k selective EXPLAIN must use Location_number_trgm_idx",
      );
      assert.ok(elapsedMs < 15_000, `100k selective page1 took ${elapsedMs}ms`);
    },
  );
});
