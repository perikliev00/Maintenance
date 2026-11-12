/**
 * b approve (mid-TX rollback); reject preserves times.
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
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  getOperations,
  // Execute the next setup or assertion step for this scenario.
  updateSetting,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/settings";
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

// Suite: attendance adjustments review HTTP.
describe("attendance adjustments review HTTP", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: AttendanceWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: import("node:http").Server;
  // Execute the next setup or assertion step for this scenario.
  let opsBefore: Awaited<ReturnType<typeof getOperations>>;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createAttendanceWorld(prisma);
    // Await async work before asserting or releasing locks.
    opsBefore = await getOperations();
    // Await async work before asserting or releasing locks.
    await updateSetting({
      // Execute the next setup or assertion step for this scenario.
      key: "operations",
      // Execute the next setup or assertion step for this scenario.
      value: { ...opsBefore, hotelTimezone: "Europe/Sofia" },
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "att-71 tz",
    });
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
    if (opsBefore) {
      // Await async work before asserting or releasing locks.
      await updateSetting({
        // Execute the next setup or assertion step for this scenario.
        key: "operations",
        // Execute the next setup or assertion step for this scenario.
        value: opsBefore,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "att-71 tz restore",
      });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupAttendanceWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: approve clears flags, rewrites hotelDate, control untouched.
  it("approve clears flags, rewrites hotelDate, control untouched", async () => {
    // Bind hotelDate for later setup or assertions in this scope.
    const hotelDate = new Date("2026-10-07T00:00:00.000Z");
    // Bind startedAt for later setup or assertions in this scope.
    const startedAt = new Date("2026-10-07T19:00:00.000Z");
    // Bind endedAt for later setup or assertions in this scope.
    const endedAt = new Date("2026-10-08T03:00:00.000Z");
    // target: seeded entity required before the mutation under test.
    const target = await createClosedInterval(prisma, {
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.technician.employeeId,
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
      // Execute the next setup or assertion step for this scenario.
      anomalyFlags: ["overlap", "absurd_duration"],
      // Fixture field status for the seeded actor/entity.
      status: AttendanceIntervalStatus.closed,
    });
    // control: seeded entity required before the mutation under test.
    const control = await createClosedInterval(prisma, {
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.control.employeeId,
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
      // Execute the next setup or assertion step for this scenario.
      anomalyFlags: ["overlap"],
    });
    // controlSnap: synchronize actors so the race window is observable.
    const controlSnap = await prisma.attendanceInterval.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: control.id },
    });

    // tech: synchronize actors so the race window is observable.
    const tech = await loginBearer(api, world.technician.email, ATT_PASSWORD);
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, ATT_PASSWORD);

    // Bind proposedStart for later setup or assertions in this scope.
    const proposedStart = "2026-10-08T05:00:00.000Z";
    // Bind proposedEnd for later setup or assertions in this scope.
    const proposedEnd = "2026-10-08T13:00:00.000Z";
    // req: HTTP response captured for status/body checks.
    const req = await postJson(api, tech.token, "/attendance/adjustments", {
      // Execute the next setup or assertion step for this scenario.
      intervalId: target.id,
      // Execute the next setup or assertion step for this scenario.
      reason: "fix overnight window",
      // Execute the next setup or assertion step for this scenario.
      proposedStartedAt: proposedStart,
      // Execute the next setup or assertion step for this scenario.
      proposedEndedAt: proposedEnd,
      // Execute the next setup or assertion step for this scenario.
      proposedBreakMinutes: 30,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(req.status, 201);
    // adjId: unique stamp so parallel runs do not collide.
    const adjId = (req.body as { id: string }).id;

    // rev: HTTP response captured for status/body checks.
    const rev = await postJson(
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
    assert.equal(rev.status, 200);
    // Bind body for later setup or assertions in this scope.
    const body = rev.body as {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: string;
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
      // Execute the next setup or assertion step for this scenario.
      anomalyFlags: string[];
    };
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.hotelDate, "2026-10-08");
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.startedAt, proposedStart);
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.endedAt, proposedEnd);
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.breakMinutes, 30);
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.workedMinutes, 450);
    // Assert HTTP status matches the contract for this path.
    assert.equal(body.status, AttendanceIntervalStatus.adjusted);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(body.anomalyFlags, []);

    // row: synchronize actors so the race window is observable.
    const row = await prisma.attendanceInterval.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: target.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.hotelDate.toISOString().slice(0, 10), "2026-10-08");
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.startedAt.toISOString(), proposedStart);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.endedAt?.toISOString(), proposedEnd);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.breakMinutes, 30);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.workedMinutes, 450);
    // Assert HTTP status matches the contract for this path.
    assert.equal(row.status, AttendanceIntervalStatus.adjusted);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(row.anomalyFlags, []);
    // Bind controlFlags for later setup or assertions in this scope.
    const controlFlags = Array.isArray(controlSnap.anomalyFlags)
      ? controlSnap.anomalyFlags
      : [];
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      controlFlags.length > 0,
      // Execute the next setup or assertion step for this scenario.
      "control must keep non-empty warnings (positive case clears only target)",
    );

    // controlAfter: synchronize actors so the race window is observable.
    const controlAfter = await prisma.attendanceInterval.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: control.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      controlAfter.startedAt.getTime(),
      // Execute the next setup or assertion step for this scenario.
      controlSnap.startedAt.getTime(),
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(controlAfter.endedAt?.getTime(), controlSnap.endedAt?.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(controlAfter.breakMinutes, controlSnap.breakMinutes);
    // Assert the observed value matches the intended post-condition.
    assert.equal(controlAfter.workedMinutes, controlSnap.workedMinutes);
    // Assert HTTP status matches the contract for this path.
    assert.equal(controlAfter.status, controlSnap.status);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(controlAfter.anomalyFlags, controlSnap.anomalyFlags);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      controlAfter.hotelDate.getTime(),
      // Execute the next setup or assertion step for this scenario.
      controlSnap.hotelDate.getTime(),
    );
  });

  // Case: mid-TX rollback via BEFORE UPDATE trigger.
  it("mid-TX rollback via BEFORE UPDATE trigger", async () => {
    // Bind hotelDate for later setup or assertions in this scope.
    const hotelDate = new Date("2026-10-09T00:00:00.000Z");
    // Bind startedAt for later setup or assertions in this scope.
    const startedAt = new Date("2026-10-09T07:00:00.000Z");
    // Bind endedAt for later setup or assertions in this scope.
    const endedAt = new Date("2026-10-09T15:00:00.000Z");
    // target: seeded entity required before the mutation under test.
    const target = await createClosedInterval(prisma, {
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.technician.employeeId,
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
      // Execute the next setup or assertion step for this scenario.
      anomalyFlags: ["overlap", "absurd_duration"],
    });
    // tech: synchronize actors so the race window is observable.
    const tech = await loginBearer(api, world.technician.email, ATT_PASSWORD);
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, ATT_PASSWORD);
    // req: HTTP response captured for status/body checks.
    const req = await postJson(api, tech.token, "/attendance/adjustments", {
      // Execute the next setup or assertion step for this scenario.
      intervalId: target.id,
      // Execute the next setup or assertion step for this scenario.
      reason: "rollback probe",
      // Execute the next setup or assertion step for this scenario.
      proposedBreakMinutes: 30,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(req.status, 201);
    // adjId: unique stamp so parallel runs do not collide.
    const adjId = (req.body as { id: string }).id;

    // beforeIv: synchronize actors so the race window is observable.
    const beforeIv = await prisma.attendanceInterval.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: target.id },
    });
    // beforeAdj: synchronize actors so the race window is observable.
    const beforeAdj = await prisma.attendanceAdjustment.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: adjId },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(beforeAdj.status, AttendanceAdjustmentStatus.pending);
    // Assert the observed value matches the intended post-condition.
    assert.equal(beforeAdj.reviewedById, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(beforeAdj.reviewedAt, null);

    // Bind safe for later setup or assertions in this scope.
    const safe = world.stamp.replace(/[^a-zA-Z0-9]/g, "");
    // Bind fn for later setup or assertions in this scope.
    const fn = `att_fail_upd_${safe}`;
    // Bind trg for later setup or assertions in this scope.
    const trg = `trg_${fn}`;
    // Sequences survive TX rollback — unlike a probe TABLE insert, which would
    // vanish with the failed review transaction and falsely look like "no hit".
    const probeSeq = `att_rb_probe_seq_${safe}`;

    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(
      // Execute the next setup or assertion step for this scenario.
      `CREATE SEQUENCE IF NOT EXISTS ${probeSeq}`,
    );
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(
      // Execute the next setup or assertion step for this scenario.
      `SELECT setval('${probeSeq}', 1, false)`,
    );
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
      BEGIN
        PERFORM nextval('${probeSeq}');
        RAISE EXCEPTION 'test-forced-attendance-interval-update-failure';
      END;
      $$ LANGUAGE plpgsql;
    // Execute the next setup or assertion step for this scenario.
    `);
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${trg}
      BEFORE UPDATE ON "AttendanceInterval"
      FOR EACH ROW
      WHEN (NEW.id = '${target.id}' AND NEW.status = 'adjusted')
      EXECUTE FUNCTION ${fn}();
    // Execute the next setup or assertion step for this scenario.
    `);

    // Try path where partial failure must not leak suite state.
    try {
      // Separate proof of the specific trigger exception (not via HTTP).
      await assert.rejects(
        // Execute the next setup or assertion step for this scenario.
        () =>
          // Execute the next setup or assertion step for this scenario.
          prisma.attendanceInterval.update({
            // SQL fragment used to observe locks or assert DB state.
            where: { id: target.id },
            // Execute the next setup or assertion step for this scenario.
            data: {
              // Fixture field status for the seeded actor/entity.
              status: AttendanceIntervalStatus.adjusted,
              // Execute the next setup or assertion step for this scenario.
              breakMinutes: 99,
            },
          }),
        // Execute the next setup or assertion step for this scenario.
        (err: unknown) =>
          // Execute the next setup or assertion step for this scenario.
          /test-forced-attendance-interval-update-failure/.test(String(err)),
      );
      // mid: unique stamp so parallel runs do not collide.
      const mid = await prisma.attendanceInterval.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: target.id },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(mid.breakMinutes, beforeIv.breakMinutes);
      // Assert HTTP status matches the contract for this path.
      assert.equal(mid.status, beforeIv.status);
      // Reset so the HTTP path must advance the sequence itself.
      await prisma.$executeRawUnsafe(
        // Execute the next setup or assertion step for this scenario.
        `SELECT setval('${probeSeq}', 1, false)`,
      );

      // rev: HTTP response captured for status/body checks.
      const rev = await postJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        mgr.token,
        // Execute the next setup or assertion step for this scenario.
        `/attendance/adjustments/${adjId}/review`,
        // Execute the next setup or assertion step for this scenario.
        { decision: "approved" },
      );
      // Must be the generic internal error — early 403 must NOT satisfy this test.
      assert.equal(rev.status, 500);
      // Bind errBody for later setup or assertions in this scope.
      const errBody = rev.body as { error?: string; message?: string };
      // Assert the observed value matches the intended post-condition.
      assert.equal(errBody.error, "internal");
      // Assert the observed value matches the intended post-condition.
      assert.equal(errBody.message, "Internal server error");
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        !JSON.stringify(errBody).includes(
          // Execute the next setup or assertion step for this scenario.
          "test-forced-attendance-interval-update-failure",
        ),
        // Execute the next setup or assertion step for this scenario.
        "must not leak trigger exception text to the client",
      );

      // seqRows: synchronize actors so the race window is observable.
      const seqRows = await prisma.$queryRawUnsafe<
        // Execute the next setup or assertion step for this scenario.
        { last_value: string | number | bigint; is_called: boolean }[]
      // Execute the next setup or assertion step for this scenario.
      >(`SELECT last_value, is_called FROM ${probeSeq}`);
      // Bind seq for later setup or assertions in this scope.
      const seq = seqRows[0]!;
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        Boolean(seq.is_called),
        // Execute the next setup or assertion step for this scenario.
        true,
        // Execute the next setup or assertion step for this scenario.
        "trigger must have fired (sequence advanced) — early reject before TX is not a pass",
      );
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        Number(seq.last_value) >= 1,
        // Execute the next setup or assertion step for this scenario.
        `expected sequence last_value>=1, got ${seq.last_value}`,
      );

      // afterAdj: synchronize actors so the race window is observable.
      const afterAdj = await prisma.attendanceAdjustment.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: adjId },
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(afterAdj.status, AttendanceAdjustmentStatus.pending);
      // Assert the observed value matches the intended post-condition.
      assert.equal(afterAdj.reviewedById, null);
      // Assert the observed value matches the intended post-condition.
      assert.equal(afterAdj.reviewedAt, null);
      // Assert the observed value matches the intended post-condition.
      assert.equal(afterAdj.reason, beforeAdj.reason);
      // Assert the observed value matches the intended post-condition.
      assert.equal(afterAdj.proposedBreakMinutes, beforeAdj.proposedBreakMinutes);

      // afterIv: synchronize actors so the race window is observable.
      const afterIv = await prisma.attendanceInterval.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: target.id },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(afterIv.startedAt.getTime(), beforeIv.startedAt.getTime());
      // Assert the observed value matches the intended post-condition.
      assert.equal(afterIv.endedAt?.getTime(), beforeIv.endedAt?.getTime());
      // Assert the observed value matches the intended post-condition.
      assert.equal(afterIv.breakMinutes, beforeIv.breakMinutes);
      // Assert the observed value matches the intended post-condition.
      assert.equal(afterIv.workedMinutes, beforeIv.workedMinutes);
      // Assert HTTP status matches the contract for this path.
      assert.equal(afterIv.status, beforeIv.status);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(afterIv.anomalyFlags, beforeIv.anomalyFlags);
      // Assert the observed value matches the intended post-condition.
      assert.equal(afterIv.hotelDate.getTime(), beforeIv.hotelDate.getTime());
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.$executeRawUnsafe(
        // Execute the next setup or assertion step for this scenario.
        `DROP TRIGGER IF EXISTS ${trg} ON "AttendanceInterval"`,
      );
      // Await async work before asserting or releasing locks.
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
      // Await async work before asserting or releasing locks.
      await prisma.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS ${probeSeq}`);
    }
  });

  // Case: reject preserves interval times; adj rejected.
  it("reject preserves interval times; adj rejected", async () => {
    // Bind hotelDate for later setup or assertions in this scope.
    const hotelDate = new Date("2026-10-11T00:00:00.000Z");
    // Bind startedAt for later setup or assertions in this scope.
    const startedAt = new Date("2026-10-11T08:00:00.000Z");
    // Bind endedAt for later setup or assertions in this scope.
    const endedAt = new Date("2026-10-11T16:00:00.000Z");
    // target: seeded entity required before the mutation under test.
    const target = await createClosedInterval(prisma, {
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate,
      // Execute the next setup or assertion step for this scenario.
      startedAt,
      // Execute the next setup or assertion step for this scenario.
      endedAt,
      // Execute the next setup or assertion step for this scenario.
      breakMinutes: 15,
      // Execute the next setup or assertion step for this scenario.
      workedMinutes: 465,
      // Execute the next setup or assertion step for this scenario.
      anomalyFlags: ["duplicate_kind"],
    });
    // before: synchronize actors so the race window is observable.
    const before = await prisma.attendanceInterval.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: target.id },
    });

    // tech: synchronize actors so the race window is observable.
    const tech = await loginBearer(api, world.technician.email, ATT_PASSWORD);
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, ATT_PASSWORD);
    // req: HTTP response captured for status/body checks.
    const req = await postJson(api, tech.token, "/attendance/adjustments", {
      // Execute the next setup or assertion step for this scenario.
      intervalId: target.id,
      // Execute the next setup or assertion step for this scenario.
      reason: "please reject",
      // Execute the next setup or assertion step for this scenario.
      proposedBreakMinutes: 45,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(req.status, 201);
    // adjId: unique stamp so parallel runs do not collide.
    const adjId = (req.body as { id: string }).id;

    // rev: HTTP response captured for status/body checks.
    const rev = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      mgr.token,
      // Execute the next setup or assertion step for this scenario.
      `/attendance/adjustments/${adjId}/review`,
      // Execute the next setup or assertion step for this scenario.
      { decision: "rejected", reason: "insufficient evidence" },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(rev.status, 200);

    // after: synchronize actors so the race window is observable.
    const after = await prisma.attendanceInterval.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: target.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.startedAt.getTime(), before.startedAt.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.endedAt?.getTime(), before.endedAt?.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.breakMinutes, before.breakMinutes);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.workedMinutes, before.workedMinutes);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(after.anomalyFlags, before.anomalyFlags);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.hotelDate.getTime(), before.hotelDate.getTime());
    // Request may have moved closed → needs_review; reject does not apply times.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      after.status === AttendanceIntervalStatus.needs_review ||
        // Execute the next setup or assertion step for this scenario.
        after.status === before.status,
    );

    // adj: synchronize actors so the race window is observable.
    const adj = await prisma.attendanceAdjustment.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: adjId },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(adj.status, AttendanceAdjustmentStatus.rejected);
    // Assert the observed value matches the intended post-condition.
    assert.equal(adj.reviewedById, world.manager.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.ok(adj.reviewedAt);

    // audit: synchronize actors so the race window is observable.
    const audit = await prisma.auditEvent.findFirst({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        action: "adjustment.review",
        // Execute the next setup or assertion step for this scenario.
        entityType: "attendance_adjustment",
        // Execute the next setup or assertion step for this scenario.
        entityId: adjId,
      },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { occurredAt: "desc" },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(audit);
  });
});