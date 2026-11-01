/**
 * R1/R2 residuals from housekeeping-sectors independent residual-close:
 * - R2: cross-sector pull bumps source sector version + audit (CAS-safe).
 * - R1: access-changing saveSector still succeeds with User-before-Sector locks.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { Role } from "@prisma/client";
import { AppError } from "../../src/errors";
import type { DataScope } from "../../src/services/dataScope";
import { setSectorLocations } from "../../src/services/sectors";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  cleanupSectorsWorld,
  createSectorsWorld,
  currentSectorVersion,
  membershipSnapshot,
  resetSectorMemberships,
  setSectorLocationsAtHead,
  updateSectorAtHead,
  type SectorsWorld,
} from "./fixtures";

const prisma = new PrismaClient();

function allScope(employeeId = ""): DataScope {
  return {
    kind: "all",
    employeeId,
    role: Role.manager,
    sectorIds: [],
  };
}

describe("sector residuals R1/R2", () => {
  let world: SectorsWorld;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    world = await createSectorsWorld(prisma);
  });

  after(async () => {
    if (world) await cleanupSectorsWorld(prisma, world);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetSectorMemberships(prisma, world);
  });

  it("R2: pulling a room bumps source version and writes source audit", async () => {
    const sourceVersionBefore = await currentSectorVersion(
      prisma,
      world.sectorA1Id,
    );
    const destVersionBefore = await currentSectorVersion(
      prisma,
      world.sectorA2Id,
    );

    await setSectorLocationsAtHead(prisma, world.sectorA2Id, [
      world.loc1Id,
      world.loc3Id,
    ], {
      actorEmployeeId: world.manager.employeeId,
      scope: allScope(world.manager.employeeId),
      allowCrossSectorTransfer: true,
    });

    const snap = await membershipSnapshot(prisma, [
      world.loc1Id,
      world.loc3Id,
    ]);
    assert.equal(snap.get(world.loc1Id), world.sectorA2Id);
    assert.equal(snap.get(world.loc3Id), world.sectorA2Id);

    const sourceVersionAfter = await currentSectorVersion(
      prisma,
      world.sectorA1Id,
    );
    const destVersionAfter = await currentSectorVersion(
      prisma,
      world.sectorA2Id,
    );
    assert.equal(
      sourceVersionAfter,
      sourceVersionBefore + 1,
      "source sector must bump when a room is pulled away",
    );
    assert.equal(
      destVersionAfter,
      destVersionBefore + 1,
      "destination still bumps via saveSector",
    );

    const sourceAudit = await prisma.auditEvent.findFirst({
      where: {
        entityType: "sector",
        entityId: world.sectorA1Id,
        action: "sector.update",
        summary: { contains: "cross-sector transfer" },
      },
      orderBy: { occurredAt: "desc" },
    });
    assert.ok(sourceAudit, "source sector audit row expected");
    const before = sourceAudit.before as {
      locationIds?: string[];
      removedLocationIds?: string[];
      version?: number;
    } | null;
    const after = sourceAudit.after as {
      locationIds?: string[];
      version?: number;
    } | null;
    assert.ok(before?.removedLocationIds?.includes(world.loc1Id));
    assert.equal(before?.version, sourceVersionBefore);
    assert.equal(after?.version, sourceVersionAfter);
    assert.ok(!(after?.locationIds ?? []).includes(world.loc1Id));
  });

  it("R2: stale full-replace on source after pull hits version_conflict", async () => {
    const staleSourceVersion = await currentSectorVersion(
      prisma,
      world.sectorA1Id,
    );
    // A1 starts with loc1+loc2. Capture that membership intent at stale version.
    const staleLocationIds = [world.loc1Id, world.loc2Id];

    await setSectorLocationsAtHead(prisma, world.sectorA2Id, [
      world.loc1Id,
      world.loc3Id,
    ], {
      actorEmployeeId: world.manager.employeeId,
      scope: allScope(world.manager.employeeId),
      allowCrossSectorTransfer: true,
    });

    await assert.rejects(
      () =>
        setSectorLocations(world.sectorA1Id, staleLocationIds, {
          expectedVersion: staleSourceVersion,
          actorEmployeeId: world.manager.employeeId,
          scope: allScope(world.manager.employeeId),
          allowCrossSectorTransfer: true,
        }),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, "version_conflict");
        return true;
      },
    );

    // loc1 must remain on A2 — stale A1 rewrite must not pull it back.
    const snap = await membershipSnapshot(prisma, [world.loc1Id, world.loc2Id]);
    assert.equal(snap.get(world.loc1Id), world.sectorA2Id);
    assert.equal(snap.get(world.loc2Id), world.sectorA1Id);
  });

  it("R1: supervisor change still commits under User-before-Sector order", async () => {
    const before = await prisma.sector.findUniqueOrThrow({
      where: { id: world.sectorA1Id },
      select: {
        primarySupervisorEmployeeId: true,
        version: true,
      },
    });
    assert.equal(before.primarySupervisorEmployeeId, world.supervisorA.employeeId);

    const updated = await updateSectorAtHead(prisma, world.sectorA1Id, {
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      actorEmployeeId: world.manager.employeeId,
      scope: allScope(world.manager.employeeId),
    });
    assert.equal(updated.primarySupervisor?.id, world.supervisorB.employeeId);
    assert.equal(updated.version, before.version + 1);

    // Restore for other tests' assumptions about A owning via supervisorA.
    await updateSectorAtHead(prisma, world.sectorA1Id, {
      primarySupervisorEmployeeId: world.supervisorA.employeeId,
      actorEmployeeId: world.manager.employeeId,
      scope: allScope(world.manager.employeeId),
    });
  });
});
