/**
 * d — membership concurrency after Location/Sector locks.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient, Role } from "@prisma/client";
import { AppError } from "../../src/errors";
import { createCleaningTask } from "../../src/services/cleaning/tasks";
import type { DataScope } from "../../src/services/dataScope";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  cleanupSectorsWorld,
  createSectorsWorld,
  membershipSnapshot,
  resetSectorMemberships,
  runWhileLocationLockedWithTx,
  sectorMemberIds,
  setSectorLocationsAtHead,
  waitForBlockedByHolder,
  type SectorsWorld,
} from "./fixtures";

const prisma = new PrismaClient();

function allScope(employeeId = ""): DataScope {
  return { kind: "all", employeeId, role: Role.manager, sectorIds: [] };
}

function sectorsScope(employeeId: string, sectorIds: string[]): DataScope {
  return {
    kind: "sectors",
    employeeId,
    role: Role.supervisor,
    sectorIds,
  };
}

function sortedJoin(ids: string[]): string {
  return [...ids].sort().join(",");
}

/** Dual-claim settle: only AppError 409 conflict is an acceptable rejection. */
function assertSettledMembershipRace(
  settled: PromiseSettledResult<unknown>[],
  opts: {
    contestedLocationId: string;
    winnerSets: string[][];
  },
): void {
  const fulfilled = settled.filter((s) => s.status === "fulfilled");
  const rejected = settled.filter((s) => s.status === "rejected");
  assert.ok(
    fulfilled.length >= 1,
    `expected at least one fulfilled op, got ${JSON.stringify(
      settled.map((s) =>
        s.status === "fulfilled"
          ? "fulfilled"
          : String((s as PromiseRejectedResult).reason),
      ),
    )}`,
  );

  for (const s of rejected) {
    const err = (s as PromiseRejectedResult).reason;
    assert.ok(
      err instanceof AppError,
      `rejected must be AppError, got ${String(err)}`,
    );
    assert.equal(
      err.status,
      409,
      `rejected status must be 409, got ${err.status}: ${err.message}`,
    );
    assert.ok(
      err.code === "conflict" || err.code === "version_conflict",
      `rejected code must be conflict|version_conflict, got ${err.code}: ${err.message}`,
    );
  }
}

