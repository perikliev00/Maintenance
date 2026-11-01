/**
 * Atomic sector save (metadata + membership) + validation + version CAS.
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
  patchJson,
  putJson,
} from "../httpHarness";
import {
  cleanupSectorsWorld,
  createSectorsWorld,
  resetSectorMemberships,
  sectorMemberIds,
  type SectorsWorld,
} from "./fixtures";

const prisma = new PrismaClient();

describe("sector atomic save HTTP", () => {
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

  it("atomic PATCH updates metadata + membership together", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const before = await prisma.sector.findUniqueOrThrow({
      where: { id: world.sectorA1Id },
    });
    const res = await patchJson(api, mgr.token, `/sectors/${world.sectorA1Id}`, {
      nameBg: "Atomic BG",
      nameEn: "Atomic EN",
      locationIds: [world.loc1Id, world.loc3Id],
      expectedVersion: before.version,
    });
    assert.equal(res.status, 200);
    const body = res.body as {
      nameBg: string;
      locationIds: string[];
      version: number;
    };
    assert.equal(body.nameBg, "Atomic BG");
    assert.deepEqual([...body.locationIds].sort(), [
      world.loc1Id,
      world.loc3Id,
    ].sort());
    assert.equal(body.version, before.version + 1);
    assert.deepEqual(
      (await sectorMemberIds(prisma, world.sectorA1Id)).sort(),
      [world.loc1Id, world.loc3Id].sort(),
    );
  });

  it("rejects whitespace-only code", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const before = await prisma.sector.findUniqueOrThrow({
      where: { id: world.sectorA1Id },
    });
    const res = await patchJson(api, mgr.token, `/sectors/${world.sectorA1Id}`, {
      code: "   ",
      expectedVersion: before.version,
    });
    assert.equal(res.status, 400);
  });

  it("rejects missing expectedVersion", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const res = await patchJson(api, mgr.token, `/sectors/${world.sectorA1Id}`, {
      nameBg: "Missing version",
    });
    assert.equal(res.status, 400);
  });

  it("rejects housekeeper as primary supervisor", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const before = await prisma.sector.findUniqueOrThrow({
      where: { id: world.sectorA1Id },
    });
    const res = await patchJson(api, mgr.token, `/sectors/${world.sectorA1Id}`, {
      primarySupervisorEmployeeId: world.housekeeper.employeeId,
      expectedVersion: before.version,
    });
    assert.equal(res.status, 400);
    assert.match(
      String((res.body as { message?: string }).message ?? ""),
      /supervisory role/i,
    );
  });

  it("version conflict leaves membership unchanged", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const beforeMembers = await sectorMemberIds(prisma, world.sectorA1Id);
    const res = await patchJson(api, mgr.token, `/sectors/${world.sectorA1Id}`, {
      nameBg: "Stale",
      locationIds: [world.loc5Id],
      expectedVersion: 1,
    });
    // Sector may already be >1 from earlier tests in this file; force stale.
    const current = await prisma.sector.findUniqueOrThrow({
      where: { id: world.sectorA1Id },
    });
    const stale = await patchJson(
      api,
      mgr.token,
      `/sectors/${world.sectorA1Id}`,
      {
        nameBg: "Stale2",
        locationIds: [world.loc5Id],
        expectedVersion: current.version - 1 > 0 ? current.version - 1 : 999999,
      },
    );
    // If version was 1 and we sent 999999, conflict; if we sent version-1 and it was 1, also conflict via 999999 path.
    assert.equal(stale.status === 409 || res.status === 409, true);
    void beforeMembers;
    const after = await sectorMemberIds(prisma, world.sectorA1Id);
    // Ensure a deliberate conflict attempt with wrong version:
    const conflict = await patchJson(
      api,
      mgr.token,
      `/sectors/${world.sectorA1Id}`,
      {
        nameBg: "Conflict",
        locationIds: [world.loc5Id],
        expectedVersion: (await prisma.sector.findUniqueOrThrow({
          where: { id: world.sectorA1Id },
        })).version + 10,
      },
    );
    assert.equal(conflict.status, 409);
    assert.equal(
      (conflict.body as { error?: string }).error,
      "version_conflict",
    );
    assert.deepEqual(
      (await sectorMemberIds(prisma, world.sectorA1Id)).sort(),
      after.sort(),
    );
  });

  it("PUT locations supports expectedVersion", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const before = await prisma.sector.findUniqueOrThrow({
      where: { id: world.sectorA2Id },
    });
    const res = await putJson(
      api,
      mgr.token,
      `/sectors/${world.sectorA2Id}/locations`,
      {
        locationIds: [world.loc3Id],
        expectedVersion: before.version,
      },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await sectorMemberIds(prisma, world.sectorA2Id), [
      world.loc3Id,
    ]);
  });

  it("PUT locations without expectedVersion → 400", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const res = await putJson(
      api,
      mgr.token,
      `/sectors/${world.sectorA2Id}/locations`,
      { locationIds: [world.loc3Id] },
    );
    assert.equal(res.status, 400);
  });
});
