/**
 * T-ATT-69a..f — POST /attendance/adjustments auth matrix (own/other × grant).
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient, Role } from "@prisma/client";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  closeServer,
  listenApp,
  loginBearer,
  postJson,
  restoreRoleGrants,
  snapshotRoleGrants,
  type RoleGrantSnapshotRow,
} from "../httpHarness";
import {
  ATT_PASSWORD,
  cleanupAttendanceWorld,
  createAttendanceWorld,
  createClosedInterval,
  ensureActionGrant,
  removeActionGrant,
  type AttendanceWorld,
} from "./fixtures";

const prisma = new PrismaClient();
const REQUEST_KEY = "attendance.request_adjustment";

describe("attendance adjustments auth HTTP (T-ATT-69)", () => {
  let world: AttendanceWorld;
  let api: string;
  let server: import("node:http").Server;
  let grantSnap: RoleGrantSnapshotRow[];
  let controlIntervalId: string;
  let controlSnapshot: {
    startedAt: Date;
    endedAt: Date | null;
    breakMinutes: number;
    workedMinutes: number | null;
    status: string;
    hotelDate: Date;
  };

  const hotelDate = new Date("2026-10-10T00:00:00.000Z");
  const startedAt = new Date("2026-10-10T08:00:00.000Z");
  const endedAt = new Date("2026-10-10T16:00:00.000Z");

  async function seedClosedFor(employeeId: string) {
    return createClosedInterval(prisma, {
      employeeId,
      hotelDate,
      startedAt,
      endedAt,
      breakMinutes: 0,
      workedMinutes: 480,
    });
  }

  async function snapshotInterval(id: string) {
    const row = await prisma.attendanceInterval.findUniqueOrThrow({
      where: { id },
    });
    return {
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      breakMinutes: row.breakMinutes,
      workedMinutes: row.workedMinutes,
      status: row.status,
      hotelDate: row.hotelDate,
    };
  }

  async function assertControlUnchanged() {
    const after = await snapshotInterval(controlIntervalId);
    assert.equal(after.startedAt.getTime(), controlSnapshot.startedAt.getTime());
    assert.equal(
      after.endedAt?.getTime() ?? null,
      controlSnapshot.endedAt?.getTime() ?? null,
    );
    assert.equal(after.breakMinutes, controlSnapshot.breakMinutes);
    assert.equal(after.workedMinutes, controlSnapshot.workedMinutes);
    assert.equal(after.status, controlSnapshot.status);
    assert.equal(
      after.hotelDate.getTime(),
      controlSnapshot.hotelDate.getTime(),
    );
  }

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    world = await createAttendanceWorld(prisma);
    grantSnap = await snapshotRoleGrants(prisma, world.grantRoles);
    const controlIv = await seedClosedFor(world.control.employeeId);
    controlIntervalId = controlIv.id;
    controlSnapshot = await snapshotInterval(controlIntervalId);
    ({ server, api } = await listenApp());
  });

  after(async () => {
    await closeServer(server);
    if (grantSnap) {
      await restoreRoleGrants(prisma, world.grantRoles, grantSnap);
    }
    if (world) await cleanupAttendanceWorld(prisma, world);
    await prisma.attendanceInterval.deleteMany({
      where: { id: controlIntervalId },
    });
    await prisma.$disconnect();
  });

  it("T-ATT-69a HK+grant+own → 201", async () => {
    const restore = await ensureActionGrant(
      prisma,
      Role.housekeeper,
      REQUEST_KEY,
    );
    try {
      const iv = await seedClosedFor(world.housekeeper.employeeId);
      const beforeCount = await prisma.attendanceAdjustment.count({
        where: { intervalId: iv.id },
      });
      const hk = await loginBearer(api, world.housekeeper.email, ATT_PASSWORD);
      const res = await postJson(api, hk.token, "/attendance/adjustments", {
        intervalId: iv.id,
        reason: "forgot break",
        proposedBreakMinutes: 15,
      });
      assert.equal(res.status, 201);
      const afterCount = await prisma.attendanceAdjustment.count({
        where: { intervalId: iv.id },
      });
      assert.equal(afterCount, beforeCount + 1);
      await assertControlUnchanged();
    } finally {
      await restore();
    }
  });

  it("T-ATT-69b HK+grant+other → 403; no Adjustment row", async () => {
    const restore = await ensureActionGrant(
      prisma,
      Role.housekeeper,
      REQUEST_KEY,
    );
    try {
      const iv = await seedClosedFor(world.technician.employeeId);
      const beforeCount = await prisma.attendanceAdjustment.count({
        where: { intervalId: iv.id },
      });
      const hk = await loginBearer(api, world.housekeeper.email, ATT_PASSWORD);
      const res = await postJson(api, hk.token, "/attendance/adjustments", {
        intervalId: iv.id,
        reason: "not mine",
        proposedBreakMinutes: 10,
      });
      assert.equal(res.status, 403);
      const afterCount = await prisma.attendanceAdjustment.count({
        where: { intervalId: iv.id },
      });
      assert.equal(afterCount, beforeCount);
      await assertControlUnchanged();
    } finally {
      await restore();
    }
  });

  it("T-ATT-69c HK without grant → 403", async () => {
    const restore = await removeActionGrant(
      prisma,
      Role.housekeeper,
      REQUEST_KEY,
    );
    try {
      const iv = await seedClosedFor(world.housekeeper.employeeId);
      const beforeCount = await prisma.attendanceAdjustment.count({
        where: { intervalId: iv.id },
      });
      const hk = await loginBearer(api, world.housekeeper.email, ATT_PASSWORD);
      const res = await postJson(api, hk.token, "/attendance/adjustments", {
        intervalId: iv.id,
        reason: "no grant",
        proposedBreakMinutes: 5,
      });
      assert.equal(res.status, 403);
      const afterCount = await prisma.attendanceAdjustment.count({
        where: { intervalId: iv.id },
      });
      assert.equal(afterCount, beforeCount);
      await assertControlUnchanged();
    } finally {
      await restore();
    }
  });

  it("T-ATT-69d tech own → 201; tech other → 403", async () => {
    const restore = await ensureActionGrant(
      prisma,
      Role.technician,
      REQUEST_KEY,
    );
    try {
      const own = await seedClosedFor(world.technician.employeeId);
      const other = await seedClosedFor(world.otherHk.employeeId);
      const tech = await loginBearer(api, world.technician.email, ATT_PASSWORD);

      const ok = await postJson(api, tech.token, "/attendance/adjustments", {
        intervalId: own.id,
        reason: "tech own",
        proposedBreakMinutes: 20,
      });
      assert.equal(ok.status, 201);

      const beforeOther = await prisma.attendanceAdjustment.count({
        where: { intervalId: other.id },
      });
      const deny = await postJson(api, tech.token, "/attendance/adjustments", {
        intervalId: other.id,
        reason: "tech other",
        proposedBreakMinutes: 20,
      });
      assert.equal(deny.status, 403);
      const afterOther = await prisma.attendanceAdjustment.count({
        where: { intervalId: other.id },
      });
      assert.equal(afterOther, beforeOther);
      await assertControlUnchanged();
    } finally {
      await restore();
    }
  });

  it("T-ATT-69e supervisor without request grant → 403; with grant+other → 201", async () => {
    const removeRestore = await removeActionGrant(
      prisma,
      Role.supervisor,
      REQUEST_KEY,
    );
    try {
      const iv = await seedClosedFor(world.housekeeper.employeeId);
      const beforeCount = await prisma.attendanceAdjustment.count({
        where: { intervalId: iv.id },
      });
      const sup = await loginBearer(api, world.supervisor.email, ATT_PASSWORD);
      const deny = await postJson(api, sup.token, "/attendance/adjustments", {
        intervalId: iv.id,
        reason: "sup no grant",
        proposedBreakMinutes: 10,
      });
      assert.equal(deny.status, 403);
      assert.equal(
        await prisma.attendanceAdjustment.count({ where: { intervalId: iv.id } }),
        beforeCount,
      );

      const grantRestore = await ensureActionGrant(
        prisma,
        Role.supervisor,
        REQUEST_KEY,
      );
      try {
        const ok = await postJson(api, sup.token, "/attendance/adjustments", {
          intervalId: iv.id,
          reason: "sup managerial",
          proposedBreakMinutes: 10,
        });
        assert.equal(ok.status, 201);
      } finally {
        await grantRestore();
      }
      await assertControlUnchanged();
    } finally {
      await removeRestore();
    }
  });

  it("T-ATT-69f owner+other → 201", async () => {
    const iv = await seedClosedFor(world.technician.employeeId);
    const owner = await loginBearer(api, world.owner.email, ATT_PASSWORD);
    const res = await postJson(api, owner.token, "/attendance/adjustments", {
      intervalId: iv.id,
      reason: "owner exception",
      proposedBreakMinutes: 25,
    });
    assert.equal(res.status, 201);
    await assertControlUnchanged();
  });
});