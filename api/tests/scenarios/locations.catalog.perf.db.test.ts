/**
 * Catalog pagination performance on realistic volumes (1k / 10k).
 * Uses EXPLAIN (ANALYZE, BUFFERS) evidence; cleans up seeded rows.
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

  it("10_000 locations: page 1 and mid-page stay bounded (number-first)", async () => {
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

    const numberHits = await countNumberHits(PREFIX);
    assert.ok(
      numberHits >= 10_000,
      `expected number-first path; numberHits=${numberHits}`,
    );

    // Scope metrics to the perf prefix so other fixtures do not dilute asserts.
    const first = await listLocationsCatalog({
      includeArchived: false,
      page: 1,
      pageSize: 25,
      q: PREFIX,
    });
    assert.ok(!Array.isArray(first));
    assert.ok(first.items.length <= 25);
    assert.ok(first.total >= 10_000, `total=${first.total}`);

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
      "\n[PERF 10k number-first] midPage=",
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
    assert.match(
      plan,
      /Location_number_trgm_idx/i,
      "number-first EXPLAIN must use Location_number_trgm_idx",
    );
  });

  it(
    "100_000 locations (opt-in LOCATIONS_PERF_100K=1)",
    { skip: process.env.LOCATIONS_PERF_100K !== "1" },
    async () => {
      assert.ok(world);
      const existing = await prisma.location.count({
        where: { floorId: world.floorId, number: { startsWith: PREFIX } },
      });
      if (existing < 100_000) {
        await seedLocations(world, 100_000 - existing, existing);
      }
      const numberHits = await countNumberHits(PREFIX);
      assert.ok(numberHits >= 100_000, `numberHits=${numberHits}`);

      const t0 = Date.now();
      const page = await listLocationsCatalog({
        includeArchived: false,
        page: 1,
        pageSize: 50,
        q: PREFIX,
      });
      const elapsedMs = Date.now() - t0;
      assert.ok(!Array.isArray(page));
      assert.ok(page.items.length <= 50);

      const plan = await explainPagedCatalog(PREFIX, 50);
      console.log(
        "\n[PERF 100k number-first] elapsedMs=",
        elapsedMs,
        "total=",
        page.total,
        "\n",
        plan,
        "\n",
      );
      assert.match(plan, /Execution Time/i);
      assert.doesNotMatch(plan, /Join Filter:.*~~\*.*OR/i);
      assert.match(
        plan,
        /Location_number_trgm_idx/i,
        "100k number-first EXPLAIN must use Location_number_trgm_idx",
      );
      assert.ok(page.total >= 100_000, `total=${page.total}`);
      assert.ok(elapsedMs < 15_000, `100k page1 took ${elapsedMs}ms`);
    },
  );
});
