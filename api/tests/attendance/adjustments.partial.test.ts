/**
 * e — partial adjustment overlay (service + HTTP omit vs null).
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  AttendanceAdjustmentStatus,
  // Execute the next setup or assertion step for this scenario.
  AttendanceIntervalStatus,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  Role,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import bindings from ../../src/errors.
import { AppError } from "../../src/errors";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  requestAdjustment,
  // Execute the next setup or assertion step for this scenario.
  reviewAdjustment,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/attendance";
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
  // Shape AttendanceWorld documents the fixture/response fields this suite touches.
  type AttendanceWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: attendance adjustments partial overlay.
describe("attendance adjustments partial overlay", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: AttendanceWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: import("node:http").Server;

  // Bind hotelDate for later setup or assertions in this scope.
  const hotelDate = new Date("2026-10-12T00:00:00.000Z");
  // Bind S0 for later setup or assertions in this scope.
  const S0 = new Date("2026-10-12T08:00:00.000Z");
  // Bind E0 for later setup or assertions in this scope.
  const E0 = new Date("2026-10-12T16:00:00.000Z");
  // Bind B0 for later setup or assertions in this scope.
  const B0 = 30;
  // Bind W0 for later setup or assertions in this scope.
  const W0 = 450;

  // Helper seedBase: arrange fixture data for the case.
  async function seedBase() {
    // Return the arranged value/result to the caller.
    return createClosedInterval(prisma, {
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate,
      // Execute the next setup or assertion step for this scenario.
      startedAt: S0,
      // Execute the next setup or assertion step for this scenario.
      endedAt: E0,
      // Execute the next setup or assertion step for this scenario.
      breakMinutes: B0,
      // Execute the next setup or assertion step for this scenario.
      workedMinutes: W0,
    });
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
    await ensureActionGrant(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      Role.technician,
      // Execute the next setup or assertion step for this scenario.
      "attendance.request_adjustment",
    );
    // Await async work before asserting or releasing locks.
    await ensureActionGrant(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      Role.manager,
      // Execute the next setup or assertion step for this scenario.
      "attendance.approve_adjustment",
    );
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Start or stop the in-process API server for this suite.
    await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupAttendanceWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: service start-only overlay preserves end/break on approve.
  it("service start-only overlay preserves end/break on approve", async () => {
    // iv: seeded entity required before the mutation under test.
    const iv = await seedBase();
    // Bind S1 for later setup or assertions in this scope.
    const S1 = new Date(S0.getTime() + 30 * 60_000);
    // adj: HTTP response captured for status/body checks.
    const adj = await requestAdjustment({
      // Execute the next setup or assertion step for this scenario.
      intervalId: iv.id,
      // Execute the next setup or assertion step for this scenario.
      requestedById: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorRole: Role.technician,
      // Execute the next setup or assertion step for this scenario.
      reason: "start-only",
      // Execute the next setup or assertion step for this scenario.
      proposedStartedAt: S1.toISOString(),
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(adj.proposedStartedAt?.getTime(), S1.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(adj.proposedEndedAt, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(adj.proposedBreakMinutes, null);

    // reviewed: synchronize actors so the race window is observable.
    const reviewed = await reviewAdjustment({
      // Execute the next setup or assertion step for this scenario.
      adjustmentId: adj.id,
      // Execute the next setup or assertion step for this scenario.
      reviewedById: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      decision: "approved",
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(new Date(reviewed.startedAt).getTime(), S1.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(new Date(reviewed.endedAt!).getTime(), E0.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(reviewed.breakMinutes, B0);
    // Assert the observed value matches the intended post-condition.
    assert.equal(reviewed.workedMinutes, 420);
    // Assert HTTP status matches the contract for this path.
    assert.equal(reviewed.status, AttendanceIntervalStatus.adjusted);
  });

  // Case: service end-only overlay preserves start/break on approve.
  it("service end-only overlay preserves start/break on approve", async () => {
    // iv: seeded entity required before the mutation under test.
    const iv = await seedBase();
    // Bind E1 for later setup or assertions in this scope.
    const E1 = new Date(E0.getTime() - 30 * 60_000);
    // adj: HTTP response captured for status/body checks.
    const adj = await requestAdjustment({
      // Execute the next setup or assertion step for this scenario.
      intervalId: iv.id,
      // Execute the next setup or assertion step for this scenario.
      requestedById: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorRole: Role.technician,
      // Execute the next setup or assertion step for this scenario.
      reason: "end-only",
      // Execute the next setup or assertion step for this scenario.
      proposedEndedAt: E1.toISOString(),
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(adj.proposedStartedAt, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(adj.proposedEndedAt?.getTime(), E1.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(adj.proposedBreakMinutes, null);

    // reviewed: synchronize actors so the race window is observable.
    const reviewed = await reviewAdjustment({
      // Execute the next setup or assertion step for this scenario.
      adjustmentId: adj.id,
      // Execute the next setup or assertion step for this scenario.
      reviewedById: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      decision: "approved",
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(new Date(reviewed.startedAt).getTime(), S0.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(new Date(reviewed.endedAt!).getTime(), E1.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(reviewed.breakMinutes, B0);
    // Assert the observed value matches the intended post-condition.
    assert.equal(reviewed.workedMinutes, 420);
    // Assert HTTP status matches the contract for this path.
    assert.equal(reviewed.status, AttendanceIntervalStatus.adjusted);
  });

  // Case: service break-only overlay preserves times on approve.
  it("service break-only overlay preserves times on approve", async () => {
    // iv: seeded entity required before the mutation under test.
    const iv = await seedBase();
    // adj: HTTP response captured for status/body checks.
    const adj = await requestAdjustment({
      // Execute the next setup or assertion step for this scenario.
      intervalId: iv.id,
      // Execute the next setup or assertion step for this scenario.
      requestedById: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorRole: Role.technician,
      // Execute the next setup or assertion step for this scenario.
      reason: "break-only",
      // Execute the next setup or assertion step for this scenario.
      proposedBreakMinutes: 45,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(adj.proposedStartedAt, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(adj.proposedEndedAt, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(adj.proposedBreakMinutes, 45);

    // reviewed: synchronize actors so the race window is observable.
    const reviewed = await reviewAdjustment({
      // Execute the next setup or assertion step for this scenario.
      adjustmentId: adj.id,
      // Execute the next setup or assertion step for this scenario.
      reviewedById: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      decision: "approved",
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(new Date(reviewed.startedAt).getTime(), S0.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(new Date(reviewed.endedAt!).getTime(), E0.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(reviewed.breakMinutes, 45);
    // Assert the observed value matches the intended post-condition.
    assert.equal(reviewed.workedMinutes, W0 - 15);
    // Assert HTTP status matches the contract for this path.
    assert.equal(reviewed.status, AttendanceIntervalStatus.adjusted);
  });

  // Case: service invalid combo → 400; no Adjustment row.
  it("service invalid combo → 400; no Adjustment row", async () => {
    // iv: seeded entity required before the mutation under test.
    const iv = await seedBase();
    // Span after start-only would be 20m < B0=30
    const tooLate = new Date(E0.getTime() - 20 * 60_000);
    // before: synchronize actors so the race window is observable.
    const before = await prisma.attendanceAdjustment.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { intervalId: iv.id },
    });
    // Await async work before asserting or releasing locks.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Execute the next setup or assertion step for this scenario.
        requestAdjustment({
          // Execute the next setup or assertion step for this scenario.
          intervalId: iv.id,
          // Execute the next setup or assertion step for this scenario.
          requestedById: world.technician.employeeId,
          // Execute the next setup or assertion step for this scenario.
          actorRole: Role.technician,
          // Execute the next setup or assertion step for this scenario.
          reason: "invalid span",
          // Execute the next setup or assertion step for this scenario.
          proposedStartedAt: tooLate.toISOString(),
        }),
      // Execute the next setup or assertion step for this scenario.
      (err: unknown) =>
        // Execute the next setup or assertion step for this scenario.
        err instanceof AppError &&
        // Execute the next setup or assertion step for this scenario.
        err.status === 400 &&
        // Execute the next setup or assertion step for this scenario.
        err.code === "validation",
    );
    // after: synchronize actors so the race window is observable.
    const after = await prisma.attendanceAdjustment.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { intervalId: iv.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(after, before);
    // ivAfter: synchronize actors so the race window is observable.
    const ivAfter = await prisma.attendanceInterval.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: iv.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(ivAfter.status, AttendanceIntervalStatus.closed);
  });

  // Case: HTTP omit OK; null break → 400; approve preserves omitted.
  it("HTTP omit OK; null break → 400; approve preserves omitted", async () => {
    // iv: seeded entity required before the mutation under test.
    const iv = await seedBase();
    // tech: synchronize actors so the race window is observable.
    const tech = await loginBearer(api, world.technician.email, ATT_PASSWORD);
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, ATT_PASSWORD);

    // bad: HTTP response captured for status/body checks.
    const bad = await postJson(api, tech.token, "/attendance/adjustments", {
      // Execute the next setup or assertion step for this scenario.
      intervalId: iv.id,
      // Execute the next setup or assertion step for this scenario.
      reason: "null break",
      // Execute the next setup or assertion step for this scenario.
      proposedBreakMinutes: null,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(bad.status, 400);

    // Bind S1 for later setup or assertions in this scope.
    const S1 = new Date(S0.getTime() + 15 * 60_000);
    // ok: HTTP response captured for status/body checks.
    const ok = await postJson(api, tech.token, "/attendance/adjustments", {
      // Execute the next setup or assertion step for this scenario.
      intervalId: iv.id,
      // Execute the next setup or assertion step for this scenario.
      reason: "omit end/break",
      // Execute the next setup or assertion step for this scenario.
      proposedStartedAt: S1.toISOString(),
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(ok.status, 201);
    // adjId: unique stamp so parallel runs do not collide.
    const adjId = (ok.body as { id: string }).id;
    // adj: synchronize actors so the race window is observable.
    const adj = await prisma.attendanceAdjustment.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: adjId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(adj.proposedEndedAt, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(adj.proposedBreakMinutes, null);
    // Assert HTTP status matches the contract for this path.
    assert.equal(adj.status, AttendanceAdjustmentStatus.pending);

    // reviewed: HTTP response captured for status/body checks.
    const reviewed = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      mgr.token,
      // Execute the next setup or assertion step for this scenario.
      `/attendance/adjustments/${adjId}/review`,
      // Execute the next setup or assertion step for this scenario.
      { decision: "approved" },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(reviewed.status, 200);
    // Bind body for later setup or assertions in this scope.
    const body = reviewed.body as {
      // Execute the next setup or assertion step for this scenario.
      startedAt: string;
      // Execute the next setup or assertion step for this scenario.
      endedAt: string;
      // Execute the next setup or assertion step for this scenario.
      breakMinutes: number;
      // Execute the next setup or assertion step for this scenario.
      workedMinutes: number;
      // Fixture field status for the seeded actor/entity.
      status: string;
    };
    // Assert the observed value matches the intended post-condition.
    assert.equal(new Date(body.startedAt).getTime(), S1.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(new Date(body.endedAt).getTime(), E0.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.breakMinutes, B0);
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.workedMinutes, 435);
    // Assert HTTP status matches the contract for this path.
    assert.equal(body.status, AttendanceIntervalStatus.adjusted);
  });
});