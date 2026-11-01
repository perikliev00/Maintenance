/**
 * BUG-11 / BUG-12 — real PostgreSQL concurrency for sector access + audit.
 *
 * Barriers use promise gates (not sleep-as-proof). Header matches implementation:
 * park AFTER pre-TX auth / AFTER sector lock via test hooks.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient, Role } from "@prisma/client";
import { AppError } from "../../src/errors";
import type { DataScope } from "../../src/services/dataScope";
import {
  resetSectorMutationTestHooks,
  saveSector,
  setSectorMutationTestHooks,
} from "../../src/services/sectors";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  cleanupSectorsWorld,
  createSectorsWorld,
  currentSectorVersion,
  resetSectorMemberships,
  sectorMemberIds,
  updateSectorAtHead,
  type SectorsWorld,
} from "./fixtures";

const prisma = new PrismaClient();

function sectorsScope(employeeId: string, sectorIds: string[]): DataScope {
  return {
    kind: "sectors",
    employeeId,
    role: Role.supervisor,
    sectorIds,
  };
}

function allScope(employeeId: string): DataScope {
  return {
    kind: "all",
    employeeId,
    role: Role.manager,
    sectorIds: [],
  };
}

async function waitFlag(get: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 300 && !get(); i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(get(), true, label);
}

describe("BUG-11 / BUG-12 sector concurrency", () => {
  let world: SectorsWorld;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    world = await createSectorsWorld(prisma);
  });

  after(async () => {
    resetSectorMutationTestHooks();
    if (world) await cleanupSectorsWorld(prisma, world);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    resetSectorMutationTestHooks();
    await resetSectorMemberships(prisma, world);
    await prisma.sector.update({
      where: { id: world.sectorA1Id },
      data: {
        primarySupervisorEmployeeId: world.supervisorA.employeeId,
        isActive: true,
        nameBg: "SEC A1",
        code: `SA1-${world.stamp}`.slice(0, 32),
      },
    });
  });

  it("BUG-11 access recheck: same expectedVersion after revoke → 403 only", async () => {
    const beforeMembers = await sectorMemberIds(prisma, world.sectorA1Id);
    const beforeRow = await prisma.sector.findUniqueOrThrow({
      where: { id: world.sectorA1Id },
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let aReachedBarrier = false;

    setSectorMutationTestHooks({
      afterPreTxAuth: async () => {
        aReachedBarrier = true;
        await gate;
      },
    });

    const supervisorSave = saveSector(world.sectorA1Id, {
      nameBg: "Hijacked",
      locationIds: [world.loc5Id],
      expectedVersion: beforeRow.version,
      actor: {
        employeeId: world.supervisorA.employeeId,
        userId: world.supervisorA.userId,
        role: Role.supervisor,
      },
      scope: sectorsScope(world.supervisorA.employeeId, [
        world.sectorA1Id,
        world.sectorA2Id,
      ]),
      allowCrossSectorTransfer: false,
    });

    await waitFlag(() => aReachedBarrier, "supervisor did not reach barrier");
    resetSectorMutationTestHooks();

    // Reassign WITHOUT bumping version so CAS cannot mask the access check.
    await prisma.sector.update({
      where: { id: world.sectorA1Id },
      data: { primarySupervisorEmployeeId: world.supervisorB.employeeId },
    });
    const afterReassign = await prisma.sector.findUniqueOrThrow({
      where: { id: world.sectorA1Id },
    });
    assert.equal(afterReassign.version, beforeRow.version);
    assert.equal(
      afterReassign.primarySupervisorEmployeeId,
      world.supervisorB.employeeId,
    );

    release();

    await assert.rejects(
      supervisorSave,
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 403 &&
        err.code === "forbidden",
    );

    const finalRow = await prisma.sector.findUniqueOrThrow({
      where: { id: world.sectorA1Id },
    });
    assert.notEqual(finalRow.nameBg, "Hijacked");
    assert.equal(
      finalRow.primarySupervisorEmployeeId,
      world.supervisorB.employeeId,
    );
    assert.deepEqual(
      (await sectorMemberIds(prisma, world.sectorA1Id)).sort(),
      beforeMembers.sort(),
    );
  });

  it("BUG-11 saveSector requires expectedVersion (no omit path)", async () => {
    await assert.rejects(
      () =>
        saveSector(world.sectorA1Id, {
          nameBg: "NoVersionHijack",
          expectedVersion: undefined as unknown as number,
          actor: {
            employeeId: world.supervisorA.employeeId,
            userId: world.supervisorA.userId,
            role: Role.supervisor,
          },
          scope: sectorsScope(world.supervisorA.employeeId, [
            world.sectorA1Id,
            world.sectorA2Id,
          ]),
          allowCrossSectorTransfer: false,
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 400 &&
        /expectedVersion/i.test(err.message),
    );
  });

  it("BUG-11 manager version bump yields version_conflict when expectedVersion sent", async () => {
    const beforeRow = await prisma.sector.findUniqueOrThrow({
      where: { id: world.sectorA1Id },
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let parked = false;
    setSectorMutationTestHooks({
      afterPreTxAuth: async () => {
        parked = true;
        await gate;
      },
    });

    const supervisorSave = saveSector(world.sectorA1Id, {
      nameBg: "StaleVersion",
      expectedVersion: beforeRow.version,
      actor: {
        employeeId: world.supervisorA.employeeId,
        userId: world.supervisorA.userId,
        role: Role.supervisor,
      },
      scope: sectorsScope(world.supervisorA.employeeId, [
        world.sectorA1Id,
        world.sectorA2Id,
      ]),
      allowCrossSectorTransfer: false,
    });

    await waitFlag(() => parked, "park");
    resetSectorMutationTestHooks();
    await updateSectorAtHead(prisma, world.sectorA1Id, {
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      actorEmployeeId: world.manager.employeeId,
      scope: allScope(world.manager.employeeId),
    });
    release();

    await assert.rejects(
      supervisorSave,
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 409 &&
        err.code === "version_conflict",
    );
  });

  it("BUG-12 audit before is snapshotted under sector lock", async () => {
    await prisma.sectorLocation.deleteMany({
      where: { sectorId: world.sectorA1Id },
    });
    await prisma.sectorLocation.createMany({
      data: [
        { sectorId: world.sectorA1Id, locationId: world.loc1Id },
        { sectorId: world.sectorA1Id, locationId: world.loc2Id },
      ],
    });
    await prisma.auditEvent.deleteMany({
      where: { entityType: "sector", entityId: world.sectorA1Id },
    });

    let releaseB!: () => void;
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    let bUnderLock = false;
    let snapshotAtHook: string[] = [];
    let holderPid: number | null = null;

    // Park after lock+access recheck and BEFORE production beforeLocations read.
    setSectorMutationTestHooks({
      afterAccessRechecked: async ({ sectorId, tx }) => {
        if (sectorId !== world.sectorA1Id) return;
        const rows = await tx.sectorLocation.findMany({
          where: { sectorId },
          select: { locationId: true },
        });
        snapshotAtHook = rows.map((r) => r.locationId).sort();
        const pidRows = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::int AS pid
        `;
        holderPid = pidRows[0]!.pid;
        bUnderLock = true;
        await gateB;
      },
    });

    const opB = saveSector(world.sectorA1Id, {
      locationIds: [world.loc1Id],
      expectedVersion: await currentSectorVersion(prisma, world.sectorA1Id),
      actor: {
        employeeId: world.manager.employeeId,
        userId: world.manager.userId,
        role: Role.manager,
      },
      scope: allScope(world.manager.employeeId),
      allowCrossSectorTransfer: true,
    });

    await waitFlag(() => bUnderLock, "B did not hold sector lock");
    assert.ok(holderPid != null, "expected holder backend pid");
    assert.deepEqual(snapshotAtHook, [world.loc1Id, world.loc2Id].sort());

    // Prove the sector row lock is held: dedicated client NOWAIT must fail (55P03).
    const probe = new PrismaClient();
    let externalLockBlocked = false;
    try {
      await probe.$executeRaw`
        SELECT id FROM "Sector" WHERE id = ${world.sectorA1Id} FOR NO KEY UPDATE NOWAIT
      `;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      externalLockBlocked =
        msg.includes("55P03") || msg.includes("could not obtain lock");
    } finally {
      await probe.$disconnect();
    }
    assert.equal(
      externalLockBlocked,
      true,
      `expected NOWAIT to fail under lock (holder pid=${holderPid})`,
    );

    // While B holds the sector lock, mutate SectorLocation on another connection
    // (FK KEY SHARE is compatible with FOR NO KEY UPDATE). Drop loc2 so the
    // post-hook beforeLocations read must see [loc1] only. If production still
    // snapshotted before the lock/hook, audit.before would remain [loc1,loc2].
    await prisma.sectorLocation.deleteMany({
      where: {
        sectorId: world.sectorA1Id,
        locationId: world.loc2Id,
      },
    });
    const afterConcurrent = [world.loc1Id];

    releaseB();
    await opB;
    resetSectorMutationTestHooks();

    const audits = await prisma.auditEvent.findMany({
      where: {
        entityType: "sector",
        entityId: world.sectorA1Id,
        action: "sector.save",
      },
      orderBy: { occurredAt: "asc" },
    });
    assert.ok(audits.length >= 1);
    const first = audits[0]!;
    const before = (first.before as { locationIds?: string[] } | null)
      ?.locationIds;
    assert.ok(Array.isArray(before));
    assert.deepEqual(
      [...before].sort(),
      afterConcurrent,
      "audit before must see membership written while lock was held (read-after-lock)",
    );
    assert.notDeepEqual(
      [...before].sort(),
      snapshotAtHook,
      "pre-hook snapshot must not equal post-mutation audit before",
    );
  });

  it("BUG-12 serialized A-then-B: B.before equals A's committed membership", async () => {
    await prisma.sectorLocation.deleteMany({
      where: { sectorId: world.sectorA1Id },
    });
    await prisma.sectorLocation.createMany({
      data: [
        { sectorId: world.sectorA1Id, locationId: world.loc1Id },
        { sectorId: world.sectorA1Id, locationId: world.loc2Id },
      ],
    });
    await prisma.auditEvent.deleteMany({
      where: { entityType: "sector", entityId: world.sectorA1Id },
    });

    let releaseB!: () => void;
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    let bParked = false;

    setSectorMutationTestHooks({
      afterPreTxAuth: async ({ sectorId }) => {
        if (sectorId !== world.sectorA1Id) return;
        if (!bParked) {
          bParked = true;
          await gateB;
        }
      },
    });

    const versionAtStart = await currentSectorVersion(prisma, world.sectorA1Id);
    const opBStale = saveSector(world.sectorA1Id, {
      locationIds: [world.loc1Id],
      expectedVersion: versionAtStart,
      actor: {
        employeeId: world.manager.employeeId,
        userId: world.manager.userId,
        role: Role.manager,
      },
      scope: allScope(world.manager.employeeId),
      allowCrossSectorTransfer: true,
    });

    await waitFlag(() => bParked, "B park");
    setSectorMutationTestHooks({});

    await saveSector(world.sectorA1Id, {
      locationIds: [world.loc1Id, world.loc2Id, world.loc3Id],
      expectedVersion: await currentSectorVersion(prisma, world.sectorA1Id),
      actor: {
        employeeId: world.manager.employeeId,
        userId: world.manager.userId,
        role: Role.manager,
      },
      scope: allScope(world.manager.employeeId),
      allowCrossSectorTransfer: true,
    });

    releaseB();
    await assert.rejects(
      () => opBStale,
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 409 &&
        err.code === "version_conflict",
    );

    // Fresh-version follow-up: audit.before must equal A's committed membership.
    await saveSector(world.sectorA1Id, {
      locationIds: [world.loc1Id],
      expectedVersion: await currentSectorVersion(prisma, world.sectorA1Id),
      actor: {
        employeeId: world.manager.employeeId,
        userId: world.manager.userId,
        role: Role.manager,
      },
      scope: allScope(world.manager.employeeId),
      allowCrossSectorTransfer: true,
    });

    const audits = await prisma.auditEvent.findMany({
      where: {
        entityType: "sector",
        entityId: world.sectorA1Id,
        action: "sector.save",
      },
      orderBy: { occurredAt: "asc" },
    });
    assert.ok(audits.length >= 2);
    const last = audits[audits.length - 1]!;
    const before = (last.before as { locationIds?: string[] } | null)
      ?.locationIds;
    assert.ok(Array.isArray(before));
    assert.deepEqual(
      [...before].sort(),
      [world.loc1Id, world.loc2Id, world.loc3Id].sort(),
    );
  });
});
