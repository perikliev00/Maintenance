/**
 * b approve (mid-TX rollback); reject preserves times.
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
import {
  getOperations,
  updateSetting,
} from "../../src/services/settings";
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

describe("attendance adjustments review HTTP", () => {
  let world: AttendanceWorld;
  let api: string;
  let server: import("node:http").Server;
  let opsBefore: Awaited<ReturnType<typeof getOperations>>;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    world = await createAttendanceWorld(prisma);
    opsBefore = await getOperations();
    await updateSetting({
      key: "operations",
      value: { ...opsBefore, hotelTimezone: "Europe/Sofia" },
      actorEmployeeId: world.owner.employeeId,
      reason: "att-71 tz",
    });
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
    if (opsBefore) {
      await updateSetting({
        key: "operations",
        value: opsBefore,
        actorEmployeeId: world.owner.employeeId,
        reason: "att-71 tz restore",
      });
    }
    if (world) await cleanupAttendanceWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("approve clears flags, rewrites hotelDate, control untouched", async () => {
    const hotelDate = new Date("2026-10-07T00:00:00.000Z");
    const startedAt = new Date("2026-10-07T19:00:00.000Z");
    const endedAt = new Date("2026-10-08T03:00:00.000Z");
    const target = await createClosedInterval(prisma, {
      employeeId: world.technician.employeeId,
      hotelDate,
      startedAt,
      endedAt,
      breakMinutes: 0,
      workedMinutes: 480,
      anomalyFlags: ["overlap", "absurd_duration"],
      status: AttendanceIntervalStatus.closed,
    });
    const control = await createClosedInterval(prisma, {
      employeeId: world.control.employeeId,
      hotelDate,
      startedAt,
      endedAt,
      breakMinutes: 0,
      workedMinutes: 480,
      anomalyFlags: ["overlap"],
    });
    const controlSnap = await prisma.attendanceInterval.findUniqueOrThrow({
      where: { id: control.id },
    });

    const tech = await loginBearer(api, world.technician.email, ATT_PASSWORD);
    const mgr = await loginBearer(api, world.manager.email, ATT_PASSWORD);

    const proposedStart = "2026-10-08T05:00:00.000Z";
    const proposedEnd = "2026-10-08T13:00:00.000Z";
    const req = await postJson(api, tech.token, "/attendance/adjustments", {
      intervalId: target.id,
      reason: "fix overnight window",
      proposedStartedAt: proposedStart,
      proposedEndedAt: proposedEnd,
      proposedBreakMinutes: 30,
    });
    assert.equal(req.status, 201);
    const adjId = (req.body as { id: string }).id;

    const rev = await postJson(
      api,
      mgr.token,
      `/attendance/adjustments/${adjId}/review`,
      { decision: "approved" },
    );
    assert.equal(rev.status, 200);
    const body = rev.body as {
      hotelDate: string;
      startedAt: string;
      endedAt: string;
      breakMinutes: number;
      workedMinutes: number;
      status: string;
      anomalyFlags: string[];
    };
    assert.equal(body.hotelDate, "2026-10-08");
    assert.equal(body.startedAt, proposedStart);
    assert.equal(body.endedAt, proposedEnd);
    assert.equal(body.breakMinutes, 30);
    assert.equal(body.workedMinutes, 450);
    assert.equal(body.status, AttendanceIntervalStatus.adjusted);
    assert.deepEqual(body.anomalyFlags, []);

    const row = await prisma.attendanceInterval.findUniqueOrThrow({
      where: { id: target.id },
    });
    assert.equal(row.hotelDate.toISOString().slice(0, 10), "2026-10-08");
    assert.equal(row.startedAt.toISOString(), proposedStart);
    assert.equal(row.endedAt?.toISOString(), proposedEnd);
    assert.equal(row.breakMinutes, 30);
    assert.equal(row.workedMinutes, 450);
    assert.equal(row.status, AttendanceIntervalStatus.adjusted);
    assert.deepEqual(row.anomalyFlags, []);
    const controlFlags = Array.isArray(controlSnap.anomalyFlags)
      ? controlSnap.anomalyFlags
      : [];
    assert.ok(
      controlFlags.length > 0,
      "control must keep non-empty warnings (positive case clears only target)",
    );

    const controlAfter = await prisma.attendanceInterval.findUniqueOrThrow({
      where: { id: control.id },
    });
    assert.equal(
      controlAfter.startedAt.getTime(),
      controlSnap.startedAt.getTime(),
    );
    assert.equal(controlAfter.endedAt?.getTime(), controlSnap.endedAt?.getTime());
    assert.equal(controlAfter.breakMinutes, controlSnap.breakMinutes);
    assert.equal(controlAfter.workedMinutes, controlSnap.workedMinutes);
    assert.equal(controlAfter.status, controlSnap.status);
    assert.deepEqual(controlAfter.anomalyFlags, controlSnap.anomalyFlags);
    assert.equal(
      controlAfter.hotelDate.getTime(),
      controlSnap.hotelDate.getTime(),
    );
  });

  it("mid-TX rollback via BEFORE UPDATE trigger", async () => {
    const hotelDate = new Date("2026-10-09T00:00:00.000Z");
    const startedAt = new Date("2026-10-09T07:00:00.000Z");
    const endedAt = new Date("2026-10-09T15:00:00.000Z");
    const target = await createClosedInterval(prisma, {
      employeeId: world.technician.employeeId,
      hotelDate,
      startedAt,
      endedAt,
      breakMinutes: 0,
      workedMinutes: 480,
      anomalyFlags: ["overlap", "absurd_duration"],
    });
    const tech = await loginBearer(api, world.technician.email, ATT_PASSWORD);
    const mgr = await loginBearer(api, world.manager.email, ATT_PASSWORD);
    const req = await postJson(api, tech.token, "/attendance/adjustments", {
      intervalId: target.id,
      reason: "rollback probe",
      proposedBreakMinutes: 30,
    });
    assert.equal(req.status, 201);
    const adjId = (req.body as { id: string }).id;

    const beforeIv = await prisma.attendanceInterval.findUniqueOrThrow({
      where: { id: target.id },
    });
    const beforeAdj = await prisma.attendanceAdjustment.findUniqueOrThrow({
      where: { id: adjId },
    });
    assert.equal(beforeAdj.status, AttendanceAdjustmentStatus.pending);
    assert.equal(beforeAdj.reviewedById, null);
    assert.equal(beforeAdj.reviewedAt, null);

    const safe = world.stamp.replace(/[^a-zA-Z0-9]/g, "");
    const fn = `att_fail_upd_${safe}`;
    const trg = `trg_${fn}`;
    // Sequences survive TX rollback — unlike a probe TABLE insert, which would
    // vanish with the failed review transaction and falsely look like "no hit".
    const probeSeq = `att_rb_probe_seq_${safe}`;

    await prisma.$executeRawUnsafe(
      `CREATE SEQUENCE IF NOT EXISTS ${probeSeq}`,
    );
    await prisma.$executeRawUnsafe(
      `SELECT setval('${probeSeq}', 1, false)`,
    );
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
      BEGIN
        PERFORM nextval('${probeSeq}');
        RAISE EXCEPTION 'test-forced-attendance-interval-update-failure';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${trg}
      BEFORE UPDATE ON "AttendanceInterval"
      FOR EACH ROW
      WHEN (NEW.id = '${target.id}' AND NEW.status = 'adjusted')
      EXECUTE FUNCTION ${fn}();
    `);

    try {
      // Separate proof of the specific trigger exception (not via HTTP).
      await assert.rejects(
        () =>
          prisma.attendanceInterval.update({
            where: { id: target.id },
            data: {
              status: AttendanceIntervalStatus.adjusted,
              breakMinutes: 99,
            },
          }),
        (err: unknown) =>
          /test-forced-attendance-interval-update-failure/.test(String(err)),
      );
      const mid = await prisma.attendanceInterval.findUniqueOrThrow({
        where: { id: target.id },
      });
      assert.equal(mid.breakMinutes, beforeIv.breakMinutes);
      assert.equal(mid.status, beforeIv.status);
      // Reset so the HTTP path must advance the sequence itself.
      await prisma.$executeRawUnsafe(
        `SELECT setval('${probeSeq}', 1, false)`,
      );

      const rev = await postJson(
        api,
        mgr.token,
        `/attendance/adjustments/${adjId}/review`,
        { decision: "approved" },
      );
      // Must be the generic internal error — early 403 must NOT satisfy this test.
      assert.equal(rev.status, 500);
      const errBody = rev.body as { error?: string; message?: string };
      assert.equal(errBody.error, "internal");
      assert.equal(errBody.message, "Internal server error");
      assert.ok(
        !JSON.stringify(errBody).includes(
          "test-forced-attendance-interval-update-failure",
        ),
        "must not leak trigger exception text to the client",
      );

      const seqRows = await prisma.$queryRawUnsafe<
        { last_value: string | number | bigint; is_called: boolean }[]
      >(`SELECT last_value, is_called FROM ${probeSeq}`);
      const seq = seqRows[0]!;
      assert.equal(
        Boolean(seq.is_called),
        true,
        "trigger must have fired (sequence advanced) — early reject before TX is not a pass",
      );
      assert.ok(
        Number(seq.last_value) >= 1,
        `expected sequence last_value>=1, got ${seq.last_value}`,
      );

      const afterAdj = await prisma.attendanceAdjustment.findUniqueOrThrow({
        where: { id: adjId },
      });
      assert.equal(afterAdj.status, AttendanceAdjustmentStatus.pending);
      assert.equal(afterAdj.reviewedById, null);
      assert.equal(afterAdj.reviewedAt, null);
      assert.equal(afterAdj.reason, beforeAdj.reason);
      assert.equal(afterAdj.proposedBreakMinutes, beforeAdj.proposedBreakMinutes);

      const afterIv = await prisma.attendanceInterval.findUniqueOrThrow({
        where: { id: target.id },
      });
      assert.equal(afterIv.startedAt.getTime(), beforeIv.startedAt.getTime());
      assert.equal(afterIv.endedAt?.getTime(), beforeIv.endedAt?.getTime());
      assert.equal(afterIv.breakMinutes, beforeIv.breakMinutes);
      assert.equal(afterIv.workedMinutes, beforeIv.workedMinutes);
      assert.equal(afterIv.status, beforeIv.status);
      assert.deepEqual(afterIv.anomalyFlags, beforeIv.anomalyFlags);
      assert.equal(afterIv.hotelDate.getTime(), beforeIv.hotelDate.getTime());
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${trg} ON "AttendanceInterval"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
      await prisma.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS ${probeSeq}`);
    }
  });

  it("reject preserves interval times; adj rejected", async () => {
    const hotelDate = new Date("2026-10-11T00:00:00.000Z");
    const startedAt = new Date("2026-10-11T08:00:00.000Z");
    const endedAt = new Date("2026-10-11T16:00:00.000Z");
    const target = await createClosedInterval(prisma, {
      employeeId: world.technician.employeeId,
      hotelDate,
      startedAt,
      endedAt,
      breakMinutes: 15,
      workedMinutes: 465,
      anomalyFlags: ["duplicate_kind"],
    });
    const before = await prisma.attendanceInterval.findUniqueOrThrow({
      where: { id: target.id },
    });

    const tech = await loginBearer(api, world.technician.email, ATT_PASSWORD);
    const mgr = await loginBearer(api, world.manager.email, ATT_PASSWORD);
    const req = await postJson(api, tech.token, "/attendance/adjustments", {
      intervalId: target.id,
      reason: "please reject",
      proposedBreakMinutes: 45,
    });
    assert.equal(req.status, 201);
    const adjId = (req.body as { id: string }).id;

    const rev = await postJson(
      api,
      mgr.token,
      `/attendance/adjustments/${adjId}/review`,
      { decision: "rejected", reason: "insufficient evidence" },
    );
    assert.equal(rev.status, 200);

    const after = await prisma.attendanceInterval.findUniqueOrThrow({
      where: { id: target.id },
    });
    assert.equal(after.startedAt.getTime(), before.startedAt.getTime());
    assert.equal(after.endedAt?.getTime(), before.endedAt?.getTime());
    assert.equal(after.breakMinutes, before.breakMinutes);
    assert.equal(after.workedMinutes, before.workedMinutes);
    assert.deepEqual(after.anomalyFlags, before.anomalyFlags);
    assert.equal(after.hotelDate.getTime(), before.hotelDate.getTime());
    // Request may have moved closed → needs_review; reject does not apply times.
    assert.ok(
      after.status === AttendanceIntervalStatus.needs_review ||
        after.status === before.status,
    );

    const adj = await prisma.attendanceAdjustment.findUniqueOrThrow({
      where: { id: adjId },
    });
    assert.equal(adj.status, AttendanceAdjustmentStatus.rejected);
    assert.equal(adj.reviewedById, world.manager.employeeId);
    assert.ok(adj.reviewedAt);

    const audit = await prisma.auditEvent.findFirst({
      where: {
        action: "adjustment.review",
        entityType: "attendance_adjustment",
        entityId: adjId,
      },
      orderBy: { occurredAt: "desc" },
    });
    assert.ok(audit);
  });
});