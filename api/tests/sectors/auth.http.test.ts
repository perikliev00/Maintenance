/**
 * T-SEC-58 / T-SEC-59 — supervisor cannot create sectors or hand off primary.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { resolveDataScope } from "../../src/services/dataScope";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  closeServer,
  listenApp,
  loginBearer,
  patchJson,
  postJson,
} from "../httpHarness";
import {
  cleanupSectorsWorld,
  createSectorsWorld,
  resetSectorMemberships,
  type SectorsWorld,
} from "./fixtures";

const prisma = new PrismaClient();
const OUT_OF_SCOPE = "Outside your permitted data scope";

describe("sector auth HTTP (T-SEC-58 / T-SEC-59)", () => {
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

  it("T-SEC-58 supervisor POST create with self as primary → 403; scope unchanged", async () => {
    const beforeCount = await prisma.sector.count({
      where: { propertyId: world.propertyId },
    });
    const sup = await loginBearer(api, world.supervisorA.email, world.password);
    const authUser = {
      userId: world.supervisorA.userId,
      employeeId: world.supervisorA.employeeId,
      role: world.supervisorA.role,
      email: world.supervisorA.email,
      sid: "t-sec-58",
    };
    const scopeBefore = await resolveDataScope(authUser);

    const res = await postJson(api, sup.token, "/sectors", {
      code: `NEW-${world.stamp}`.slice(0, 32),
      nameBg: "Нов",
      nameEn: "New",
      primarySupervisorEmployeeId: world.supervisorA.employeeId,
    });

    assert.equal(res.status, 403);
    assert.equal((res.body as { error?: string }).error, "forbidden");
    assert.equal((res.body as { message?: string }).message, OUT_OF_SCOPE);

    const afterCount = await prisma.sector.count({
      where: { propertyId: world.propertyId },
    });
    assert.equal(afterCount, beforeCount);

    const scopeAfter = await resolveDataScope(authUser);
    assert.deepEqual(
      [...(scopeAfter.kind === "sectors" ? scopeAfter.sectorIds : [])].sort(),
      [...(scopeBefore.kind === "sectors" ? scopeBefore.sectorIds : [])].sort(),
    );
  });

  it("T-SEC-58p manager POST create → 201", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const code = `MGR-${world.stamp}`.slice(0, 32);
    const res = await postJson(api, mgr.token, "/sectors", {
      code,
      nameBg: "Мениджър",
      nameEn: "Manager",
      primarySupervisorEmployeeId: world.supervisorA.employeeId,
      propertyId: world.propertyId,
    });
    assert.equal(res.status, 201);
    const id = (res.body as { id: string }).id;
    assert.ok(id);
    await prisma.sectorLocation.deleteMany({ where: { sectorId: id } });
    await prisma.auditEvent.deleteMany({
      where: { entityType: "sector", entityId: id },
    });
    await prisma.sector.delete({ where: { id } });
  });

  it("T-SEC-59a supervisor PATCH primary to other → 403", async () => {
    const sup = await loginBearer(api, world.supervisorA.email, world.password);
    const ver = (
      await prisma.sector.findUniqueOrThrow({ where: { id: world.sectorA1Id } })
    ).version;
    const res = await patchJson(api, sup.token, `/sectors/${world.sectorA1Id}`, {
      primarySupervisorEmployeeId: world.supervisorB.employeeId,
      expectedVersion: ver,
    });
    assert.equal(res.status, 403);
    assert.equal((res.body as { message?: string }).message, OUT_OF_SCOPE);
    const row = await prisma.sector.findUniqueOrThrow({
      where: { id: world.sectorA1Id },
    });
    assert.equal(row.primarySupervisorEmployeeId, world.supervisorA.employeeId);
  });

  it("T-SEC-59b supervisor PATCH primary null → 403", async () => {
    const sup = await loginBearer(api, world.supervisorA.email, world.password);
    const ver = (
      await prisma.sector.findUniqueOrThrow({ where: { id: world.sectorA1Id } })
    ).version;
    const res = await patchJson(api, sup.token, `/sectors/${world.sectorA1Id}`, {
      primarySupervisorEmployeeId: null,
      expectedVersion: ver,
    });
    assert.equal(res.status, 403);
    const row = await prisma.sector.findUniqueOrThrow({
      where: { id: world.sectorA1Id },
    });
    assert.equal(row.primarySupervisorEmployeeId, world.supervisorA.employeeId);
  });

  it("T-SEC-59c supervisor PATCH name only → 200; primary unchanged", async () => {
    const sup = await loginBearer(api, world.supervisorA.email, world.password);
    const ver = (
      await prisma.sector.findUniqueOrThrow({ where: { id: world.sectorA1Id } })
    ).version;
    const res = await patchJson(api, sup.token, `/sectors/${world.sectorA1Id}`, {
      nameBg: "Преименувано A1",
      expectedVersion: ver,
    });
    assert.equal(res.status, 200);
    const row = await prisma.sector.findUniqueOrThrow({
      where: { id: world.sectorA1Id },
    });
    assert.equal(row.nameBg, "Преименувано A1");
    assert.equal(row.primarySupervisorEmployeeId, world.supervisorA.employeeId);
  });

  it("PATCH without expectedVersion → 400", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const res = await patchJson(api, mgr.token, `/sectors/${world.sectorA1Id}`, {
      nameBg: "No version",
    });
    assert.equal(res.status, 400);
  });
});
