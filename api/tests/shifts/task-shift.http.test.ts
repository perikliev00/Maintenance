/**
 * create/reassign assertActiveShiftId HTTP contracts.
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
  postJson,
} from "../httpHarness";
import {
  cleanupSectorsWorld,
  createSectorsWorld,
  resetSectorMemberships,
  type SectorsWorld,
} from "../sectors/fixtures";
import {
  cleanupShiftsWorld,
  createShiftsWorld,
  type ShiftsWorld,
} from "./fixtures";

const prisma = new PrismaClient();

describe("cleaning task shiftId HTTP", () => {
  let sectors: SectorsWorld;
  let shifts: ShiftsWorld;
  let api: string;
  let server: import("node:http").Server;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    sectors = await createSectorsWorld(prisma);
    shifts = await createShiftsWorld(prisma);
    ({ server, api } = await listenApp());
  });

  after(async () => {
    await closeServer(server);
    if (shifts) await cleanupShiftsWorld(prisma, shifts);
    if (sectors) await cleanupSectorsWorld(prisma, sectors);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetSectorMemberships(prisma, sectors);
    await prisma.cleaningTask.deleteMany({
      where: {
        locationId: {
          in: [
            sectors.loc1Id,
            sectors.loc2Id,
            sectors.loc3Id,
            sectors.loc4Id,
            sectors.loc5Id,
          ],
        },
      },
    });
  });

  it("create with unknown shift → 404; no task", async () => {
    const mgr = await loginBearer(
      api,
      sectors.manager.email,
      sectors.password,
    );
    const before = await prisma.cleaningTask.count({
      where: { locationId: sectors.loc1Id },
    });
    const res = await postJson(api, mgr.token, "/cleaning/tasks", {
      locationId: sectors.loc1Id,
      hotelDate: "2099-11-01",
      assignedEmployeeId: sectors.housekeeper.employeeId,
      shiftId: "missing-shift-id",
    });
    assert.equal(res.status, 404);
    assert.equal((res.body as { error?: string }).error, "not_found");
    assert.equal(
      await prisma.cleaningTask.count({
        where: { locationId: sectors.loc1Id },
      }),
      before,
    );
  });

  it("create with inactive shift → 400 invalid_state", async () => {
    const mgr = await loginBearer(
      api,
      sectors.manager.email,
      sectors.password,
    );
    const before = await prisma.cleaningTask.count({
      where: { locationId: sectors.loc1Id },
    });
    const res = await postJson(api, mgr.token, "/cleaning/tasks", {
      locationId: sectors.loc1Id,
      hotelDate: "2099-11-02",
      assignedEmployeeId: sectors.housekeeper.employeeId,
      shiftId: shifts.shiftInactiveId,
    });
    assert.equal(res.status, 400);
    assert.equal((res.body as { error?: string }).error, "invalid_state");
    assert.equal(
      await prisma.cleaningTask.count({
        where: { locationId: sectors.loc1Id },
      }),
      before,
    );
  });

  it("reassign unknown shift → 404; unchanged", async () => {
    const mgr = await loginBearer(
      api,
      sectors.manager.email,
      sectors.password,
    );
    const created = await postJson(api, mgr.token, "/cleaning/tasks", {
      locationId: sectors.loc1Id,
      hotelDate: "2099-11-03",
      assignedEmployeeId: sectors.housekeeper.employeeId,
      shiftId: shifts.shiftMorningId,
    });
    assert.equal(created.status, 201);
    const task = created.body as { id: string; version: number; shiftId: string };
    const res = await postJson(
      api,
      mgr.token,
      `/cleaning/tasks/${task.id}/reassign`,
      {
        assignedEmployeeId: sectors.housekeeper.employeeId,
        reason: "unnamed case",
        shiftId: "missing-shift-id",
        expectedVersion: task.version,
      },
    );
    assert.equal(res.status, 404);
    const row = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(row.shiftId, shifts.shiftMorningId);
  });

  it("reassign inactive shift → 400", async () => {
    const mgr = await loginBearer(
      api,
      sectors.manager.email,
      sectors.password,
    );
    const created = await postJson(api, mgr.token, "/cleaning/tasks", {
      locationId: sectors.loc1Id,
      hotelDate: "2099-11-04",
      assignedEmployeeId: sectors.housekeeper.employeeId,
      shiftId: shifts.shiftMorningId,
    });
    const task = created.body as { id: string; version: number };
    const res = await postJson(
      api,
      mgr.token,
      `/cleaning/tasks/${task.id}/reassign`,
      {
        assignedEmployeeId: sectors.housekeeper.employeeId,
        reason: "unnamed case",
        shiftId: shifts.shiftInactiveId,
        expectedVersion: task.version,
      },
    );
    assert.equal(res.status, 400);
    assert.equal((res.body as { error?: string }).error, "invalid_state");
  });

  it("reassign shiftId null clears", async () => {
    const mgr = await loginBearer(
      api,
      sectors.manager.email,
      sectors.password,
    );
    const created = await postJson(api, mgr.token, "/cleaning/tasks", {
      locationId: sectors.loc1Id,
      hotelDate: "2099-11-05",
      assignedEmployeeId: sectors.housekeeper.employeeId,
      shiftId: shifts.shiftMorningId,
    });
    const task = created.body as { id: string; version: number };
    const res = await postJson(
      api,
      mgr.token,
      `/cleaning/tasks/${task.id}/reassign`,
      {
        assignedEmployeeId: sectors.housekeeper.employeeId,
        reason: "clear",
        shiftId: null,
        expectedVersion: task.version,
        // Fixture HK is off-roster; this case covers shiftId clearing, not availability.
        forceDespiteAvailability: true,
      },
    );
    assert.equal(res.status, 200);
    const row = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(row.shiftId, null);
  });

  it("reassign omit shiftId keeps previous", async () => {
    const mgr = await loginBearer(
      api,
      sectors.manager.email,
      sectors.password,
    );
    const created = await postJson(api, mgr.token, "/cleaning/tasks", {
      locationId: sectors.loc1Id,
      hotelDate: "2099-11-06",
      assignedEmployeeId: sectors.housekeeper.employeeId,
      shiftId: shifts.shiftEveningId,
    });
    const task = created.body as { id: string; version: number };
    const res = await postJson(
      api,
      mgr.token,
      `/cleaning/tasks/${task.id}/reassign`,
      {
        assignedEmployeeId: sectors.housekeeper.employeeId,
        reason: "omit",
        expectedVersion: task.version,
        // Fixture HK is off-roster; this case covers omit-shiftId keep, not availability.
        forceDespiteAvailability: true,
      },
    );
    assert.equal(res.status, 200);
    const row = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(row.shiftId, shifts.shiftEveningId);
  });
});
