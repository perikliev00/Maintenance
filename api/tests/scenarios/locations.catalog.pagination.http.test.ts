/**
 * Server-side location catalog pagination metadata.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CatalogStatus, LocationKind, PrismaClient } from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
import {
  closeServer,
  listenApp,
  loginBearer,
} from "../httpHarness";
import {
  cleanupSectorsWorld,
  createSectorsWorld,
  // Shape SectorsWorld documents the fixture/response fields this suite touches.
  type SectorsWorld,
} from "../sectors/fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: locations catalog pagination HTTP.
describe("locations catalog pagination HTTP", () => {
  let world: SectorsWorld;
  let api: string;
  let server: import("node:http").Server;

  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    world = await createSectorsWorld(prisma);
    ({ server, api } = await listenApp());
  });

  after(async () => {
    await closeServer(server);
    if (world) await cleanupSectorsWorld(prisma, world);
    await prisma.$disconnect();
  });

  // Case: returns page metadata and respects pageSize cap.
  it("returns page metadata and respects pageSize cap", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const res = await fetch(
      `${api}/locations?paged=true&page=1&pageSize=2&includeArchived=true`,
      { headers: { Authorization: `Bearer ${mgr.token}` } },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      items: unknown[];
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
    assert.ok(Array.isArray(body.items));
    assert.ok(body.items.length <= 2);
    assert.equal(body.page, 1);
    assert.equal(body.pageSize, 2);
    assert.ok(body.total >= body.items.length);
    assert.ok(body.totalPages >= 1);

    const oversized = await fetch(
      `${api}/locations?paged=true&page=1&pageSize=500&includeArchived=true`,
      { headers: { Authorization: `Bearer ${mgr.token}` } },
    );
    const big = (await oversized.json()) as { pageSize: number };
    assert.equal(big.pageSize, 100);
  });

  // Case: number-first search falls back to building/floor when number hits are empty.
  it("number-first search falls back to building/floor when number hits are empty", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const building = await prisma.building.findFirst({
      where: { floors: { some: { locations: { some: {} } } } },
      select: { id: true, name: true },
    });
    assert.ok(building?.id);

    // Unique token unlikely to appear in any location.number.
    const buildingOnlyQ = `BLDGONLY_${Date.now().toString(36)}`;
    const originalName = building.name;
    await prisma.building.update({
      where: { id: building.id },
      data: { name: `${originalName} ${buildingOnlyQ}` },
    });

    try {
      const byNumberMiss = await fetch(
        `${api}/locations?paged=true&page=1&pageSize=25&q=${encodeURIComponent(buildingOnlyQ)}&includeArchived=true`,
        { headers: { Authorization: `Bearer ${mgr.token}` } },
      );
      assert.equal(byNumberMiss.status, 200);
      const body = (await byNumberMiss.json()) as {
        items: Array<{ number: string; buildingCode?: string }>;
        total: number;
      };
      assert.ok(
        body.total >= 1,
        "broad fallback must return building/floor hits when number hits are 0",
      );
    } finally {
      await prisma.building.update({
        where: { id: building.id },
        data: { name: originalName },
      });
    }
  });

  // Case: number-first hides building-only hits when any number hit exists.
  it("number-first hides building-only hits when any number hit exists", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const building = await prisma.building.findFirst({
      where: { floors: { some: { locations: { some: {} } } } },
      select: { id: true, name: true },
    });
    assert.ok(building?.id);

    // Token appears in Location.number (number-first path) AND in Building.name.
    const sharedQ = `NUMFIRST_${Date.now().toString(36)}`;
    const floor = await prisma.floor.findFirst({
      where: { buildingId: building.id },
      select: { id: true },
    });
    assert.ok(floor?.id);

    // numberHit: seeded entity required before the mutation under test.
    const numberHit = await prisma.location.create({
      data: {
        floorId: floor.id,
        number: `${sharedQ}-ROOM`,
        kind: LocationKind.room,
        catalogStatus: CatalogStatus.active,
      },
    });
    const originalName = building.name;
    await prisma.building.update({
      where: { id: building.id },
      data: { name: `${originalName} ${sharedQ}` },
    });

    try {
      const res = await fetch(
        `${api}/locations?paged=true&page=1&pageSize=50&q=${encodeURIComponent(sharedQ)}&includeArchived=true`,
        { headers: { Authorization: `Bearer ${mgr.token}` } },
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        items: Array<{ id: string; number: string }>;
        total: number;
      };
      assert.ok(body.total >= 1);
      assert.ok(
        body.items.every((item) =>
          item.number.toLowerCase().includes(sharedQ.toLowerCase()),
        ),
        "number-first must only return number matches when numberHits > 0",
      );
      assert.ok(
        body.items.some((item) => item.id === numberHit.id),
        "seeded number hit must be present",
      );
    } finally {
      await prisma.building.update({
        where: { id: building.id },
        data: { name: originalName },
      });
      await prisma.sectorLocation.deleteMany({
        where: { locationId: numberHit.id },
      });
      await prisma.location.delete({ where: { id: numberHit.id } });
    }
  });
});
