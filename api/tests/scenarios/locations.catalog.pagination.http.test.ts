/**
 * Server-side location catalog pagination metadata.
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
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
// Execute the next setup or assertion step for this scenario.
} from "../httpHarness";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupSectorsWorld,
  // Execute the next setup or assertion step for this scenario.
  createSectorsWorld,
  // Shape SectorsWorld documents the fixture/response fields this suite touches.
  type SectorsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../sectors/fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: locations catalog pagination HTTP.
describe("locations catalog pagination HTTP", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: SectorsWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: import("node:http").Server;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createSectorsWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Start or stop the in-process API server for this suite.
    await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupSectorsWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: returns page metadata and respects pageSize cap.
  it("returns page metadata and respects pageSize cap", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // res: HTTP response captured for status/body checks.
    const res = await fetch(
      // Execute the next setup or assertion step for this scenario.
      `${api}/locations?paged=true&page=1&pageSize=2&includeArchived=true`,
      // Execute the next setup or assertion step for this scenario.
      { headers: { Authorization: `Bearer ${mgr.token}` } },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // body: synchronize actors so the race window is observable.
    const body = (await res.json()) as {
      // Execute the next setup or assertion step for this scenario.
      items: unknown[];
      // Execute the next setup or assertion step for this scenario.
      page: number;
      // Execute the next setup or assertion step for this scenario.
      pageSize: number;
      // Execute the next setup or assertion step for this scenario.
      total: number;
      // Execute the next setup or assertion step for this scenario.
      totalPages: number;
    };
    // Assert the observed value matches the intended post-condition.
    assert.ok(Array.isArray(body.items));
    // Assert collection size matches the expected post-condition.
    assert.ok(body.items.length <= 2);
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.page, 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.pageSize, 2);
    // Assert collection size matches the expected post-condition.
    assert.ok(body.total >= body.items.length);
    // Assert the observed value matches the intended post-condition.
    assert.ok(body.totalPages >= 1);

    // oversized: HTTP response captured for status/body checks.
    const oversized = await fetch(
      // Execute the next setup or assertion step for this scenario.
      `${api}/locations?paged=true&page=1&pageSize=500&includeArchived=true`,
      // Execute the next setup or assertion step for this scenario.
      { headers: { Authorization: `Bearer ${mgr.token}` } },
    );
    // big: synchronize actors so the race window is observable.
    const big = (await oversized.json()) as { pageSize: number };
    // Assert the observed value matches the intended post-condition.
    assert.equal(big.pageSize, 100);
  });

  // Case: number-first search falls back to building/floor when number hits are empty.
  it("number-first search falls back to building/floor when number hits are empty", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // building: synchronize actors so the race window is observable.
    const building = await prisma.building.findFirst({
      // SQL fragment used to observe locks or assert DB state.
      where: { floors: { some: { locations: { some: {} } } } },
      // SQL fragment used to observe locks or assert DB state.
      select: { id: true, name: true },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(building?.id);

    // Unique token unlikely to appear in any location.number.
    const buildingOnlyQ = `BLDGONLY_${Date.now().toString(36)}`;
    // Bind originalName for later setup or assertions in this scope.
    const originalName = building.name;
    // Await async work before asserting or releasing locks.
    await prisma.building.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: building.id },
      // Execute the next setup or assertion step for this scenario.
      data: { name: `${originalName} ${buildingOnlyQ}` },
    });

    // Try path where partial failure must not leak suite state.
    try {
      // byNumberMiss: HTTP response captured for status/body checks.
      const byNumberMiss = await fetch(
        // Execute the next setup or assertion step for this scenario.
        `${api}/locations?paged=true&page=1&pageSize=25&q=${encodeURIComponent(buildingOnlyQ)}&includeArchived=true`,
        // Execute the next setup or assertion step for this scenario.
        { headers: { Authorization: `Bearer ${mgr.token}` } },
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(byNumberMiss.status, 200);
      // body: synchronize actors so the race window is observable.
      const body = (await byNumberMiss.json()) as {
        // Execute the next setup or assertion step for this scenario.
        items: Array<{ number: string; buildingCode?: string }>;
        // Execute the next setup or assertion step for this scenario.
        total: number;
      };
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        body.total >= 1,
        // Execute the next setup or assertion step for this scenario.
        "broad fallback must return building/floor hits when number hits are 0",
      );
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.building.update({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: building.id },
        // Execute the next setup or assertion step for this scenario.
        data: { name: originalName },
      });
    }
  });

  // Case: number-first hides building-only hits when any number hit exists.
  it("number-first hides building-only hits when any number hit exists", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // building: synchronize actors so the race window is observable.
    const building = await prisma.building.findFirst({
      // SQL fragment used to observe locks or assert DB state.
      where: { floors: { some: { locations: { some: {} } } } },
      // SQL fragment used to observe locks or assert DB state.
      select: { id: true, name: true },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(building?.id);

    // Token appears in Location.number (number-first path) AND in Building.name.
    const sharedQ = `NUMFIRST_${Date.now().toString(36)}`;
    // floor: synchronize actors so the race window is observable.
    const floor = await prisma.floor.findFirst({
      // SQL fragment used to observe locks or assert DB state.
      where: { buildingId: building.id },
      // SQL fragment used to observe locks or assert DB state.
      select: { id: true },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(floor?.id);

    // numberHit: seeded entity required before the mutation under test.
    const numberHit = await prisma.location.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        floorId: floor.id,
        // Execute the next setup or assertion step for this scenario.
        number: `${sharedQ}-ROOM`,
        // Execute the next setup or assertion step for this scenario.
        kind: LocationKind.room,
        // Execute the next setup or assertion step for this scenario.
        catalogStatus: CatalogStatus.active,
      },
    });
    // Bind originalName for later setup or assertions in this scope.
    const originalName = building.name;
    // Await async work before asserting or releasing locks.
    await prisma.building.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: building.id },
      // Execute the next setup or assertion step for this scenario.
      data: { name: `${originalName} ${sharedQ}` },
    });

    // Try path where partial failure must not leak suite state.
    try {
      // res: HTTP response captured for status/body checks.
      const res = await fetch(
        // Execute the next setup or assertion step for this scenario.
        `${api}/locations?paged=true&page=1&pageSize=50&q=${encodeURIComponent(sharedQ)}&includeArchived=true`,
        // Execute the next setup or assertion step for this scenario.
        { headers: { Authorization: `Bearer ${mgr.token}` } },
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 200);
      // body: synchronize actors so the race window is observable.
      const body = (await res.json()) as {
        // Execute the next setup or assertion step for this scenario.
        items: Array<{ id: string; number: string }>;
        // Execute the next setup or assertion step for this scenario.
        total: number;
      };
      // Assert the observed value matches the intended post-condition.
      assert.ok(body.total >= 1);
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        body.items.every((item) =>
          // Execute the next setup or assertion step for this scenario.
          item.number.toLowerCase().includes(sharedQ.toLowerCase()),
        ),
        // Execute the next setup or assertion step for this scenario.
        "number-first must only return number matches when numberHits > 0",
      );
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        body.items.some((item) => item.id === numberHit.id),
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        "seeded number hit must be present",
      );
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.building.update({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: building.id },
        // Execute the next setup or assertion step for this scenario.
        data: { name: originalName },
      });
      // Await async work before asserting or releasing locks.
      await prisma.sectorLocation.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { locationId: numberHit.id },
      });
      // Await async work before asserting or releasing locks.
      await prisma.location.delete({ where: { id: numberHit.id } });
    }
  });
});
