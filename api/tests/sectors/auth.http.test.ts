/**
 * supervisor cannot create sectors or hand off primary.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient } from "@prisma/client";
// Import bindings from ../../src/services/dataScope.
import { resolveDataScope } from "../../src/services/dataScope";
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
  postJson,
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
  // Shape SectorsWorld documents the fixture/response fields this suite touches.
  type SectorsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();
// Bind OUT_OF_SCOPE for later setup or assertions in this scope.
const OUT_OF_SCOPE = "Outside your permitted data scope";

// Suite: sector auth HTTP.
describe("sector auth HTTP", () => {
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

  // Case: supervisor POST create with self as primary → 403; scope unchanged.
  it("supervisor POST create with self as primary → 403; scope unchanged", async () => {
    // beforeCount: synchronize actors so the race window is observable.
    const beforeCount = await prisma.sector.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { propertyId: world.propertyId },
    });
    // sup: synchronize actors so the race window is observable.
    const sup = await loginBearer(api, world.supervisorA.email, world.password);
    // Bind authUser for later setup or assertions in this scope.
    const authUser = {
      // Execute the next setup or assertion step for this scenario.
      userId: world.supervisorA.userId,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.supervisorA.employeeId,
      // Fixture field role for the seeded actor/entity.
      role: world.supervisorA.role,
      // Fixture field email for the seeded actor/entity.
      email: world.supervisorA.email,
      // Execute the next setup or assertion step for this scenario.
      sid: "t-sec-58",
    };
    // scopeBefore: synchronize actors so the race window is observable.
    const scopeBefore = await resolveDataScope(authUser);

    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, sup.token, "/sectors", {
      // Execute the next setup or assertion step for this scenario.
      code: `NEW-${world.stamp}`.slice(0, 32),
      // Execute the next setup or assertion step for this scenario.
      nameBg: "Нов",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "New",
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: world.supervisorA.employeeId,
    });

    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 403);
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { error?: string }).error, "forbidden");
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { message?: string }).message, OUT_OF_SCOPE);

    // afterCount: synchronize actors so the race window is observable.
    const afterCount = await prisma.sector.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { propertyId: world.propertyId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(afterCount, beforeCount);

    // scopeAfter: synchronize actors so the race window is observable.
    const scopeAfter = await resolveDataScope(authUser);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      [...(scopeAfter.kind === "sectors" ? scopeAfter.sectorIds : [])].sort(),
      // Execute the next setup or assertion step for this scenario.
      [...(scopeBefore.kind === "sectors" ? scopeBefore.sectorIds : [])].sort(),
    );
  });

  // Case: manager POST create → 201.
  it("manager POST create → 201", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // Bind code for later setup or assertions in this scope.
    const code = `MGR-${world.stamp}`.slice(0, 32);
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, mgr.token, "/sectors", {
      // Execute the next setup or assertion step for this scenario.
      code,
      // Execute the next setup or assertion step for this scenario.
      nameBg: "Мениджър",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "Manager",
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: world.supervisorA.employeeId,
      // Execute the next setup or assertion step for this scenario.
      propertyId: world.propertyId,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 201);
    // id: unique stamp so parallel runs do not collide.
    const id = (res.body as { id: string }).id;
    // Assert the observed value matches the intended post-condition.
    assert.ok(id);
    // Await async work before asserting or releasing locks.
    await prisma.sectorLocation.deleteMany({ where: { sectorId: id } });
    // Await async work before asserting or releasing locks.
    await prisma.auditEvent.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { entityType: "sector", entityId: id },
    });
    // Await async work before asserting or releasing locks.
    await prisma.sector.delete({ where: { id } });
  });

  // Case: supervisor PATCH primary to other → 403.
  it("supervisor PATCH primary to other → 403", async () => {
    // sup: synchronize actors so the race window is observable.
    const sup = await loginBearer(api, world.supervisorA.email, world.password);
    // Bind ver for later setup or assertions in this scope.
    const ver = (
      // Await async work before asserting or releasing locks.
      await prisma.sector.findUniqueOrThrow({ where: { id: world.sectorA1Id } })
    // Execute the next setup or assertion step for this scenario.
    ).version;
    // res: HTTP response captured for status/body checks.
    const res = await patchJson(api, sup.token, `/sectors/${world.sectorA1Id}`, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: ver,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 403);
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { message?: string }).message, OUT_OF_SCOPE);
    // row: synchronize actors so the race window is observable.
    const row = await prisma.sector.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA1Id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.primarySupervisorEmployeeId, world.supervisorA.employeeId);
  });

  // Case: supervisor PATCH primary null → 403.
  it("supervisor PATCH primary null → 403", async () => {
    // sup: synchronize actors so the race window is observable.
    const sup = await loginBearer(api, world.supervisorA.email, world.password);
    // Bind ver for later setup or assertions in this scope.
    const ver = (
      // Await async work before asserting or releasing locks.
      await prisma.sector.findUniqueOrThrow({ where: { id: world.sectorA1Id } })
    // Execute the next setup or assertion step for this scenario.
    ).version;
    // res: HTTP response captured for status/body checks.
    const res = await patchJson(api, sup.token, `/sectors/${world.sectorA1Id}`, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: null,
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: ver,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 403);
    // row: synchronize actors so the race window is observable.
    const row = await prisma.sector.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA1Id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.primarySupervisorEmployeeId, world.supervisorA.employeeId);
  });

  // Case: supervisor PATCH name only → 200; primary unchanged.
  it("supervisor PATCH name only → 200; primary unchanged", async () => {
    // sup: synchronize actors so the race window is observable.
    const sup = await loginBearer(api, world.supervisorA.email, world.password);
    // Bind ver for later setup or assertions in this scope.
    const ver = (
      // Await async work before asserting or releasing locks.
      await prisma.sector.findUniqueOrThrow({ where: { id: world.sectorA1Id } })
    // Execute the next setup or assertion step for this scenario.
    ).version;
    // res: HTTP response captured for status/body checks.
    const res = await patchJson(api, sup.token, `/sectors/${world.sectorA1Id}`, {
      // Execute the next setup or assertion step for this scenario.
      nameBg: "Преименувано A1",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: ver,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // row: synchronize actors so the race window is observable.
    const row = await prisma.sector.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA1Id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.nameBg, "Преименувано A1");
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.primarySupervisorEmployeeId, world.supervisorA.employeeId);
  });

  // Case: PATCH without expectedVersion → 400.
  it("PATCH without expectedVersion → 400", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // res: HTTP response captured for status/body checks.
    const res = await patchJson(api, mgr.token, `/sectors/${world.sectorA1Id}`, {
      // Execute the next setup or assertion step for this scenario.
      nameBg: "No version",
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
  });
});
