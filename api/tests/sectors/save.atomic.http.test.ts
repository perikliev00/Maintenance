/**
 * Atomic sector save (metadata + membership) + validation + version CAS.
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
  patchJson,
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
  resetSectorMemberships,
  // Execute the next setup or assertion step for this scenario.
  sectorMemberIds,
  // Shape SectorsWorld documents the fixture/response fields this suite touches.
  type SectorsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: sector atomic save HTTP.
describe("sector atomic save HTTP", () => {
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

  // Case: atomic PATCH updates metadata + membership together.
  it("atomic PATCH updates metadata + membership together", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // before: synchronize actors so the race window is observable.
    const before = await prisma.sector.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA1Id },
    });
    // res: HTTP response captured for status/body checks.
    const res = await patchJson(api, mgr.token, `/sectors/${world.sectorA1Id}`, {
      // Execute the next setup or assertion step for this scenario.
      nameBg: "Atomic BG",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "Atomic EN",
      // Execute the next setup or assertion step for this scenario.
      locationIds: [world.loc1Id, world.loc3Id],
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: before.version,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Bind body for later setup or assertions in this scope.
    const body = res.body as {
      // Execute the next setup or assertion step for this scenario.
      nameBg: string;
      // Execute the next setup or assertion step for this scenario.
      locationIds: string[];
      // Execute the next setup or assertion step for this scenario.
      version: number;
    };
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.nameBg, "Atomic BG");
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual([...body.locationIds].sort(), [
      // Execute the next setup or assertion step for this scenario.
      world.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      world.loc3Id,
    // Execute the next setup or assertion step for this scenario.
    ].sort());
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.version, before.version + 1);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Await async work before asserting or releasing locks.
      (await sectorMemberIds(prisma, world.sectorA1Id)).sort(),
      // Execute the next setup or assertion step for this scenario.
      [world.loc1Id, world.loc3Id].sort(),
    );
  });

  // Case: rejects whitespace-only code.
  it("rejects whitespace-only code", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // before: synchronize actors so the race window is observable.
    const before = await prisma.sector.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA1Id },
    });
    // res: HTTP response captured for status/body checks.
    const res = await patchJson(api, mgr.token, `/sectors/${world.sectorA1Id}`, {
      // Execute the next setup or assertion step for this scenario.
      code: "   ",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: before.version,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
  });

  // Case: rejects missing expectedVersion.
  it("rejects missing expectedVersion", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // res: HTTP response captured for status/body checks.
    const res = await patchJson(api, mgr.token, `/sectors/${world.sectorA1Id}`, {
      // Execute the next setup or assertion step for this scenario.
      nameBg: "Missing version",
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
  });

  // Case: rejects housekeeper as primary supervisor.
  it("rejects housekeeper as primary supervisor", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // before: synchronize actors so the race window is observable.
    const before = await prisma.sector.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA1Id },
    });
    // res: HTTP response captured for status/body checks.
    const res = await patchJson(api, mgr.token, `/sectors/${world.sectorA1Id}`, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: world.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: before.version,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Assert the observed value matches the intended post-condition.
    assert.match(
      // Execute the next setup or assertion step for this scenario.
      String((res.body as { message?: string }).message ?? ""),
      // Execute the next setup or assertion step for this scenario.
      /supervisory role/i,
    );
  });

  // Case: version conflict leaves membership unchanged.
  it("version conflict leaves membership unchanged", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // beforeMembers: synchronize actors so the race window is observable.
    const beforeMembers = await sectorMemberIds(prisma, world.sectorA1Id);
    // res: HTTP response captured for status/body checks.
    const res = await patchJson(api, mgr.token, `/sectors/${world.sectorA1Id}`, {
      // Execute the next setup or assertion step for this scenario.
      nameBg: "Stale",
      // Execute the next setup or assertion step for this scenario.
      locationIds: [world.loc5Id],
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: 1,
    });
    // Sector may already be >1 from earlier tests in this file; force stale.
    const current = await prisma.sector.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA1Id },
    });
    // stale: HTTP response captured for status/body checks.
    const stale = await patchJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      mgr.token,
      // Execute the next setup or assertion step for this scenario.
      `/sectors/${world.sectorA1Id}`,
      {
        // Execute the next setup or assertion step for this scenario.
        nameBg: "Stale2",
        // Execute the next setup or assertion step for this scenario.
        locationIds: [world.loc5Id],
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: current.version - 1 > 0 ? current.version - 1 : 999999,
      },
    );
    // If version was 1 and we sent 999999, conflict; if we sent version-1 and it was 1, also conflict via 999999 path.
    assert.equal(stale.status === 409 || res.status === 409, true);
    // Fire-and-await side effect required before the next assertion.
    void beforeMembers;
    // after: synchronize actors so the race window is observable.
    const after = await sectorMemberIds(prisma, world.sectorA1Id);
    // Ensure a deliberate conflict attempt with wrong version:
    const conflict = await patchJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      mgr.token,
      // Execute the next setup or assertion step for this scenario.
      `/sectors/${world.sectorA1Id}`,
      {
        // Execute the next setup or assertion step for this scenario.
        nameBg: "Conflict",
        // Execute the next setup or assertion step for this scenario.
        locationIds: [world.loc5Id],
        // Await async work before asserting or releasing locks.
        expectedVersion: (await prisma.sector.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: world.sectorA1Id },
        // Execute the next setup or assertion step for this scenario.
        })).version + 10,
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(conflict.status, 409);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      (conflict.body as { error?: string }).error,
      // Execute the next setup or assertion step for this scenario.
      "version_conflict",
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Await async work before asserting or releasing locks.
      (await sectorMemberIds(prisma, world.sectorA1Id)).sort(),
      // Execute the next setup or assertion step for this scenario.
      after.sort(),
    );
  });

  // Case: PUT locations supports expectedVersion.
  it("PUT locations supports expectedVersion", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // before: synchronize actors so the race window is observable.
    const before = await prisma.sector.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA2Id },
    });
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
        locationIds: [world.loc3Id],
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: before.version,
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await sectorMemberIds(prisma, world.sectorA2Id), [
      // Execute the next setup or assertion step for this scenario.
      world.loc3Id,
    ]);
  });

  // Case: PUT locations without expectedVersion → 400.
  it("PUT locations without expectedVersion → 400", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // res: HTTP response captured for status/body checks.
    const res = await putJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      mgr.token,
      // Execute the next setup or assertion step for this scenario.
      `/sectors/${world.sectorA2Id}/locations`,
      // Execute the next setup or assertion step for this scenario.
      { locationIds: [world.loc3Id] },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
  });
});
