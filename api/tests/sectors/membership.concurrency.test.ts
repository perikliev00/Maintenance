/**
 * d — membership concurrency after Location/Sector locks.
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
// Import bindings from ../../src/services/cleaning/tasks.
import { createCleaningTask } from "../../src/services/cleaning/tasks";
// Type-only import from ../../src/services/dataScope for compile-time contracts.
import type { DataScope } from "../../src/services/dataScope";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
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
  // Concurrency/isolation step for the race under test.
  runWhileLocationLockedWithTx,
  // Execute the next setup or assertion step for this scenario.
  sectorMemberIds,
  // Execute the next setup or assertion step for this scenario.
  setSectorLocationsAtHead,
  // Concurrency/isolation step for the race under test.
  waitForBlockedByHolder,
  // Shape SectorsWorld documents the fixture/response fields this suite touches.
  type SectorsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Local helper allScope used by cases in this file.
function allScope(employeeId = ""): DataScope {
  // Return the arranged value/result to the caller.
  return { kind: "all", employeeId, role: Role.manager, sectorIds: [] };
}

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

// Local helper sortedJoin used by cases in this file.
function sortedJoin(ids: string[]): string {
  // Return the arranged value/result to the caller.
  return [...ids].sort().join(",");
}

/** Dual-claim settle: only AppError 409 conflict is an acceptable rejection. */
function assertSettledMembershipRace(
  // Execute the next setup or assertion step for this scenario.
  settled: PromiseSettledResult<unknown>[],
  // Execute the next setup or assertion step for this scenario.
  opts: {
    // Execute the next setup or assertion step for this scenario.
    contestedLocationId: string;
    // Execute the next setup or assertion step for this scenario.
    winnerSets: string[][];
  },
// Execute the next setup or assertion step for this scenario.
): void {
  // Bind fulfilled for later setup or assertions in this scope.
  const fulfilled = settled.filter((s) => s.status === "fulfilled");
  // Bind rejected for later setup or assertions in this scope.
  const rejected = settled.filter((s) => s.status === "rejected");
  // Assert the observed value matches the intended post-condition.
  assert.ok(
    // Execute the next setup or assertion step for this scenario.
    fulfilled.length >= 1,
    // Execute the next setup or assertion step for this scenario.
    `expected at least one fulfilled op, got ${JSON.stringify(
      settled.map((s) =>
        s.status === "fulfilled"
          ? "fulfilled"
          : String((s as PromiseRejectedResult).reason),
      ),
    // Execute the next setup or assertion step for this scenario.
    )}`,
  );

  // Iterate to cover variants or wait until a condition holds.
  for (const s of rejected) {
    // Bind err for later setup or assertions in this scope.
    const err = (s as PromiseRejectedResult).reason;
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      err instanceof AppError,
      // Execute the next setup or assertion step for this scenario.
      `rejected must be AppError, got ${String(err)}`,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      err.status,
      // Execute the next setup or assertion step for this scenario.
      409,
      // Execute the next setup or assertion step for this scenario.
      `rejected status must be 409, got ${err.status}: ${err.message}`,
    );
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      err.code === "conflict" || err.code === "version_conflict",
      // Execute the next setup or assertion step for this scenario.
      `rejected code must be conflict|version_conflict, got ${err.code}: ${err.message}`,
    );
  }
}

