/**
 * atomic membership replace (success, refuse, mid-TX rollback).
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient } from "@prisma/client";
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
  putJson,
// Execute the next setup or assertion step for this scenario.
} from "../httpHarness";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupSectorsWorld,
  // Execute the next setup or assertion step for this scenario.
  createSectorsWorld,
  // Execute the next setup or assertion step for this scenario.
  membershipSnapshot,
  // Execute the next setup or assertion step for this scenario.
  resetSectorMemberships,
  // Execute the next setup or assertion step for this scenario.
  sectorMemberIds,
  // Shape SectorsWorld documents the fixture/response fields this suite touches.
  type SectorsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();
// Bind OUT_OF_SCOPE for later setup or assertions in this scope.
const OUT_OF_SCOPE = "Outside your permitted data scope";

// Bind allLocs for later setup or assertions in this scope.
const allLocs = (w: SectorsWorld) => [
  // Execute the next setup or assertion step for this scenario.
  w.loc1Id,
  // Execute the next setup or assertion step for this scenario.
  w.loc2Id,
  // Execute the next setup or assertion step for this scenario.
  w.loc3Id,
  // Execute the next setup or assertion step for this scenario.
  w.loc4Id,
  // Execute the next setup or assertion step for this scenario.
  w.loc5Id,
];

// Local helper sectorVersion used by cases in this file.
async function sectorVersion(sectorId: string): Promise<number> {
  // row: synchronize actors so the race window is observable.
  const row = await prisma.sector.findUniqueOrThrow({ where: { id: sectorId } });
  // Return the arranged value/result to the caller.
  return row.version;
}

// Suite: sector membership atomic HTTP.
describe("sector membership atomic HTTP", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: SectorsWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: import("node:http").Server;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
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

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await resetSectorMemberships(prisma, world);
  });

  // Case: successful multi-move to S2.
  it("successful multi-move to S2", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // before: synchronize actors so the race window is observable.
    const before = await membershipSnapshot(prisma, allLocs(world));
    // res: HTTP response captured for status/body checks.
    const res = await putJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      mgr.token,
      // Execute the next setup or assertion step for this scenario.
      `/sectors/${world.sectorA2Id}/locations`,
      {
        // Execute the next setup or assertion step for this scenario.
        locationIds: [world.loc1Id, world.loc2Id, world.loc3Id],
        // Await async work before asserting or releasing locks.
        expectedVersion: await sectorVersion(world.sectorA2Id),
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // after: synchronize actors so the race window is observable.
    const after = await membershipSnapshot(prisma, allLocs(world));
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.get(world.loc1Id), world.sectorA2Id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.get(world.loc2Id), world.sectorA2Id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.get(world.loc3Id), world.sectorA2Id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.get(world.loc4Id), before.get(world.loc4Id));
    // a1: synchronize actors so the race window is observable.
    const a1 = await sectorMemberIds(prisma, world.sectorA1Id);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(a1, []);
  });

  // Case checks authz/session policy: mixed forbidden room → 403; entire selection unchanged.
  it("mixed forbidden room → 403; entire selection unchanged", async () => {
    // sup: synchronize actors so the race window is observable.
    const sup = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.supervisorA.email,
      // Execute the next setup or assertion step for this scenario.
      world.password,
    );
    // before: synchronize actors so the race window is observable.
    const before = await membershipSnapshot(prisma, allLocs(world));
    // beforeA1: synchronize actors so the race window is observable.
    const beforeA1 = await sectorMemberIds(prisma, world.sectorA1Id);
    // res: HTTP response captured for status/body checks.
    const res = await putJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      sup.token,
      // Execute the next setup or assertion step for this scenario.
      `/sectors/${world.sectorA1Id}/locations`,
      {
        // Execute the next setup or assertion step for this scenario.
        locationIds: [world.loc1Id, world.loc4Id],
        // Await async work before asserting or releasing locks.
        expectedVersion: await sectorVersion(world.sectorA1Id),
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 403);
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { message?: string }).message, OUT_OF_SCOPE);
    // after: synchronize actors so the race window is observable.
    const after = await membershipSnapshot(prisma, allLocs(world));
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      Object.fromEntries(after),
      // Execute the next setup or assertion step for this scenario.
      Object.fromEntries(before),
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Await async work before asserting or releasing locks.
      await sectorMemberIds(prisma, world.sectorA1Id),
      // Execute the next setup or assertion step for this scenario.
      beforeA1,
    );
  });

  // Case: unknown location → 400; membership unchanged.
  it("unknown location → 400; membership unchanged", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // before: synchronize actors so the race window is observable.
    const before = await membershipSnapshot(prisma, allLocs(world));
    // res: HTTP response captured for status/body checks.
    const res = await putJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      mgr.token,
      // Execute the next setup or assertion step for this scenario.
      `/sectors/${world.sectorA1Id}/locations`,
      {
        // Execute the next setup or assertion step for this scenario.
        locationIds: [world.loc1Id, "nonexistent-location-id"],
        // Await async work before asserting or releasing locks.
        expectedVersion: await sectorVersion(world.sectorA1Id),
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { error?: string }).error, "validation");
    // after: synchronize actors so the race window is observable.
    const after = await membershipSnapshot(prisma, allLocs(world));
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      Object.fromEntries(after),
      // Execute the next setup or assertion step for this scenario.
      Object.fromEntries(before),
    );
  });

  // Case: full replace drops omitted own rooms to unassigned.
  it("full replace drops omitted own rooms to unassigned", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // res: HTTP response captured for status/body checks.
    const res = await putJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      mgr.token,
      // Execute the next setup or assertion step for this scenario.
      `/sectors/${world.sectorA1Id}/locations`,
      {
        // Execute the next setup or assertion step for this scenario.
        locationIds: [world.loc1Id],
        // Await async work before asserting or releasing locks.
        expectedVersion: await sectorVersion(world.sectorA1Id),
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // after: synchronize actors so the race window is observable.
    const after = await membershipSnapshot(prisma, [
      // Execute the next setup or assertion step for this scenario.
      world.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      world.loc2Id,
    ]);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.get(world.loc1Id), world.sectorA1Id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.get(world.loc2Id), null);
  });

  // Case: mid-TX rollback via BEFORE INSERT trigger.
  it("mid-TX rollback via BEFORE INSERT trigger", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // before: synchronize actors so the race window is observable.
    const before = await membershipSnapshot(prisma, allLocs(world));
    // beforeA1: synchronize actors so the race window is observable.
    const beforeA1 = await sectorMemberIds(prisma, world.sectorA1Id);
    // beforeA2: synchronize actors so the race window is observable.
    const beforeA2 = await sectorMemberIds(prisma, world.sectorA2Id);
    // Bind fn for later setup or assertions in this scope.
    const fn = `sec_fail_ins_${world.stamp.replace(/[^a-zA-Z0-9]/g, "")}`;
    // Bind trg for later setup or assertions in this scope.
    const trg = `trg_${fn}`;

    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'test-forced-sector-location-insert-failure';
      END;
      $$ LANGUAGE plpgsql;
    `);
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${trg}
      BEFORE INSERT ON "SectorLocation"
      FOR EACH ROW
      WHEN (NEW."sectorId" = '${world.sectorA2Id}')
      EXECUTE FUNCTION ${fn}();
    `);

    // Try path where partial failure must not leak suite state.
    try {
      // res: HTTP response captured for status/body checks.
      const res = await putJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        mgr.token,
        // Execute the next setup or assertion step for this scenario.
        `/sectors/${world.sectorA2Id}/locations`,
        {
          // Execute the next setup or assertion step for this scenario.
          locationIds: [world.loc1Id, world.loc2Id, world.loc3Id],
          // Await async work before asserting or releasing locks.
          expectedVersion: await sectorVersion(world.sectorA2Id),
        },
      );
      // Assert HTTP status matches the contract for this path.
      assert.notEqual(res.status, 200);
      // after: synchronize actors so the race window is observable.
      const after = await membershipSnapshot(prisma, allLocs(world));
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(
        // Execute the next setup or assertion step for this scenario.
        Object.fromEntries(after),
        // Execute the next setup or assertion step for this scenario.
        Object.fromEntries(before),
      );
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(
        // Await async work before asserting or releasing locks.
        await sectorMemberIds(prisma, world.sectorA1Id),
        // Execute the next setup or assertion step for this scenario.
        beforeA1,
      );
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(
        // Await async work before asserting or releasing locks.
        await sectorMemberIds(prisma, world.sectorA2Id),
        // Execute the next setup or assertion step for this scenario.
        beforeA2,
      );
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.$executeRawUnsafe(
        // Execute the next setup or assertion step for this scenario.
        `DROP TRIGGER IF EXISTS ${trg} ON "SectorLocation"`,
      );
      // Await async work before asserting or releasing locks.
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
  });
});
