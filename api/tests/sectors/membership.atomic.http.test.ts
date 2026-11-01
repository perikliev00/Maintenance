/**
 * T-SEC-60 — atomic membership replace (success, refuse, mid-TX rollback).
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  closeServer,
  listenApp,
  loginBearer,
  putJson,
} from "../httpHarness";
import {
  cleanupSectorsWorld,
  createSectorsWorld,
  membershipSnapshot,
  resetSectorMemberships,
  sectorMemberIds,
  type SectorsWorld,
} from "./fixtures";

const prisma = new PrismaClient();
const OUT_OF_SCOPE = "Outside your permitted data scope";

const allLocs = (w: SectorsWorld) => [
  w.loc1Id,
  w.loc2Id,
  w.loc3Id,
  w.loc4Id,
  w.loc5Id,
];

async function sectorVersion(sectorId: string): Promise<number> {
  const row = await prisma.sector.findUniqueOrThrow({ where: { id: sectorId } });
  return row.version;
}

describe("sector membership atomic HTTP (T-SEC-60)", () => {
  let world: SectorsWorld;
  let api: string;
  let server: import("node:http").Server;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    world = await createSectorsWorld(prisma);
    ({ server, api } = await listenApp());
  });

  after(async () => {
    await closeServer(server);
    if (world) await cleanupSectorsWorld(prisma, world);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetSectorMemberships(prisma, world);
  });

  it("T-SEC-60a successful multi-move to S2", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const before = await membershipSnapshot(prisma, allLocs(world));
    const res = await putJson(
      api,
      mgr.token,
      `/sectors/${world.sectorA2Id}/locations`,
      {
        locationIds: [world.loc1Id, world.loc2Id, world.loc3Id],
        expectedVersion: await sectorVersion(world.sectorA2Id),
      },
    );
    assert.equal(res.status, 200);
    const after = await membershipSnapshot(prisma, allLocs(world));
    assert.equal(after.get(world.loc1Id), world.sectorA2Id);
    assert.equal(after.get(world.loc2Id), world.sectorA2Id);
    assert.equal(after.get(world.loc3Id), world.sectorA2Id);
    assert.equal(after.get(world.loc4Id), before.get(world.loc4Id));
    const a1 = await sectorMemberIds(prisma, world.sectorA1Id);
    assert.deepEqual(a1, []);
  });

  it("T-SEC-60b mixed forbidden room → 403; entire selection unchanged", async () => {
    const sup = await loginBearer(
      api,
      world.supervisorA.email,
      world.password,
    );
    const before = await membershipSnapshot(prisma, allLocs(world));
    const beforeA1 = await sectorMemberIds(prisma, world.sectorA1Id);
    const res = await putJson(
      api,
      sup.token,
      `/sectors/${world.sectorA1Id}/locations`,
      {
        locationIds: [world.loc1Id, world.loc4Id],
        expectedVersion: await sectorVersion(world.sectorA1Id),
      },
    );
    assert.equal(res.status, 403);
    assert.equal((res.body as { message?: string }).message, OUT_OF_SCOPE);
    const after = await membershipSnapshot(prisma, allLocs(world));
    assert.deepEqual(
      Object.fromEntries(after),
      Object.fromEntries(before),
    );
    assert.deepEqual(
      await sectorMemberIds(prisma, world.sectorA1Id),
      beforeA1,
    );
  });

  it("T-SEC-60c unknown location → 400; membership unchanged", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const before = await membershipSnapshot(prisma, allLocs(world));
    const res = await putJson(
      api,
      mgr.token,
      `/sectors/${world.sectorA1Id}/locations`,
      {
        locationIds: [world.loc1Id, "nonexistent-location-id"],
        expectedVersion: await sectorVersion(world.sectorA1Id),
      },
    );
    assert.equal(res.status, 400);
    assert.equal((res.body as { error?: string }).error, "validation");
    const after = await membershipSnapshot(prisma, allLocs(world));
    assert.deepEqual(
      Object.fromEntries(after),
      Object.fromEntries(before),
    );
  });

  it("T-SEC-60d full replace drops omitted own rooms to unassigned", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const res = await putJson(
      api,
      mgr.token,
      `/sectors/${world.sectorA1Id}/locations`,
      {
        locationIds: [world.loc1Id],
        expectedVersion: await sectorVersion(world.sectorA1Id),
      },
    );
    assert.equal(res.status, 200);
    const after = await membershipSnapshot(prisma, [
      world.loc1Id,
      world.loc2Id,
    ]);
    assert.equal(after.get(world.loc1Id), world.sectorA1Id);
    assert.equal(after.get(world.loc2Id), null);
  });

  it("T-SEC-60e mid-TX rollback via BEFORE INSERT trigger", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const before = await membershipSnapshot(prisma, allLocs(world));
    const beforeA1 = await sectorMemberIds(prisma, world.sectorA1Id);
    const beforeA2 = await sectorMemberIds(prisma, world.sectorA2Id);
    const fn = `sec_fail_ins_${world.stamp.replace(/[^a-zA-Z0-9]/g, "")}`;
    const trg = `trg_${fn}`;

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'test-forced-sector-location-insert-failure';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${trg}
      BEFORE INSERT ON "SectorLocation"
      FOR EACH ROW
      WHEN (NEW."sectorId" = '${world.sectorA2Id}')
      EXECUTE FUNCTION ${fn}();
    `);

    try {
      const res = await putJson(
        api,
        mgr.token,
        `/sectors/${world.sectorA2Id}/locations`,
        {
          locationIds: [world.loc1Id, world.loc2Id, world.loc3Id],
          expectedVersion: await sectorVersion(world.sectorA2Id),
        },
      );
      assert.notEqual(res.status, 200);
      const after = await membershipSnapshot(prisma, allLocs(world));
      assert.deepEqual(
        Object.fromEntries(after),
        Object.fromEntries(before),
      );
      assert.deepEqual(
        await sectorMemberIds(prisma, world.sectorA1Id),
        beforeA1,
      );
      assert.deepEqual(
        await sectorMemberIds(prisma, world.sectorA2Id),
        beforeA2,
      );
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${trg} ON "SectorLocation"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
  });
});
