/**
 * real PostgreSQL concurrency for sector access + audit.
 *
 * Barriers use promise gates (not sleep-as-proof). Header matches implementation:
 * park AFTER pre-TX auth / AFTER sector lock via test hooks.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient, Role } from "@prisma/client";
// Import bindings from ../../src/errors.
import { AppError } from "../../src/errors";
// Type-only import from ../../src/services/dataScope for compile-time contracts.
import type { DataScope } from "../../src/services/dataScope";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  resetSectorMutationTestHooks,
  // Execute the next setup or assertion step for this scenario.
  saveSector,
  // Execute the next setup or assertion step for this scenario.
  setSectorMutationTestHooks,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/sectors";
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
  resetSectorMemberships,
  // Execute the next setup or assertion step for this scenario.
  sectorMemberIds,
  // Execute the next setup or assertion step for this scenario.
  updateSectorAtHead,
  // Shape SectorsWorld documents the fixture/response fields this suite touches.
  type SectorsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Local helper sectorsScope used by cases in this file.
function sectorsScope(employeeId: string, sectorIds: string[]): DataScope {
  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    kind: "sectors",
    // Execute the next setup or assertion step for this scenario.
    employeeId,
    // Fixture field role for the seeded actor/entity.
    role: Role.supervisor,
    // Execute the next setup or assertion step for this scenario.
    sectorIds,
  };
}

// Local helper allScope used by cases in this file.
function allScope(employeeId: string): DataScope {
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

// Local helper waitFlag used by cases in this file.
async function waitFlag(get: () => boolean, label: string): Promise<void> {
  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let i = 0; i < 300 && !get(); i += 1) {
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 10));
  }
  // Assert the observed value matches the intended post-condition.
  assert.equal(get(), true, label);
}

// Suite: sector concurrency.
describe("sector concurrency", () => {
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
    // Execute the next setup or assertion step for this scenario.
    resetSectorMutationTestHooks();
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupSectorsWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Execute the next setup or assertion step for this scenario.
    resetSectorMutationTestHooks();
    // Await async work before asserting or releasing locks.
    await resetSectorMemberships(prisma, world);
    // Await async work before asserting or releasing locks.
    await prisma.sector.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA1Id },
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        primarySupervisorEmployeeId: world.supervisorA.employeeId,
        // Execute the next setup or assertion step for this scenario.
        isActive: true,
        // Execute the next setup or assertion step for this scenario.
        nameBg: "SEC A1",
        // Execute the next setup or assertion step for this scenario.
        code: `SA1-${world.stamp}`.slice(0, 32),
      },
    });
  });

  // Case: access recheck: same expectedVersion after revoke → 403 only.
  it("access recheck: same expectedVersion after revoke → 403 only", async () => {
    // beforeMembers: synchronize actors so the race window is observable.
    const beforeMembers = await sectorMemberIds(prisma, world.sectorA1Id);
    // beforeRow: synchronize actors so the race window is observable.
    const beforeRow = await prisma.sector.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA1Id },
    });

    // Execute the next setup or assertion step for this scenario.
    let release!: () => void;
    // Bind gate for later setup or assertions in this scope.
    const gate = new Promise<void>((resolve) => {
      // Execute the next setup or assertion step for this scenario.
      release = resolve;
    });
    // Bind aReachedBarrier for later setup or assertions in this scope.
    let aReachedBarrier = false;

    // Execute the next setup or assertion step for this scenario.
    setSectorMutationTestHooks({
      // Execute the next setup or assertion step for this scenario.
      afterPreTxAuth: async () => {
        // Concurrency/isolation step for the race under test.
        aReachedBarrier = true;
        // Await async work before asserting or releasing locks.
        await gate;
      },
    });

    // Bind supervisorSave for later setup or assertions in this scope.
    const supervisorSave = saveSector(world.sectorA1Id, {
      // Execute the next setup or assertion step for this scenario.
      nameBg: "Hijacked",
      // Execute the next setup or assertion step for this scenario.
      locationIds: [world.loc5Id],
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: beforeRow.version,
      // Execute the next setup or assertion step for this scenario.
      actor: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.supervisorA.employeeId,
        // Execute the next setup or assertion step for this scenario.
        userId: world.supervisorA.userId,
        // Fixture field role for the seeded actor/entity.
        role: Role.supervisor,
      },
      // Execute the next setup or assertion step for this scenario.
      scope: sectorsScope(world.supervisorA.employeeId, [
        // Execute the next setup or assertion step for this scenario.
        world.sectorA1Id,
        // Execute the next setup or assertion step for this scenario.
        world.sectorA2Id,
      ]),
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: false,
    });

    // Await async work before asserting or releasing locks.
    await waitFlag(() => aReachedBarrier, "supervisor did not reach barrier");
    // Execute the next setup or assertion step for this scenario.
    resetSectorMutationTestHooks();

    // Reassign WITHOUT bumping version so CAS cannot mask the access check.
    await prisma.sector.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA1Id },
      // Execute the next setup or assertion step for this scenario.
      data: { primarySupervisorEmployeeId: world.supervisorB.employeeId },
    });
    // afterReassign: synchronize actors so the race window is observable.
    const afterReassign = await prisma.sector.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA1Id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(afterReassign.version, beforeRow.version);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      afterReassign.primarySupervisorEmployeeId,
      // Execute the next setup or assertion step for this scenario.
      world.supervisorB.employeeId,
    );

    // Execute the next setup or assertion step for this scenario.
    release();

    // Await async work before asserting or releasing locks.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      supervisorSave,
      // Execute the next setup or assertion step for this scenario.
      (err: unknown) =>
        // Execute the next setup or assertion step for this scenario.
        err instanceof AppError &&
        // Execute the next setup or assertion step for this scenario.
        err.status === 403 &&
        // Execute the next setup or assertion step for this scenario.
        err.code === "forbidden",
    );

    // finalRow: synchronize actors so the race window is observable.
    const finalRow = await prisma.sector.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA1Id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.notEqual(finalRow.nameBg, "Hijacked");
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      finalRow.primarySupervisorEmployeeId,
      // Execute the next setup or assertion step for this scenario.
      world.supervisorB.employeeId,
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Await async work before asserting or releasing locks.
      (await sectorMemberIds(prisma, world.sectorA1Id)).sort(),
      // Execute the next setup or assertion step for this scenario.
      beforeMembers.sort(),
    );
  });

  // Case: saveSector requires expectedVersion (no omit path).
  it("saveSector requires expectedVersion (no omit path)", async () => {
    // Await async work before asserting or releasing locks.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Execute the next setup or assertion step for this scenario.
        saveSector(world.sectorA1Id, {
          // Execute the next setup or assertion step for this scenario.
          nameBg: "NoVersionHijack",
          // Execute the next setup or assertion step for this scenario.
          expectedVersion: undefined as unknown as number,
          // Execute the next setup or assertion step for this scenario.
          actor: {
            // Execute the next setup or assertion step for this scenario.
            employeeId: world.supervisorA.employeeId,
            // Execute the next setup or assertion step for this scenario.
            userId: world.supervisorA.userId,
            // Fixture field role for the seeded actor/entity.
            role: Role.supervisor,
          },
          // Execute the next setup or assertion step for this scenario.
          scope: sectorsScope(world.supervisorA.employeeId, [
            // Execute the next setup or assertion step for this scenario.
            world.sectorA1Id,
            // Execute the next setup or assertion step for this scenario.
            world.sectorA2Id,
          ]),
          // Delivery/replay step for async notification paths.
          allowCrossSectorTransfer: false,
        }),
      // Execute the next setup or assertion step for this scenario.
      (err: unknown) =>
        // Execute the next setup or assertion step for this scenario.
        err instanceof AppError &&
        // Execute the next setup or assertion step for this scenario.
        err.status === 400 &&
        // Execute the next setup or assertion step for this scenario.
        /expectedVersion/i.test(err.message),
    );
  });

  // Case: manager version bump yields version_conflict when expectedVersion sent.
  it("manager version bump yields version_conflict when expectedVersion sent", async () => {
    // beforeRow: synchronize actors so the race window is observable.
    const beforeRow = await prisma.sector.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: world.sectorA1Id },
    });
    // Execute the next setup or assertion step for this scenario.
    let release!: () => void;
    // Bind gate for later setup or assertions in this scope.
    const gate = new Promise<void>((resolve) => {
      // Execute the next setup or assertion step for this scenario.
      release = resolve;
    });
    // Bind parked for later setup or assertions in this scope.
    let parked = false;
    // Execute the next setup or assertion step for this scenario.
    setSectorMutationTestHooks({
      // Execute the next setup or assertion step for this scenario.
      afterPreTxAuth: async () => {
        // Execute the next setup or assertion step for this scenario.
        parked = true;
        // Await async work before asserting or releasing locks.
        await gate;
      },
    });

    // Bind supervisorSave for later setup or assertions in this scope.
    const supervisorSave = saveSector(world.sectorA1Id, {
      // Execute the next setup or assertion step for this scenario.
      nameBg: "StaleVersion",
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: beforeRow.version,
      // Execute the next setup or assertion step for this scenario.
      actor: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.supervisorA.employeeId,
        // Execute the next setup or assertion step for this scenario.
        userId: world.supervisorA.userId,
        // Fixture field role for the seeded actor/entity.
        role: Role.supervisor,
      },
      // Execute the next setup or assertion step for this scenario.
      scope: sectorsScope(world.supervisorA.employeeId, [
        // Execute the next setup or assertion step for this scenario.
        world.sectorA1Id,
        // Execute the next setup or assertion step for this scenario.
        world.sectorA2Id,
      ]),
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: false,
    });

    // Await async work before asserting or releasing locks.
    await waitFlag(() => parked, "park");
    // Execute the next setup or assertion step for this scenario.
    resetSectorMutationTestHooks();
    // Await async work before asserting or releasing locks.
    await updateSectorAtHead(prisma, world.sectorA1Id, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      scope: allScope(world.manager.employeeId),
    });
    // Execute the next setup or assertion step for this scenario.
    release();

    // Await async work before asserting or releasing locks.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      supervisorSave,
      // Execute the next setup or assertion step for this scenario.
      (err: unknown) =>
        // Execute the next setup or assertion step for this scenario.
        err instanceof AppError &&
        // Execute the next setup or assertion step for this scenario.
        err.status === 409 &&
        // Execute the next setup or assertion step for this scenario.
        err.code === "version_conflict",
    );
  });

  // Case probes concurrency/isolation: audit before is snapshotted under sector lock.
  it("audit before is snapshotted under sector lock", async () => {
    // Await async work before asserting or releasing locks.
    await prisma.sectorLocation.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { sectorId: world.sectorA1Id },
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await prisma.sectorLocation.createMany({
      // Execute the next setup or assertion step for this scenario.
      data: [
        // Execute the next setup or assertion step for this scenario.
        { sectorId: world.sectorA1Id, locationId: world.loc1Id },
        // Execute the next setup or assertion step for this scenario.
        { sectorId: world.sectorA1Id, locationId: world.loc2Id },
      ],
    });
    // Await async work before asserting or releasing locks.
    await prisma.auditEvent.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { entityType: "sector", entityId: world.sectorA1Id },
    });

    // Execute the next setup or assertion step for this scenario.
    let releaseB!: () => void;
    // Bind gateB for later setup or assertions in this scope.
    const gateB = new Promise<void>((resolve) => {
      // Execute the next setup or assertion step for this scenario.
      releaseB = resolve;
    });
    // Bind bUnderLock for later setup or assertions in this scope.
    let bUnderLock = false;
    // Execute the next setup or assertion step for this scenario.
    let snapshotAtHook: string[] = [];
    // Execute the next setup or assertion step for this scenario.
    let holderPid: number | null = null;

    // Park after lock+access recheck and BEFORE production beforeLocations read.
    setSectorMutationTestHooks({
      // Execute the next setup or assertion step for this scenario.
      afterAccessRechecked: async ({ sectorId, tx }) => {
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (sectorId !== world.sectorA1Id) return;
        // rows: synchronize actors so the race window is observable.
        const rows = await tx.sectorLocation.findMany({
          // SQL fragment used to observe locks or assert DB state.
          where: { sectorId },
          // SQL fragment used to observe locks or assert DB state.
          select: { locationId: true },
        });
        // Execute the next setup or assertion step for this scenario.
        snapshotAtHook = rows.map((r) => r.locationId).sort();
        // pidRows: synchronize actors so the race window is observable.
        const pidRows = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::int AS pid
        `;
        // Execute the next setup or assertion step for this scenario.
        holderPid = pidRows[0]!.pid;
        // Concurrency/isolation step for the race under test.
        bUnderLock = true;
        // Await async work before asserting or releasing locks.
        await gateB;
      },
    });

    // Bind opB for later setup or assertions in this scope.
    const opB = saveSector(world.sectorA1Id, {
      // Execute the next setup or assertion step for this scenario.
      locationIds: [world.loc1Id],
      // Await async work before asserting or releasing locks.
      expectedVersion: await currentSectorVersion(prisma, world.sectorA1Id),
      // Execute the next setup or assertion step for this scenario.
      actor: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.manager.employeeId,
        // Execute the next setup or assertion step for this scenario.
        userId: world.manager.userId,
        // Fixture field role for the seeded actor/entity.
        role: Role.manager,
      },
      // Execute the next setup or assertion step for this scenario.
      scope: allScope(world.manager.employeeId),
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: true,
    });

    // Await async work before asserting or releasing locks.
    await waitFlag(() => bUnderLock, "B did not hold sector lock");
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.ok(holderPid != null, "expected holder backend pid");
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(snapshotAtHook, [world.loc1Id, world.loc2Id].sort());

    // Prove the sector row lock is held: dedicated client NOWAIT must fail (55P03).
    const probe = new PrismaClient();
    // Bind externalLockBlocked for later setup or assertions in this scope.
    let externalLockBlocked = false;
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await probe.$executeRaw`
        SELECT id FROM "Sector" WHERE id = ${world.sectorA1Id} FOR NO KEY UPDATE NOWAIT
      `;
    // Execute the next setup or assertion step for this scenario.
    } catch (err: unknown) {
      // Bind msg for later setup or assertions in this scope.
      const msg = err instanceof Error ? err.message : String(err);
      // Concurrency/isolation step for the race under test.
      externalLockBlocked =
        // Concurrency/isolation step for the race under test.
        msg.includes("55P03") || msg.includes("could not obtain lock");
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Disconnect Prisma so the pool does not leak across suites.
      await probe.$disconnect();
    }
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Concurrency/isolation step for the race under test.
      externalLockBlocked,
      // Execute the next setup or assertion step for this scenario.
      true,
      // Concurrency/isolation step for the race under test.
      `expected NOWAIT to fail under lock (holder pid=${holderPid})`,
    );

    // While B holds the sector lock, mutate SectorLocation on another connection
    // (FK KEY SHARE is compatible with FOR NO KEY UPDATE). Drop loc2 so the
    // post-hook beforeLocations read must see [loc1] only. If production still
    // snapshotted before the lock/hook, audit.before would remain [loc1,loc2].
    await prisma.sectorLocation.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        sectorId: world.sectorA1Id,
        // Execute the next setup or assertion step for this scenario.
        locationId: world.loc2Id,
      },
    });
    // Bind afterConcurrent for later setup or assertions in this scope.
    const afterConcurrent = [world.loc1Id];

    // Execute the next setup or assertion step for this scenario.
    releaseB();
    // Await async work before asserting or releasing locks.
    await opB;
    // Execute the next setup or assertion step for this scenario.
    resetSectorMutationTestHooks();

    // audits: synchronize actors so the race window is observable.
    const audits = await prisma.auditEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        entityType: "sector",
        // Execute the next setup or assertion step for this scenario.
        entityId: world.sectorA1Id,
        // Execute the next setup or assertion step for this scenario.
        action: "sector.save",
      },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { occurredAt: "asc" },
    });
    // Assert collection size matches the expected post-condition.
    assert.ok(audits.length >= 1);
    // Bind first for later setup or assertions in this scope.
    const first = audits[0]!;
    // Bind before for later setup or assertions in this scope.
    const before = (first.before as { locationIds?: string[] } | null)
      ?.locationIds;
    // Assert the observed value matches the intended post-condition.
    assert.ok(Array.isArray(before));
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      [...before].sort(),
      // Concurrency/isolation step for the race under test.
      afterConcurrent,
      // Concurrency/isolation step for the race under test.
      "audit before must see membership written while lock was held (read-after-lock)",
    );
    // Delivery/replay step for async notification paths.
    assert.notDeepEqual(
      // Execute the next setup or assertion step for this scenario.
      [...before].sort(),
      // Execute the next setup or assertion step for this scenario.
      snapshotAtHook,
      // Execute the next setup or assertion step for this scenario.
      "pre-hook snapshot must not equal post-mutation audit before",
    );
  });

  // Case: serialized A-then-B: B.before equals A.
  it("serialized A-then-B: B.before equals A's committed membership", async () => {
    // Await async work before asserting or releasing locks.
    await prisma.sectorLocation.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { sectorId: world.sectorA1Id },
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await prisma.sectorLocation.createMany({
      // Execute the next setup or assertion step for this scenario.
      data: [
        // Execute the next setup or assertion step for this scenario.
        { sectorId: world.sectorA1Id, locationId: world.loc1Id },
        // Execute the next setup or assertion step for this scenario.
        { sectorId: world.sectorA1Id, locationId: world.loc2Id },
      ],
    });
    // Await async work before asserting or releasing locks.
    await prisma.auditEvent.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { entityType: "sector", entityId: world.sectorA1Id },
    });

    // Execute the next setup or assertion step for this scenario.
    let releaseB!: () => void;
    // Bind gateB for later setup or assertions in this scope.
    const gateB = new Promise<void>((resolve) => {
      // Execute the next setup or assertion step for this scenario.
      releaseB = resolve;
    });
    // Bind bParked for later setup or assertions in this scope.
    let bParked = false;

    // Execute the next setup or assertion step for this scenario.
    setSectorMutationTestHooks({
      // Execute the next setup or assertion step for this scenario.
      afterPreTxAuth: async ({ sectorId }) => {
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (sectorId !== world.sectorA1Id) return;
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (!bParked) {
          // Execute the next setup or assertion step for this scenario.
          bParked = true;
          // Await async work before asserting or releasing locks.
          await gateB;
        }
      },
    });

    // versionAtStart: synchronize actors so the race window is observable.
    const versionAtStart = await currentSectorVersion(prisma, world.sectorA1Id);
    // Bind opBStale for later setup or assertions in this scope.
    const opBStale = saveSector(world.sectorA1Id, {
      // Execute the next setup or assertion step for this scenario.
      locationIds: [world.loc1Id],
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: versionAtStart,
      // Execute the next setup or assertion step for this scenario.
      actor: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.manager.employeeId,
        // Execute the next setup or assertion step for this scenario.
        userId: world.manager.userId,
        // Fixture field role for the seeded actor/entity.
        role: Role.manager,
      },
      // Execute the next setup or assertion step for this scenario.
      scope: allScope(world.manager.employeeId),
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: true,
    });

    // Await async work before asserting or releasing locks.
    await waitFlag(() => bParked, "B park");
    // Execute the next setup or assertion step for this scenario.
    setSectorMutationTestHooks({});

    // Await async work before asserting or releasing locks.
    await saveSector(world.sectorA1Id, {
      // Execute the next setup or assertion step for this scenario.
      locationIds: [world.loc1Id, world.loc2Id, world.loc3Id],
      // Await async work before asserting or releasing locks.
      expectedVersion: await currentSectorVersion(prisma, world.sectorA1Id),
      // Execute the next setup or assertion step for this scenario.
      actor: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.manager.employeeId,
        // Execute the next setup or assertion step for this scenario.
        userId: world.manager.userId,
        // Fixture field role for the seeded actor/entity.
        role: Role.manager,
      },
      // Execute the next setup or assertion step for this scenario.
      scope: allScope(world.manager.employeeId),
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: true,
    });

    // Execute the next setup or assertion step for this scenario.
    releaseB();
    // Await async work before asserting or releasing locks.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      () => opBStale,
      // Execute the next setup or assertion step for this scenario.
      (err: unknown) =>
        // Execute the next setup or assertion step for this scenario.
        err instanceof AppError &&
        // Execute the next setup or assertion step for this scenario.
        err.status === 409 &&
        // Execute the next setup or assertion step for this scenario.
        err.code === "version_conflict",
    );

    // Fresh-version follow-up: audit.before must equal A's committed membership.
    await saveSector(world.sectorA1Id, {
      // Execute the next setup or assertion step for this scenario.
      locationIds: [world.loc1Id],
      // Await async work before asserting or releasing locks.
      expectedVersion: await currentSectorVersion(prisma, world.sectorA1Id),
      // Execute the next setup or assertion step for this scenario.
      actor: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.manager.employeeId,
        // Execute the next setup or assertion step for this scenario.
        userId: world.manager.userId,
        // Fixture field role for the seeded actor/entity.
        role: Role.manager,
      },
      // Execute the next setup or assertion step for this scenario.
      scope: allScope(world.manager.employeeId),
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: true,
    });

    // audits: synchronize actors so the race window is observable.
    const audits = await prisma.auditEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        entityType: "sector",
        // Execute the next setup or assertion step for this scenario.
        entityId: world.sectorA1Id,
        // Execute the next setup or assertion step for this scenario.
        action: "sector.save",
      },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { occurredAt: "asc" },
    });
    // Assert collection size matches the expected post-condition.
    assert.ok(audits.length >= 2);
    // Bind last for later setup or assertions in this scope.
    const last = audits[audits.length - 1]!;
    // Bind before for later setup or assertions in this scope.
    const before = (last.before as { locationIds?: string[] } | null)
      ?.locationIds;
    // Assert the observed value matches the intended post-condition.
    assert.ok(Array.isArray(before));
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      [...before].sort(),
      // Execute the next setup or assertion step for this scenario.
      [world.loc1Id, world.loc2Id, world.loc3Id].sort(),
    );
  });
});