// Suite: sector membership concurrency.
describe("sector membership concurrency", () => {
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
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: {
          // Execute the next setup or assertion step for this scenario.
          in: [
            // Execute the next setup or assertion step for this scenario.
            world.loc1Id,
            // Execute the next setup or assertion step for this scenario.
            world.loc2Id,
            // Execute the next setup or assertion step for this scenario.
            world.loc3Id,
            // Execute the next setup or assertion step for this scenario.
            world.loc4Id,
            // Execute the next setup or assertion step for this scenario.
            world.loc5Id,
          ],
        },
      },
    });
  });

  // Case probes concurrency/isolation: dual-claim different destinations; PID blocking; one membership.
  it("dual-claim different destinations; PID blocking; one membership", async () => {
    // Execute the next setup or assertion step for this scenario.
    let release!: () => void;
    // Bind gate for later setup or assertions in this scope.
    const gate = new Promise<void>((r) => {
      // Execute the next setup or assertion step for this scenario.
      release = r;
    });
    // Execute the next setup or assertion step for this scenario.
    let holderPid: number | null = null;
    // Bind lockHeld for later setup or assertions in this scope.
    let lockHeld = false;
    // Execute the next setup or assertion step for this scenario.
    let p1: Promise<unknown> | undefined;
    // Execute the next setup or assertion step for this scenario.
    let p2: Promise<unknown> | undefined;

    // Bind holder for later setup or assertions in this scope.
    const holder = prisma.$transaction(
      // Execute the next setup or assertion step for this scenario.
      async (tx) => {
        // pidRows: synchronize actors so the race window is observable.
        const pidRows = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::int AS pid
        `;
        // Execute the next setup or assertion step for this scenario.
        holderPid = pidRows[0]!.pid;
        // Await async work before asserting or releasing locks.
        await tx.$executeRaw`
          SELECT id FROM "Location" WHERE id = ${world.loc1Id} FOR UPDATE
        `;
        // Concurrency/isolation step for the race under test.
        lockHeld = true;
        // Await async work before asserting or releasing locks.
        await gate;
      },
      // Runner option controlling stability or isolation of the suite.
      { timeout: 60_000, maxWait: 60_000 },
    );

    // Try path where partial failure must not leak suite state.
    try {
      // Repeat/poll to widen the race window or wait for lock waiters.
      for (let i = 0; i < 100 && !lockHeld; i += 1) {
        // Brief yield so lock waiters/UI can settle before asserting.
        await new Promise((r) => setTimeout(r, 20));
      }
      // Assert the observed value matches the intended post-condition.
      assert.ok(lockHeld && holderPid != null);

      // Bind auth for later setup or assertions in this scope.
      const auth = {
        // Execute the next setup or assertion step for this scenario.
        scope: allScope(world.manager.employeeId),
        // Delivery/replay step for async notification paths.
        allowCrossSectorTransfer: true,
      };
      // Bind setA2 for later setup or assertions in this scope.
      const setA2 = [world.loc1Id, world.loc3Id];
      // Bind setForeign for later setup or assertions in this scope.
      const setForeign = [world.loc1Id, world.loc4Id];
      // Execute the next setup or assertion step for this scenario.
      p1 = setSectorLocationsAtHead(prisma, world.sectorA2Id, setA2, {
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.manager.employeeId,
        // Continue the call chain for setup or assertion detail.
        ...auth,
      });
      // Execute the next setup or assertion step for this scenario.
      p2 = setSectorLocationsAtHead(prisma, world.sectorForeignId, setForeign, {
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.manager.employeeId,
        // Continue the call chain for setup or assertion detail.
        ...auth,
      });

      // blocked: synchronize actors so the race window is observable.
      const blocked = await waitForBlockedByHolder(prisma, holderPid!, 2, 12_000);
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.ok(blocked.length >= 2, `expected 2 waiters, got ${blocked.length}`);
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Concurrency/isolation step for the race under test.
        !blocked.includes(holderPid!),
        // Concurrency/isolation step for the race under test.
        "blocked pids must be production ops, not the holder",
      );

      // Execute the next setup or assertion step for this scenario.
      release();
      // Await async work before asserting or releasing locks.
      await holder;

      // settled: capture concurrent outcomes for race assertions.
      const settled = await Promise.allSettled([p1, p2]);
      // Concurrency/isolation step for the race under test.
      assertSettledMembershipRace(settled, {
        // Execute the next setup or assertion step for this scenario.
        contestedLocationId: world.loc1Id,
        // Execute the next setup or assertion step for this scenario.
        winnerSets: [setA2, setForeign],
      });

      // rows: synchronize actors so the race window is observable.
      const rows = await prisma.sectorLocation.findMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { locationId: world.loc1Id },
      });
      // Assert collection size matches the expected post-condition.
      assert.equal(rows.length, 1);
      // winnerSectorId: unique stamp so parallel runs do not collide.
      const winnerSectorId = rows[0]!.sectorId;
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        winnerSectorId === world.sectorA2Id ||
          // Execute the next setup or assertion step for this scenario.
          winnerSectorId === world.sectorForeignId,
      );
      // members: synchronize actors so the race window is observable.
      const members = await sectorMemberIds(prisma, winnerSectorId);
      // Bind expected for later setup or assertions in this scope.
      const expected =
        // Execute the next setup or assertion step for this scenario.
        winnerSectorId === world.sectorA2Id
          ? sortedJoin(setA2)
          : sortedJoin(setForeign);
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.equal(sortedJoin(members), expected);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Execute the next setup or assertion step for this scenario.
      release();
      // Await async work before asserting or releasing locks.
      await holder.catch(() => undefined);
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (p1 && p2) await Promise.allSettled([p1, p2]);
    }
  });

  // Case checks authz/session policy: auth TOCTOU: steal under Location holder → supervisor 403.
  it("auth TOCTOU: steal under Location holder → supervisor 403", async () => {
    // Concurrency/isolation step for the race under test.
    let raceErr: unknown;
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await runWhileLocationLockedWithTx({
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Execute the next setup or assertion step for this scenario.
        locationId: world.loc1Id,
        // Concurrency/isolation step for the race under test.
        startRace: async () => {
          // Try path where partial failure must not leak suite state.
          try {
            // Return the arranged value/result to the caller.
            return await setSectorLocationsAtHead(prisma, world.sectorA2Id, [world.loc1Id], {
              // Execute the next setup or assertion step for this scenario.
              actorEmployeeId: world.supervisorA.employeeId,
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
          // Execute the next setup or assertion step for this scenario.
          } catch (err) {
            // Concurrency/isolation step for the race under test.
            raceErr = err;
            // Surface a hard failure when isolation or contract is violated.
            throw err;
          }
        },
        // Concurrency/isolation step for the race under test.
        whileBlocked: async ({ tx }) => {
          // Steal membership under the held Location lock without taking
          // source-sector FOR NO KEY UPDATE (R2 production path locks sources
          // before Locations; doing that here while holding Location deadlocks
          // the blocked supervisor writer that already holds those sectors).
          await tx.$executeRaw`
            SELECT id FROM "Sector" WHERE id = ${world.sectorForeignId}
            FOR NO KEY UPDATE
          `;
          // Await async work before asserting or releasing locks.
          await tx.sectorLocation.deleteMany({
            // SQL fragment used to observe locks or assert DB state.
            where: { locationId: { in: [world.loc1Id, world.loc4Id] } },
          });
          // Seed prerequisite rows so the mutation under test has a realistic baseline.
          await tx.sectorLocation.createMany({
            // Execute the next setup or assertion step for this scenario.
            data: [
              // Execute the next setup or assertion step for this scenario.
              { sectorId: world.sectorForeignId, locationId: world.loc1Id },
              // Execute the next setup or assertion step for this scenario.
              { sectorId: world.sectorForeignId, locationId: world.loc4Id },
            ],
          });
        },
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected supervisor setSectorLocations to fail");
    // Execute the next setup or assertion step for this scenario.
    } catch {
      // expected
    }

    // Assert the observed value matches the intended post-condition.
    assert.ok(raceErr instanceof AppError, String(raceErr));
    // Assert HTTP status matches the contract for this path.
    assert.equal((raceErr as AppError).status, 403);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Concurrency/isolation step for the race under test.
      (raceErr as AppError).message,
      // Execute the next setup or assertion step for this scenario.
      "Outside your permitted data scope",
    );

    // snap: synchronize actors so the race window is observable.
    const snap = await membershipSnapshot(prisma, [world.loc1Id]);
    // Assert the observed value matches the intended post-condition.
    assert.equal(snap.get(world.loc1Id), world.sectorForeignId);
    // a2: synchronize actors so the race window is observable.
    const a2 = await sectorMemberIds(prisma, world.sectorA2Id);
    // Assert the observed value matches the intended post-condition.
    assert.ok(!a2.includes(world.loc1Id));
  });

  // Case: move ∥ createCleaningTask both succeed on free day.
  it("move ∥ createCleaningTask both succeed on free day", async () => {
    // Bind hotelDate for later setup or assertions in this scope.
    const hotelDate = "2099-09-15";
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: world.loc1Id,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${hotelDate}T00:00:00.000Z`),
      },
    });

    // Execute the next setup or assertion step for this scenario.
    let release!: () => void;
    // Bind gate for later setup or assertions in this scope.
    const gate = new Promise<void>((r) => {
      // Execute the next setup or assertion step for this scenario.
      release = r;
    });
    // Execute the next setup or assertion step for this scenario.
    let holderPid: number | null = null;
    // Bind lockHeld for later setup or assertions in this scope.
    let lockHeld = false;

    // Bind holder for later setup or assertions in this scope.
    const holder = prisma.$transaction(
      // Execute the next setup or assertion step for this scenario.
      async (tx) => {
        // pidRows: synchronize actors so the race window is observable.
        const pidRows = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::int AS pid
        `;
        // Execute the next setup or assertion step for this scenario.
        holderPid = pidRows[0]!.pid;
        // Await async work before asserting or releasing locks.
        await tx.$executeRaw`
          SELECT id FROM "Location" WHERE id = ${world.loc1Id} FOR UPDATE
        `;
        // Concurrency/isolation step for the race under test.
        lockHeld = true;
        // Await async work before asserting or releasing locks.
        await gate;
      },
      // Runner option controlling stability or isolation of the suite.
      { timeout: 30_000, maxWait: 30_000 },
    );

    // Try path where partial failure must not leak suite state.
    try {
      // Repeat/poll to widen the race window or wait for lock waiters.
      for (let i = 0; i < 100 && !lockHeld; i += 1) {
        // Brief yield so lock waiters/UI can settle before asserting.
        await new Promise((r) => setTimeout(r, 20));
      }
      // Assert the observed value matches the intended post-condition.
      assert.ok(lockHeld && holderPid != null);

      // Bind moveP for later setup or assertions in this scope.
      const moveP = setSectorLocationsAtHead(prisma, 
        // Execute the next setup or assertion step for this scenario.
        world.sectorA2Id,
        // Execute the next setup or assertion step for this scenario.
        [world.loc1Id, world.loc3Id],
        {
          // Execute the next setup or assertion step for this scenario.
          actorEmployeeId: world.manager.employeeId,
          // Execute the next setup or assertion step for this scenario.
          scope: allScope(),
          // Delivery/replay step for async notification paths.
          allowCrossSectorTransfer: true,
        },
      );
      // Bind createP for later setup or assertions in this scope.
      const createP = createCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        locationId: world.loc1Id,
        // Execute the next setup or assertion step for this scenario.
        hotelDate,
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.housekeeper.employeeId,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.manager.employeeId,
      });

      // Await async work before asserting or releasing locks.
      await waitForBlockedByHolder(prisma, holderPid!, 1);
      // Execute the next setup or assertion step for this scenario.
      release();
      // Await async work before asserting or releasing locks.
      await holder;

      // Run actors together to expose races and serialization bugs.
      const [moved, created] = await Promise.all([moveP, createP]);
      // Assert the observed value matches the intended post-condition.
      assert.ok(moved);
      // Assert the observed value matches the intended post-condition.
      assert.ok(created?.id);
      // snap: synchronize actors so the race window is observable.
      const snap = await membershipSnapshot(prisma, [world.loc1Id]);
      // Assert the observed value matches the intended post-condition.
      assert.equal(snap.get(world.loc1Id), world.sectorA2Id);
      // task: synchronize actors so the race window is observable.
      const task = await prisma.cleaningTask.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: created.id },
      });
      // Assert the observed value matches the intended post-condition.
      assert.ok(task);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Execute the next setup or assertion step for this scenario.
      release();
      // Await async work before asserting or releasing locks.
      await holder.catch(() => undefined);
    }
  });

  // Case probes concurrency/isolation: same-destination concurrent replaces settle without 500.
  it("same-destination concurrent replaces settle without 500", async () => {
    // Execute the next setup or assertion step for this scenario.
    let release!: () => void;
    // Bind gate for later setup or assertions in this scope.
    const gate = new Promise<void>((r) => {
      // Execute the next setup or assertion step for this scenario.
      release = r;
    });
    // Execute the next setup or assertion step for this scenario.
    let holderPid: number | null = null;
    // Bind lockHeld for later setup or assertions in this scope.
    let lockHeld = false;
    // Execute the next setup or assertion step for this scenario.
    let p1: Promise<unknown> | undefined;
    // Execute the next setup or assertion step for this scenario.
    let p2: Promise<unknown> | undefined;

    // Bind holder for later setup or assertions in this scope.
    const holder = prisma.$transaction(
      // Execute the next setup or assertion step for this scenario.
      async (tx) => {
        // pidRows: synchronize actors so the race window is observable.
        const pidRows = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::int AS pid
        `;
        // Execute the next setup or assertion step for this scenario.
        holderPid = pidRows[0]!.pid;
        // Await async work before asserting or releasing locks.
        await tx.$executeRaw`
          SELECT id FROM "Sector" WHERE id = ${world.sectorA1Id} FOR NO KEY UPDATE
        `;
        // Concurrency/isolation step for the race under test.
        lockHeld = true;
        // Await async work before asserting or releasing locks.
        await gate;
      },
      // Runner option controlling stability or isolation of the suite.
      { timeout: 60_000, maxWait: 60_000 },
    );

    // Try path where partial failure must not leak suite state.
    try {
      // Repeat/poll to widen the race window or wait for lock waiters.
      for (let i = 0; i < 100 && !lockHeld; i += 1) {
        // Brief yield so lock waiters/UI can settle before asserting.
        await new Promise((r) => setTimeout(r, 20));
      }
      // Assert the observed value matches the intended post-condition.
      assert.ok(lockHeld && holderPid != null);

      // Bind auth for later setup or assertions in this scope.
      const auth = {
        // Execute the next setup or assertion step for this scenario.
        scope: allScope(),
        // Delivery/replay step for async notification paths.
        allowCrossSectorTransfer: true,
      };
      // Bind opt1 for later setup or assertions in this scope.
      const opt1 = [world.loc1Id, world.loc2Id];
      // Bind opt2 for later setup or assertions in this scope.
      const opt2 = [world.loc1Id, world.loc5Id];
      // Execute the next setup or assertion step for this scenario.
      p1 = setSectorLocationsAtHead(prisma, world.sectorA1Id, opt1, {
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.manager.employeeId,
        // Continue the call chain for setup or assertion detail.
        ...auth,
      });
      // Execute the next setup or assertion step for this scenario.
      p2 = setSectorLocationsAtHead(prisma, world.sectorA1Id, opt2, {
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.manager.employeeId,
        // Continue the call chain for setup or assertion detail.
        ...auth,
      });

      // blocked: synchronize actors so the race window is observable.
      const blocked = await waitForBlockedByHolder(prisma, holderPid!, 2, 12_000);
      // Assert collection size matches the expected post-condition.
      assert.ok(blocked.length >= 2);

      // Execute the next setup or assertion step for this scenario.
      release();
      // Await async work before asserting or releasing locks.
      await holder;

      // settled: capture concurrent outcomes for race assertions.
      const settled = await Promise.allSettled([p1, p2]);
      // Concurrency/isolation step for the race under test.
      assertSettledMembershipRace(settled, {
        // Execute the next setup or assertion step for this scenario.
        contestedLocationId: world.loc1Id,
        // Execute the next setup or assertion step for this scenario.
        winnerSets: [opt1, opt2],
      });

      // members: synchronize actors so the race window is observable.
      const members = await sectorMemberIds(prisma, world.sectorA1Id);
      // Bind asSet for later setup or assertions in this scope.
      const asSet = sortedJoin(members);
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Delivery/replay step for async notification paths.
        asSet === sortedJoin(opt1) || asSet === sortedJoin(opt2),
        // Delivery/replay step for async notification paths.
        `unexpected members ${asSet}`,
      );
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Execute the next setup or assertion step for this scenario.
      release();
      // Await async work before asserting or releasing locks.
      await holder.catch(() => undefined);
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (p1 && p2) await Promise.allSettled([p1, p2]);
    }
  });
});
