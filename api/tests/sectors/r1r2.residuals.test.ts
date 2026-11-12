/**
 * R1/R2 residuals from housekeeping-sectors independent residual-close:
 * - R2: cross-sector pull bumps source sector version + audit (CAS-safe).
 * - R1: access-changing saveSector still succeeds with User-before-Sector locks.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient } from "@prisma/client";
// Prisma client types/runtime for DB setup and assertions.
import { Role } from "@prisma/client";
// Import bindings from ../../src/errors.
import { AppError } from "../../src/errors";
// Type-only import from ../../src/services/dataScope for compile-time contracts.
import type { DataScope } from "../../src/services/dataScope";
// Import bindings from ../../src/services/sectors.
import { setSectorLocations } from "../../src/services/sectors";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupSectorsWorld,
  // Execute the next setup or assertion step for this scenario.
  createSectorsWorld,
  // Execute the next setup or assertion step for this scenario.
  currentSectorVersion,
  // Execute the next setup or assertion step for this scenario.
  membershipSnapshot,
  // Execute the next setup or assertion step for this scenario.
  resetSectorMemberships,
  // Execute the next setup or assertion step for this scenario.
  setSectorLocationsAtHead,
  // Execute the next setup or assertion step for this scenario.
  updateSectorAtHead,
  // Shape SectorsWorld documents the fixture/response fields this suite touches.
  type SectorsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Local helper allScope used by cases in this file.
function allScope(employeeId = ""): DataScope {
  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    kind: "all",
    // Execute the next setup or assertion step for this scenario.
    employeeId,
    // Fixture field role for the seeded actor/entity.
    role: Role.manager,
    // Execute the next setup or assertion step for this scenario.
    sectorIds: [],
  };
}

// Suite: sector residuals R1/R2.
describe("sector residuals R1/R2", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: SectorsWorld;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createSectorsWorld(prisma);
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
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

  // Case: R2: pulling a room bumps source version and writes source audit.
  it("R2: pulling a room bumps source version and writes source audit", async () => {
    // sourceVersionBefore: synchronize actors so the race window is observable.
    const sourceVersionBefore = await currentSectorVersion(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.sectorA1Id,
    );
    // destVersionBefore: synchronize actors so the race window is observable.
    const destVersionBefore = await currentSectorVersion(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.sectorA2Id,
    );

    // Await async work before asserting or releasing locks.
    await setSectorLocationsAtHead(prisma, world.sectorA2Id, [
      // Execute the next setup or assertion step for this scenario.
      world.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      world.loc3Id,
    // Execute the next setup or assertion step for this scenario.
    ], {
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      scope: allScope(world.manager.employeeId),
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: true,
    });

    // snap: synchronize actors so the race window is observable.
    const snap = await membershipSnapshot(prisma, [
      // Execute the next setup or assertion step for this scenario.
      world.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      world.loc3Id,
    ]);
    // Assert the observed value matches the intended post-condition.
    assert.equal(snap.get(world.loc1Id), world.sectorA2Id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(snap.get(world.loc3Id), world.sectorA2Id);

    // sourceVersionAfter: synchronize actors so the race window is observable.
    const sourceVersionAfter = await currentSectorVersion(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.sectorA1Id,
    );
    // destVersionAfter: synchronize actors so the race window is observable.
    const destVersionAfter = await currentSectorVersion(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.sectorA2Id,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      sourceVersionAfter,
      // Execute the next setup or assertion step for this scenario.
      sourceVersionBefore + 1,
      // Execute the next setup or assertion step for this scenario.
      "source sector must bump when a room is pulled away",
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      destVersionAfter,
      // Execute the next setup or assertion step for this scenario.
      destVersionBefore + 1,
      // Execute the next setup or assertion step for this scenario.
      "destination still bumps via saveSector",
    );

    // sourceAudit: synchronize actors so the race window is observable.
    const sourceAudit = await prisma.auditEvent.findFirst({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        entityType: "sector",
        // Execute the next setup or assertion step for this scenario.
        entityId: world.sectorA1Id,
        // Execute the next setup or assertion step for this scenario.
        action: "sector.update",
        // Execute the next setup or assertion step for this scenario.
        summary: { contains: "cross-sector transfer" },
      },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { occurredAt: "desc" },
    });
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.ok(sourceAudit, "source sector audit row expected");
    // Bind before for later setup or assertions in this scope.
    const before = sourceAudit.before as {
      // Execute the next setup or assertion step for this scenario.
      locationIds?: string[];
      // Execute the next setup or assertion step for this scenario.
      removedLocationIds?: string[];
      // Execute the next setup or assertion step for this scenario.
      version?: number;
    // Execute the next setup or assertion step for this scenario.
    } | null;
    // Bind after for later setup or assertions in this scope.
    const after = sourceAudit.after as {
      // Execute the next setup or assertion step for this scenario.
      locationIds?: string[];
      // Execute the next setup or assertion step for this scenario.
      version?: number;
    // Execute the next setup or assertion step for this scenario.
    } | null;
    // Assert the observed value matches the intended post-condition.
    assert.ok(before?.removedLocationIds?.includes(world.loc1Id));
    // Assert the observed value matches the intended post-condition.
    assert.equal(before?.version, sourceVersionBefore);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after?.version, sourceVersionAfter);
    // Assert the observed value matches the intended post-condition.
    assert.ok(!(after?.locationIds ?? []).includes(world.loc1Id));
  });

  // Case: R2: stale full-replace on source after pull hits version_conflict.
  it("R2: stale full-replace on source after pull hits version_conflict", async () => {
    // staleSourceVersion: synchronize actors so the race window is observable.
    const staleSourceVersion = await currentSectorVersion(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.sectorA1Id,
    );
    // A1 starts with loc1+loc2. Capture that membership intent at stale version.
    const staleLocationIds = [world.loc1Id, world.loc2Id];

    // Await async work before asserting or releasing locks.
    await setSectorLocationsAtHead(prisma, world.sectorA2Id, [
      // Execute the next setup or assertion step for this scenario.
      world.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      world.loc3Id,
    // Execute the next setup or assertion step for this scenario.
    ], {
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      scope: allScope(world.manager.employeeId),
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: true,
    });

    // Await async work before asserting or releasing locks.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Execute the next setup or assertion step for this scenario.
        setSectorLocations(world.sectorA1Id, staleLocationIds, {
          // Execute the next setup or assertion step for this scenario.
          expectedVersion: staleSourceVersion,
          // Execute the next setup or assertion step for this scenario.
          actorEmployeeId: world.manager.employeeId,
          // Execute the next setup or assertion step for this scenario.
          scope: allScope(world.manager.employeeId),
          // Delivery/replay step for async notification paths.
          allowCrossSectorTransfer: true,
        }),
      // Execute the next setup or assertion step for this scenario.
      (err: unknown) => {
        // Assert the observed value matches the intended post-condition.
        assert.ok(err instanceof AppError);
        // Assert the observed value matches the intended post-condition.
        assert.equal(err.code, "version_conflict");
        // Return the arranged value/result to the caller.
        return true;
      },
    );

    // loc1 must remain on A2 — stale A1 rewrite must not pull it back.
    const snap = await membershipSnapshot(prisma, [world.loc1Id, world.loc2Id]);
    // Assert the observed value matches the intended post-condition.
    assert.equal(snap.get(world.loc1Id), world.sectorA2Id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(snap.get(world.loc2Id), world.sectorA1Id);
  });

  // Case: R1: supervisor change still commits under User-before-Sector order.
  it("R1: supervisor change still commits under User-before-Sector order", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await prisma.sector.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA1Id },
      // SQL fragment used to observe locks or assert DB state.
      select: {
        // Execute the next setup or assertion step for this scenario.
        primarySupervisorEmployeeId: true,
        // Execute the next setup or assertion step for this scenario.
        version: true,
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(before.primarySupervisorEmployeeId, world.supervisorA.employeeId);

    // updated: synchronize actors so the race window is observable.
    const updated = await updateSectorAtHead(prisma, world.sectorA1Id, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      scope: allScope(world.manager.employeeId),
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(updated.primarySupervisor?.id, world.supervisorB.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(updated.version, before.version + 1);

    // Restore for other tests' assumptions about A owning via supervisorA.
    await updateSectorAtHead(prisma, world.sectorA1Id, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: world.supervisorA.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      scope: allScope(world.manager.employeeId),
    });
  });
});
