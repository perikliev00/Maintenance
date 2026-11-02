/**
 * e — partial adjustment overlay (service + HTTP omit vs null).
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AttendanceAdjustmentStatus,
  AttendanceIntervalStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import { AppError } from "../../src/errors";
import {
  requestAdjustment,
  reviewAdjustment,
} from "../../src/services/attendance";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  closeServer,
  listenApp,
  loginBearer,
  postJson,
} from "../httpHarness";
import {
  ATT_PASSWORD,
  cleanupAttendanceWorld,
  createAttendanceWorld,
  createClosedInterval,
  ensureActionGrant,
  type AttendanceWorld,
} from "./fixtures";

const prisma = new PrismaClient();

describe("attendance adjustments partial overlay", () => {
  let world: AttendanceWorld;
  let api: string;
  let server: import("node:http").Server;

  const hotelDate = new Date("2026-10-12T00:00:00.000Z");
  const S0 = new Date("2026-10-12T08:00:00.000Z");
  const E0 = new Date("2026-10-12T16:00:00.000Z");
  const B0 = 30;
  const W0 = 450;

  async function seedBase() {
    return createClosedInterval(prisma, {
      employeeId: world.technician.employeeId,
      hotelDate,
      startedAt: S0,
      endedAt: E0,
      breakMinutes: B0,
      workedMinutes: W0,
    });
  }

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    world = await createAttendanceWorld(prisma);
    await ensureActionGrant(
      prisma,
      Role.technician,
      "attendance.request_adjustment",
    );
    await ensureActionGrant(
      prisma,
      Role.manager,
      "attendance.approve_adjustment",
    );
    ({ server, api } = await listenApp());
  });

  after(async () => {
    await closeServer(server);
    if (world) await cleanupAttendanceWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("service start-only overlay preserves end/break on approve", async () => {
    const iv = await seedBase();
    const S1 = new Date(S0.getTime() + 30 * 60_000);
    const adj = await requestAdjustment({
      intervalId: iv.id,
      requestedById: world.technician.employeeId,
      actorRole: Role.technician,
      reason: "start-only",
      proposedStartedAt: S1.toISOString(),
    });
    assert.equal(adj.proposedStartedAt?.getTime(), S1.getTime());
    assert.equal(adj.proposedEndedAt, null);
    assert.equal(adj.proposedBreakMinutes, null);

    const reviewed = await reviewAdjustment({
      adjustmentId: adj.id,
      reviewedById: world.manager.employeeId,
      decision: "approved",
    });
    assert.equal(new Date(reviewed.startedAt).getTime(), S1.getTime());
    assert.equal(new Date(reviewed.endedAt!).getTime(), E0.getTime());
    assert.equal(reviewed.breakMinutes, B0);
    assert.equal(reviewed.workedMinutes, 420);
    assert.equal(reviewed.status, AttendanceIntervalStatus.adjusted);
  });

  it("service end-only overlay preserves start/break on approve", async () => {
    const iv = await seedBase();
    const E1 = new Date(E0.getTime() - 30 * 60_000);
    const adj = await requestAdjustment({
      intervalId: iv.id,
      requestedById: world.technician.employeeId,
      actorRole: Role.technician,
      reason: "end-only",
      proposedEndedAt: E1.toISOString(),
    });
    assert.equal(adj.proposedStartedAt, null);
    assert.equal(adj.proposedEndedAt?.getTime(), E1.getTime());
    assert.equal(adj.proposedBreakMinutes, null);

    const reviewed = await reviewAdjustment({
      adjustmentId: adj.id,
      reviewedById: world.manager.employeeId,
      decision: "approved",
    });
    assert.equal(new Date(reviewed.startedAt).getTime(), S0.getTime());
    assert.equal(new Date(reviewed.endedAt!).getTime(), E1.getTime());
    assert.equal(reviewed.breakMinutes, B0);
    assert.equal(reviewed.workedMinutes, 420);
    assert.equal(reviewed.status, AttendanceIntervalStatus.adjusted);
  });

  it("service break-only overlay preserves times on approve", async () => {
    const iv = await seedBase();
    const adj = await requestAdjustment({
      intervalId: iv.id,
      requestedById: world.technician.employeeId,
      actorRole: Role.technician,
      reason: "break-only",
      proposedBreakMinutes: 45,
    });
    assert.equal(adj.proposedStartedAt, null);
    assert.equal(adj.proposedEndedAt, null);
    assert.equal(adj.proposedBreakMinutes, 45);

    const reviewed = await reviewAdjustment({
      adjustmentId: adj.id,
      reviewedById: world.manager.employeeId,
      decision: "approved",
    });
    assert.equal(new Date(reviewed.startedAt).getTime(), S0.getTime());
    assert.equal(new Date(reviewed.endedAt!).getTime(), E0.getTime());
    assert.equal(reviewed.breakMinutes, 45);
    assert.equal(reviewed.workedMinutes, W0 - 15);
    assert.equal(reviewed.status, AttendanceIntervalStatus.adjusted);
  });

  it("service invalid combo → 400; no Adjustment row", async () => {
    const iv = await seedBase();
    // Span after start-only would be 20m < B0=30
    const tooLate = new Date(E0.getTime() - 20 * 60_000);
    const before = await prisma.attendanceAdjustment.count({
      where: { intervalId: iv.id },
    });
    await assert.rejects(
      () =>
        requestAdjustment({
          intervalId: iv.id,
          requestedById: world.technician.employeeId,
          actorRole: Role.technician,
          reason: "invalid span",
          proposedStartedAt: tooLate.toISOString(),
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 400 &&
        err.code === "validation",
    );
    const after = await prisma.attendanceAdjustment.count({
      where: { intervalId: iv.id },
    });
    assert.equal(after, before);
    const ivAfter = await prisma.attendanceInterval.findUniqueOrThrow({
      where: { id: iv.id },
    });
    assert.equal(ivAfter.status, AttendanceIntervalStatus.closed);
  });

  it("HTTP omit OK; null break → 400; approve preserves omitted", async () => {
    const iv = await seedBase();
    const tech = await loginBearer(api, world.technician.email, ATT_PASSWORD);
    const mgr = await loginBearer(api, world.manager.email, ATT_PASSWORD);

    const bad = await postJson(api, tech.token, "/attendance/adjustments", {
      intervalId: iv.id,
      reason: "null break",
      proposedBreakMinutes: null,
    });
    assert.equal(bad.status, 400);

    const S1 = new Date(S0.getTime() + 15 * 60_000);
    const ok = await postJson(api, tech.token, "/attendance/adjustments", {
      intervalId: iv.id,
      reason: "omit end/break",
      proposedStartedAt: S1.toISOString(),
    });
    assert.equal(ok.status, 201);
    const adjId = (ok.body as { id: string }).id;
    const adj = await prisma.attendanceAdjustment.findUniqueOrThrow({
      where: { id: adjId },
    });
    assert.equal(adj.proposedEndedAt, null);
    assert.equal(adj.proposedBreakMinutes, null);
    assert.equal(adj.status, AttendanceAdjustmentStatus.pending);

    const reviewed = await postJson(
      api,
      mgr.token,
      `/attendance/adjustments/${adjId}/review`,
      { decision: "approved" },
    );
    assert.equal(reviewed.status, 200);
    const body = reviewed.body as {
      startedAt: string;
      endedAt: string;
      breakMinutes: number;
      workedMinutes: number;
      status: string;
    };
    assert.equal(new Date(body.startedAt).getTime(), S1.getTime());
    assert.equal(new Date(body.endedAt).getTime(), E0.getTime());
    assert.equal(body.breakMinutes, B0);
    assert.equal(body.workedMinutes, 435);
    assert.equal(body.status, AttendanceIntervalStatus.adjusted);
  });
});