describe("sector membership concurrency", () => {
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
    await prisma.cleaningTask.deleteMany({
      where: {
        locationId: {
          in: [
            world.loc1Id,
            world.loc2Id,
            world.loc3Id,
            world.loc4Id,
            world.loc5Id,
          ],
        },
      },
    });
  });

  it("dual-claim different destinations; PID blocking; one membership", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let holderPid: number | null = null;
    let lockHeld = false;
    let p1: Promise<unknown> | undefined;
    let p2: Promise<unknown> | undefined;

    const holder = prisma.$transaction(
      async (tx) => {
        const pidRows = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::int AS pid
        `;
        holderPid = pidRows[0]!.pid;
        await tx.$executeRaw`
          SELECT id FROM "Location" WHERE id = ${world.loc1Id} FOR UPDATE
        `;
        lockHeld = true;
        await gate;
      },
      { timeout: 60_000, maxWait: 60_000 },
    );

    try {
      for (let i = 0; i < 100 && !lockHeld; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(lockHeld && holderPid != null);

      const auth = {
        scope: allScope(world.manager.employeeId),
        allowCrossSectorTransfer: true,
      };
      const setA2 = [world.loc1Id, world.loc3Id];
      const setForeign = [world.loc1Id, world.loc4Id];
      p1 = setSectorLocationsAtHead(prisma, world.sectorA2Id, setA2, {
        actorEmployeeId: world.manager.employeeId,
        ...auth,
      });
      p2 = setSectorLocationsAtHead(prisma, world.sectorForeignId, setForeign, {
        actorEmployeeId: world.manager.employeeId,
        ...auth,
      });

      const blocked = await waitForBlockedByHolder(prisma, holderPid!, 2, 12_000);
      assert.ok(blocked.length >= 2, `expected 2 waiters, got ${blocked.length}`);
      assert.ok(
        !blocked.includes(holderPid!),
        "blocked pids must be production ops, not the holder",
      );

      release();
      await holder;

      const settled = await Promise.allSettled([p1, p2]);
      assertSettledMembershipRace(settled, {
        contestedLocationId: world.loc1Id,
        winnerSets: [setA2, setForeign],
      });

      const rows = await prisma.sectorLocation.findMany({
        where: { locationId: world.loc1Id },
      });
      assert.equal(rows.length, 1);
      const winnerSectorId = rows[0]!.sectorId;
      assert.ok(
        winnerSectorId === world.sectorA2Id ||
          winnerSectorId === world.sectorForeignId,
      );
      const members = await sectorMemberIds(prisma, winnerSectorId);
      const expected =
        winnerSectorId === world.sectorA2Id
          ? sortedJoin(setA2)
          : sortedJoin(setForeign);
      assert.equal(sortedJoin(members), expected);
    } finally {
      release();
      await holder.catch(() => undefined);
      if (p1 && p2) await Promise.allSettled([p1, p2]);
    }
  });

  it("auth TOCTOU: steal under Location holder → supervisor 403", async () => {
    let raceErr: unknown;
    try {
      await runWhileLocationLockedWithTx({
        prisma,
        locationId: world.loc1Id,
        startRace: async () => {
          try {
            return await setSectorLocationsAtHead(prisma, world.sectorA2Id, [world.loc1Id], {
              actorEmployeeId: world.supervisorA.employeeId,
              scope: sectorsScope(world.supervisorA.employeeId, [
                world.sectorA1Id,
                world.sectorA2Id,
              ]),
              allowCrossSectorTransfer: false,
            });
          } catch (err) {
            raceErr = err;
            throw err;
          }
        },
        whileBlocked: async ({ tx }) => {
          // Steal membership under the held Location lock without taking
          // source-sector FOR NO KEY UPDATE (R2 production path locks sources
          // before Locations; doing that here while holding Location deadlocks
          // the blocked supervisor writer that already holds those sectors).
          await tx.$executeRaw`
            SELECT id FROM "Sector" WHERE id = ${world.sectorForeignId}
            FOR NO KEY UPDATE
          `;
          await tx.sectorLocation.deleteMany({
            where: { locationId: { in: [world.loc1Id, world.loc4Id] } },
          });
          await tx.sectorLocation.createMany({
            data: [
              { sectorId: world.sectorForeignId, locationId: world.loc1Id },
              { sectorId: world.sectorForeignId, locationId: world.loc4Id },
            ],
          });
        },
      });
      assert.fail("expected supervisor setSectorLocations to fail");
    } catch {
      // expected
    }

    assert.ok(raceErr instanceof AppError, String(raceErr));
    assert.equal((raceErr as AppError).status, 403);
    assert.equal(
      (raceErr as AppError).message,
      "Outside your permitted data scope",
    );

    const snap = await membershipSnapshot(prisma, [world.loc1Id]);
    assert.equal(snap.get(world.loc1Id), world.sectorForeignId);
    const a2 = await sectorMemberIds(prisma, world.sectorA2Id);
    assert.ok(!a2.includes(world.loc1Id));
  });

  it("move ∥ createCleaningTask both succeed on free day", async () => {
    const hotelDate = "2099-09-15";
    await prisma.cleaningTask.deleteMany({
      where: {
        locationId: world.loc1Id,
        hotelDate: new Date(`${hotelDate}T00:00:00.000Z`),
      },
    });

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let holderPid: number | null = null;
    let lockHeld = false;

    const holder = prisma.$transaction(
      async (tx) => {
        const pidRows = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::int AS pid
        `;
        holderPid = pidRows[0]!.pid;
        await tx.$executeRaw`
          SELECT id FROM "Location" WHERE id = ${world.loc1Id} FOR UPDATE
        `;
        lockHeld = true;
        await gate;
      },
      { timeout: 30_000, maxWait: 30_000 },
    );

    try {
      for (let i = 0; i < 100 && !lockHeld; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(lockHeld && holderPid != null);

      const moveP = setSectorLocationsAtHead(prisma, 
        world.sectorA2Id,
        [world.loc1Id, world.loc3Id],
        {
          actorEmployeeId: world.manager.employeeId,
          scope: allScope(),
          allowCrossSectorTransfer: true,
        },
      );
      const createP = createCleaningTask({
        locationId: world.loc1Id,
        hotelDate,
        assignedEmployeeId: world.housekeeper.employeeId,
        actorEmployeeId: world.manager.employeeId,
      });

      await waitForBlockedByHolder(prisma, holderPid!, 1);
      release();
      await holder;

      const [moved, created] = await Promise.all([moveP, createP]);
      assert.ok(moved);
      assert.ok(created?.id);
      const snap = await membershipSnapshot(prisma, [world.loc1Id]);
      assert.equal(snap.get(world.loc1Id), world.sectorA2Id);
      const task = await prisma.cleaningTask.findUniqueOrThrow({
        where: { id: created.id },
      });
      assert.ok(task);
    } finally {
      release();
      await holder.catch(() => undefined);
    }
  });

  it("same-destination concurrent replaces settle without 500", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let holderPid: number | null = null;
    let lockHeld = false;
    let p1: Promise<unknown> | undefined;
    let p2: Promise<unknown> | undefined;

    const holder = prisma.$transaction(
      async (tx) => {
        const pidRows = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::int AS pid
        `;
        holderPid = pidRows[0]!.pid;
        await tx.$executeRaw`
          SELECT id FROM "Sector" WHERE id = ${world.sectorA1Id} FOR NO KEY UPDATE
        `;
        lockHeld = true;
        await gate;
      },
      { timeout: 60_000, maxWait: 60_000 },
    );

    try {
      for (let i = 0; i < 100 && !lockHeld; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(lockHeld && holderPid != null);

      const auth = {
        scope: allScope(),
        allowCrossSectorTransfer: true,
      };
      const opt1 = [world.loc1Id, world.loc2Id];
      const opt2 = [world.loc1Id, world.loc5Id];
      p1 = setSectorLocationsAtHead(prisma, world.sectorA1Id, opt1, {
        actorEmployeeId: world.manager.employeeId,
        ...auth,
      });
      p2 = setSectorLocationsAtHead(prisma, world.sectorA1Id, opt2, {
        actorEmployeeId: world.manager.employeeId,
        ...auth,
      });

      const blocked = await waitForBlockedByHolder(prisma, holderPid!, 2, 12_000);
      assert.ok(blocked.length >= 2);

      release();
      await holder;

      const settled = await Promise.allSettled([p1, p2]);
      assertSettledMembershipRace(settled, {
        contestedLocationId: world.loc1Id,
        winnerSets: [opt1, opt2],
      });

      const members = await sectorMemberIds(prisma, world.sectorA1Id);
      const asSet = sortedJoin(members);
      assert.ok(
        asSet === sortedJoin(opt1) || asSet === sortedJoin(opt2),
        `unexpected members ${asSet}`,
      );
    } finally {
      release();
      await holder.catch(() => undefined);
      if (p1 && p2) await Promise.allSettled([p1, p2]);
    }
  });
});
