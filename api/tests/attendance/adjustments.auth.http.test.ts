/**
 * f — POST /attendance/adjustments auth matrix (own/other × grant).
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient, Role } from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  postJson,
  // Execute the next setup or assertion step for this scenario.
  restoreRoleGrants,
  // Execute the next setup or assertion step for this scenario.
  snapshotRoleGrants,
  // Shape RoleGrantSnapshotRow documents the fixture/response fields this suite touches.
  type RoleGrantSnapshotRow,
// Execute the next setup or assertion step for this scenario.
} from "../httpHarness";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  ATT_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cleanupAttendanceWorld,
  // Execute the next setup or assertion step for this scenario.
  createAttendanceWorld,
  // Execute the next setup or assertion step for this scenario.
  createClosedInterval,
  // Execute the next setup or assertion step for this scenario.
  ensureActionGrant,
  // Execute the next setup or assertion step for this scenario.
  removeActionGrant,
  // Shape AttendanceWorld documents the fixture/response fields this suite touches.
  type AttendanceWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();
// Bind REQUEST_KEY for later setup or assertions in this scope.
const REQUEST_KEY = "attendance.request_adjustment";

// Suite: attendance adjustments auth HTTP.
describe("attendance adjustments auth HTTP", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: AttendanceWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: import("node:http").Server;
  // Execute the next setup or assertion step for this scenario.
  let grantSnap: RoleGrantSnapshotRow[];
  // Execute the next setup or assertion step for this scenario.
  let controlIntervalId: string;
  // Execute the next setup or assertion step for this scenario.
  let controlSnapshot: {
    // Execute the next setup or assertion step for this scenario.
    startedAt: Date;
    // Execute the next setup or assertion step for this scenario.
    endedAt: Date | null;
    // Execute the next setup or assertion step for this scenario.
    breakMinutes: number;
    // Execute the next setup or assertion step for this scenario.
    workedMinutes: number | null;
    // Fixture field status for the seeded actor/entity.
    status: string;
    // Execute the next setup or assertion step for this scenario.
    hotelDate: Date;
  };

  // Bind hotelDate for later setup or assertions in this scope.
  const hotelDate = new Date("2026-10-10T00:00:00.000Z");
  // Bind startedAt for later setup or assertions in this scope.
  const startedAt = new Date("2026-10-10T08:00:00.000Z");
  // Bind endedAt for later setup or assertions in this scope.
  const endedAt = new Date("2026-10-10T16:00:00.000Z");

  // Helper seedClosedFor: arrange fixture data for the case.
  async function seedClosedFor(employeeId: string) {
    // Return the arranged value/result to the caller.
    return createClosedInterval(prisma, {
      // Execute the next setup or assertion step for this scenario.
      employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate,
      // Execute the next setup or assertion step for this scenario.
      startedAt,
      // Execute the next setup or assertion step for this scenario.
      endedAt,
      // Execute the next setup or assertion step for this scenario.
      breakMinutes: 0,
      // Execute the next setup or assertion step for this scenario.
      workedMinutes: 480,
    });
  }

  // Local helper snapshotInterval used by cases in this file.
  async function snapshotInterval(id: string) {
    // row: synchronize actors so the race window is observable.
    const row = await prisma.attendanceInterval.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id },
    });
    // Return the arranged value/result to the caller.
    return {
      // Execute the next setup or assertion step for this scenario.
      startedAt: row.startedAt,
      // Execute the next setup or assertion step for this scenario.
      endedAt: row.endedAt,
      // Execute the next setup or assertion step for this scenario.
      breakMinutes: row.breakMinutes,
      // Execute the next setup or assertion step for this scenario.
      workedMinutes: row.workedMinutes,
      // Fixture field status for the seeded actor/entity.
      status: row.status,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: row.hotelDate,
    };
  }

  // Helper assertControlUnchanged: assert expected post-condition.
  async function assertControlUnchanged() {
    // after: synchronize actors so the race window is observable.
    const after = await snapshotInterval(controlIntervalId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.startedAt.getTime(), controlSnapshot.startedAt.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      after.endedAt?.getTime() ?? null,
      // Execute the next setup or assertion step for this scenario.
      controlSnapshot.endedAt?.getTime() ?? null,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.breakMinutes, controlSnapshot.breakMinutes);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.workedMinutes, controlSnapshot.workedMinutes);
    // Assert HTTP status matches the contract for this path.
    assert.equal(after.status, controlSnapshot.status);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      after.hotelDate.getTime(),
      // Execute the next setup or assertion step for this scenario.
      controlSnapshot.hotelDate.getTime(),
    );
  }

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createAttendanceWorld(prisma);
    // Await async work before asserting or releasing locks.
    grantSnap = await snapshotRoleGrants(prisma, world.grantRoles);
    // controlIv: seeded entity required before the mutation under test.
    const controlIv = await seedClosedFor(world.control.employeeId);
    // Execute the next setup or assertion step for this scenario.
    controlIntervalId = controlIv.id;
    // Await async work before asserting or releasing locks.
    controlSnapshot = await snapshotInterval(controlIntervalId);
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Start or stop the in-process API server for this suite.
    await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (grantSnap) {
      // Await async work before asserting or releasing locks.
      await restoreRoleGrants(prisma, world.grantRoles, grantSnap);
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupAttendanceWorld(prisma, world);
    // Await async work before asserting or releasing locks.
    await prisma.attendanceInterval.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: controlIntervalId },
    });
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: HK+grant+own → 201.
  it("HK+grant+own → 201", async () => {
    // restore: synchronize actors so the race window is observable.
    const restore = await ensureActionGrant(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      Role.housekeeper,
      // Execute the next setup or assertion step for this scenario.
      REQUEST_KEY,
    );
    // Try path where partial failure must not leak suite state.
    try {
      // iv: seeded entity required before the mutation under test.
      const iv = await seedClosedFor(world.housekeeper.employeeId);
      // beforeCount: synchronize actors so the race window is observable.
      const beforeCount = await prisma.attendanceAdjustment.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { intervalId: iv.id },
      });
      // hk: synchronize actors so the race window is observable.
      const hk = await loginBearer(api, world.housekeeper.email, ATT_PASSWORD);
      // res: HTTP response captured for status/body checks.
      const res = await postJson(api, hk.token, "/attendance/adjustments", {
        // Execute the next setup or assertion step for this scenario.
        intervalId: iv.id,
        // Execute the next setup or assertion step for this scenario.
        reason: "forgot break",
        // Execute the next setup or assertion step for this scenario.
        proposedBreakMinutes: 15,
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 201);
      // afterCount: synchronize actors so the race window is observable.
      const afterCount = await prisma.attendanceAdjustment.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { intervalId: iv.id },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(afterCount, beforeCount + 1);
      // Await async work before asserting or releasing locks.
      await assertControlUnchanged();
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await restore();
    }
  });

  // Case: HK+grant+other → 403; no Adjustment row.
  it("HK+grant+other → 403; no Adjustment row", async () => {
    // restore: synchronize actors so the race window is observable.
    const restore = await ensureActionGrant(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      Role.housekeeper,
      // Execute the next setup or assertion step for this scenario.
      REQUEST_KEY,
    );
    // Try path where partial failure must not leak suite state.
    try {
      // iv: seeded entity required before the mutation under test.
      const iv = await seedClosedFor(world.technician.employeeId);
      // beforeCount: synchronize actors so the race window is observable.
      const beforeCount = await prisma.attendanceAdjustment.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { intervalId: iv.id },
      });
      // hk: synchronize actors so the race window is observable.
      const hk = await loginBearer(api, world.housekeeper.email, ATT_PASSWORD);
      // res: HTTP response captured for status/body checks.
      const res = await postJson(api, hk.token, "/attendance/adjustments", {
        // Execute the next setup or assertion step for this scenario.
        intervalId: iv.id,
        // Execute the next setup or assertion step for this scenario.
        reason: "not mine",
        // Execute the next setup or assertion step for this scenario.
        proposedBreakMinutes: 10,
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 403);
      // afterCount: synchronize actors so the race window is observable.
      const afterCount = await prisma.attendanceAdjustment.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { intervalId: iv.id },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(afterCount, beforeCount);
      // Await async work before asserting or releasing locks.
      await assertControlUnchanged();
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await restore();
    }
  });

  // Case: HK without grant → 403.
  it("HK without grant → 403", async () => {
    // restore: synchronize actors so the race window is observable.
    const restore = await removeActionGrant(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      Role.housekeeper,
      // Execute the next setup or assertion step for this scenario.
      REQUEST_KEY,
    );
    // Try path where partial failure must not leak suite state.
    try {
      // iv: seeded entity required before the mutation under test.
      const iv = await seedClosedFor(world.housekeeper.employeeId);
      // beforeCount: synchronize actors so the race window is observable.
      const beforeCount = await prisma.attendanceAdjustment.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { intervalId: iv.id },
      });
      // hk: synchronize actors so the race window is observable.
      const hk = await loginBearer(api, world.housekeeper.email, ATT_PASSWORD);
      // res: HTTP response captured for status/body checks.
      const res = await postJson(api, hk.token, "/attendance/adjustments", {
        // Execute the next setup or assertion step for this scenario.
        intervalId: iv.id,
        // Execute the next setup or assertion step for this scenario.
        reason: "no grant",
        // Execute the next setup or assertion step for this scenario.
        proposedBreakMinutes: 5,
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 403);
      // afterCount: synchronize actors so the race window is observable.
      const afterCount = await prisma.attendanceAdjustment.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { intervalId: iv.id },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(afterCount, beforeCount);
      // Await async work before asserting or releasing locks.
      await assertControlUnchanged();
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await restore();
    }
  });

  // Case: tech own → 201; tech other → 403.
  it("tech own → 201; tech other → 403", async () => {
    // restore: synchronize actors so the race window is observable.
    const restore = await ensureActionGrant(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      Role.technician,
      // Execute the next setup or assertion step for this scenario.
      REQUEST_KEY,
    );
    // Try path where partial failure must not leak suite state.
    try {
      // own: seeded entity required before the mutation under test.
      const own = await seedClosedFor(world.technician.employeeId);
      // other: seeded entity required before the mutation under test.
      const other = await seedClosedFor(world.otherHk.employeeId);
      // tech: synchronize actors so the race window is observable.
      const tech = await loginBearer(api, world.technician.email, ATT_PASSWORD);

      // ok: HTTP response captured for status/body checks.
      const ok = await postJson(api, tech.token, "/attendance/adjustments", {
        // Execute the next setup or assertion step for this scenario.
        intervalId: own.id,
        // Execute the next setup or assertion step for this scenario.
        reason: "tech own",
        // Execute the next setup or assertion step for this scenario.
        proposedBreakMinutes: 20,
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(ok.status, 201);

      // beforeOther: synchronize actors so the race window is observable.
      const beforeOther = await prisma.attendanceAdjustment.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { intervalId: other.id },
      });
      // deny: HTTP response captured for status/body checks.
      const deny = await postJson(api, tech.token, "/attendance/adjustments", {
        // Execute the next setup or assertion step for this scenario.
        intervalId: other.id,
        // Execute the next setup or assertion step for this scenario.
        reason: "tech other",
        // Execute the next setup or assertion step for this scenario.
        proposedBreakMinutes: 20,
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(deny.status, 403);
      // afterOther: synchronize actors so the race window is observable.
      const afterOther = await prisma.attendanceAdjustment.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { intervalId: other.id },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(afterOther, beforeOther);
      // Await async work before asserting or releasing locks.
      await assertControlUnchanged();
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await restore();
    }
  });

  // Case: supervisor without request grant → 403; with grant+other → 201.
  it("supervisor without request grant → 403; with grant+other → 201", async () => {
    // removeRestore: synchronize actors so the race window is observable.
    const removeRestore = await removeActionGrant(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      Role.supervisor,
      // Execute the next setup or assertion step for this scenario.
      REQUEST_KEY,
    );
    // Try path where partial failure must not leak suite state.
    try {
      // iv: seeded entity required before the mutation under test.
      const iv = await seedClosedFor(world.housekeeper.employeeId);
      // beforeCount: synchronize actors so the race window is observable.
      const beforeCount = await prisma.attendanceAdjustment.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { intervalId: iv.id },
      });
      // sup: synchronize actors so the race window is observable.
      const sup = await loginBearer(api, world.supervisor.email, ATT_PASSWORD);
      // deny: HTTP response captured for status/body checks.
      const deny = await postJson(api, sup.token, "/attendance/adjustments", {
        // Execute the next setup or assertion step for this scenario.
        intervalId: iv.id,
        // Execute the next setup or assertion step for this scenario.
        reason: "sup no grant",
        // Execute the next setup or assertion step for this scenario.
        proposedBreakMinutes: 10,
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(deny.status, 403);
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Await async work before asserting or releasing locks.
        await prisma.attendanceAdjustment.count({ where: { intervalId: iv.id } }),
        // Execute the next setup or assertion step for this scenario.
        beforeCount,
      );

      // grantRestore: synchronize actors so the race window is observable.
      const grantRestore = await ensureActionGrant(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Execute the next setup or assertion step for this scenario.
        Role.supervisor,
        // Execute the next setup or assertion step for this scenario.
        REQUEST_KEY,
      );
      // Try path where partial failure must not leak suite state.
      try {
        // ok: HTTP response captured for status/body checks.
        const ok = await postJson(api, sup.token, "/attendance/adjustments", {
          // Execute the next setup or assertion step for this scenario.
          intervalId: iv.id,
          // Execute the next setup or assertion step for this scenario.
          reason: "sup managerial",
          // Execute the next setup or assertion step for this scenario.
          proposedBreakMinutes: 10,
        });
        // Assert HTTP status matches the contract for this path.
        assert.equal(ok.status, 201);
      // Execute the next setup or assertion step for this scenario.
      } finally {
        // Await async work before asserting or releasing locks.
        await grantRestore();
      }
      // Await async work before asserting or releasing locks.
      await assertControlUnchanged();
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await removeRestore();
    }
  });

  // Case: owner+other → 201.
  it("owner+other → 201", async () => {
    // iv: seeded entity required before the mutation under test.
    const iv = await seedClosedFor(world.technician.employeeId);
    // owner: synchronize actors so the race window is observable.
    const owner = await loginBearer(api, world.owner.email, ATT_PASSWORD);
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, owner.token, "/attendance/adjustments", {
      // Execute the next setup or assertion step for this scenario.
      intervalId: iv.id,
      // Execute the next setup or assertion step for this scenario.
      reason: "owner exception",
      // Execute the next setup or assertion step for this scenario.
      proposedBreakMinutes: 25,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 201);
    // Await async work before asserting or releasing locks.
    await assertControlUnchanged();
  });
});