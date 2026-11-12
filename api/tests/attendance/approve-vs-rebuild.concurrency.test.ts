/**
 * Approve vs rebuild: manager approves a pending correction while a late punch
 * rebuilds the same employee's day. Uses production reviewAdjustment +
 * rebuildIntervalsForEmployee (the function ingest calls). Barrier only holds
 * the pending adjustment row both paths contend on — no sleeps inside business
 * logic and no invalid fixtures.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AttendanceAdjustmentStatus,
  AttendanceEventKind,
  AttendanceIntervalStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import {
  ingestEvent,
  rebuildIntervalsForEmployee,
  requestAdjustment,
  reviewAdjustment,
} from "../../src/services/attendance";
import { getOperations, updateSetting } from "../../src/services/settings";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { orderedDatabaseRace } from "../dbBarrier";
import {
  cleanupAttendanceWorld,
  createAttendanceWorld,
  // Shape AttendanceWorld documents the fixture/response fields this suite touches.
  type AttendanceWorld,
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Local helper formatReject used by cases in this file.
function formatReject(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    return `${err.name}${code ? `/${code}` : ""}: ${err.message}`;
  }
  return String(err);
}

// Suite: attendance approve vs rebuild concurrency.
describe("attendance approve vs rebuild concurrency", () => {
  let world: AttendanceWorld;
  let opsBefore: Awaited<ReturnType<typeof getOperations>>;
  let hotelTimezone = "UTC";

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    world = await createAttendanceWorld(prisma);
    opsBefore = await getOperations();
    hotelTimezone = "UTC";
    await updateSetting({
      key: "operations",
      value: { ...opsBefore, hotelTimezone },
      actorEmployeeId: world.owner.employeeId,
      reason: "approve-vs-rebuild tz UTC",
    });
  });

  after(async () => {
    if (opsBefore) {
      await updateSetting({
        key: "operations",
        value: opsBefore,
        actorEmployeeId: world.owner.employeeId,
        reason: "approve-vs-rebuild tz restore",
      });
    }
    if (world) await cleanupAttendanceWorld(prisma, world);
    await prisma.$disconnect();
  });

  // Helper seedClosedShiftWithPendingBreak: arrange fixture data for the case.
  async function seedClosedShiftWithPendingBreak(
    employeeId: string,
    tag: string,
    day: string,
  ) {
    const stamp = world.stamp;
    const inRes = await ingestEvent({
      externalEventId: `avr-in-${tag}-${stamp}`,
      source: "approve-vs-rebuild",
      employeeId,
      kind: AttendanceEventKind.clock_in,
      deviceTime: `${day}T08:00:00.000Z`,
      receivedAt: `${day}T08:00:05.000Z`,
    });
    const outRes = await ingestEvent({
      externalEventId: `avr-out-${tag}-${stamp}`,
      source: "approve-vs-rebuild",
      employeeId,
      kind: AttendanceEventKind.clock_out,
      deviceTime: `${day}T16:00:00.000Z`,
      receivedAt: `${day}T16:00:05.000Z`,
    });
    assert.ok(inRes.created && outRes.created);

    const interval = await prisma.attendanceInterval.findFirstOrThrow({
      where: {
        employeeId,
        startEventId: inRes.event.id,
        status: AttendanceIntervalStatus.closed,
      },
    });
    assert.equal(interval.workedMinutes, 480);

    const adj = await requestAdjustment({
      intervalId: interval.id,
      requestedById: employeeId,
      actorRole: Role.housekeeper,
      reason: "actual lunch 30m",
      proposedBreakMinutes: 30,
    });
    assert.equal(adj.status, AttendanceAdjustmentStatus.pending);

    return { interval, adj, hotelDate: interval.hotelDate };
  }

  // Helper assertApprovedFreezeIntact: assert expected post-condition.
  async function assertApprovedFreezeIntact(input: {
    employeeId: string;
    hotelDate: Date;
    adjustmentId: string;
    intervalId: string;
  }) {
    const adj = await prisma.attendanceAdjustment.findUnique({
      where: { id: input.adjustmentId },
    });
    assert.ok(adj, "approved adjustment row must still exist");
    assert.equal(adj.status, AttendanceAdjustmentStatus.approved);

    const frozen = await prisma.attendanceInterval.findMany({
      where: {
        employeeId: input.employeeId,
        hotelDate: input.hotelDate,
        status: AttendanceIntervalStatus.adjusted,
      },
    });
    assert.equal(frozen.length, 1, "exactly one adjusted interval expected");
    assert.equal(frozen[0]!.workedMinutes, 450);
    assert.equal(frozen[0]!.breakMinutes, 30);

    // Original interval id may survive or be replaced only if freeze kept —
    // approved minutes are the business invariant.
    const audits = await prisma.auditEvent.count({
      where: {
        entityType: "attendance_adjustment",
        entityId: input.adjustmentId,
        action: "adjustment.review",
      },
    });
    assert.ok(audits >= 1, "approval audit must remain");
  }

  // Case: control: approve then rebuild keeps 450 minutes.
  it("control: approve then rebuild keeps 450 minutes", async () => {
    const emp = world.housekeeper.employeeId;
    const { interval, adj, hotelDate } = await seedClosedShiftWithPendingBreak(
      emp,
      "ctrl",
      "2026-05-01",
    );

    await reviewAdjustment({
      adjustmentId: adj.id,
      reviewedById: world.manager.employeeId,
      decision: "approved",
    });

    await rebuildIntervalsForEmployee(emp, hotelDate, hotelTimezone);

    await assertApprovedFreezeIntact({
      employeeId: emp,
      hotelDate,
      adjustmentId: adj.id,
      intervalId: interval.id,
    });
  });

  // Case: control: rebuild then approve — approve still applies or conflicts cleanly.
  it("control: rebuild then approve — approve still applies or conflicts cleanly", async () => {
    const emp = world.technician.employeeId;
    const { adj, hotelDate } = await seedClosedShiftWithPendingBreak(
      emp,
      "ctrl2",
      "2026-05-02",
    );

    await rebuildIntervalsForEmployee(emp, hotelDate, hotelTimezone);

    // Pending rematch may move the adjustment to a new interval id; review by
    // original id should either approve the rematched row or fail structured.
    const stillThere = await prisma.attendanceAdjustment.findUnique({
      where: { id: adj.id },
    });
    if (!stillThere) {
      const rematched = await prisma.attendanceAdjustment.findFirst({
        where: {
          interval: { employeeId: emp, hotelDate },
          status: AttendanceAdjustmentStatus.pending,
        },
      });
      assert.ok(rematched, "pending adjustment must rematch after rebuild");
      await reviewAdjustment({
        adjustmentId: rematched.id,
        reviewedById: world.manager.employeeId,
        decision: "approved",
      });
      await assertApprovedFreezeIntact({
        employeeId: emp,
        hotelDate,
        adjustmentId: rematched.id,
        intervalId: rematched.intervalId,
      });
      return;
    }

    await reviewAdjustment({
      adjustmentId: adj.id,
      reviewedById: world.manager.employeeId,
      decision: "approved",
    });
    await assertApprovedFreezeIntact({
      employeeId: emp,
      hotelDate,
      adjustmentId: adj.id,
      intervalId: stillThere.intervalId,
    });
  });

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let rep = 1; rep <= 5; rep++) {
    // Case probes concurrency/isolation: unordered concurrent approve∥rebuild must not lose approved 450 (rep ${rep}).
    it(`unordered concurrent approve∥rebuild must not lose approved 450 (rep ${rep})`, async () => {
      const emp = world.otherHk.employeeId;
      const day = `2026-05-${String(10 + rep).padStart(2, "0")}`;
      const { interval, adj, hotelDate } = await seedClosedShiftWithPendingBreak(
        emp,
        `unord${rep}`,
        day,
      );

      // settled: capture concurrent outcomes for race assertions.
      const settled = await Promise.allSettled([
        reviewAdjustment({
          adjustmentId: adj.id,
          reviewedById: world.manager.employeeId,
          decision: "approved",
        }),
        rebuildIntervalsForEmployee(emp, hotelDate, hotelTimezone),
      ]);

      const reviewResult = settled[0]!;
      const rebuildResult = settled[1]!;

      if (rebuildResult.status === "rejected") {
        // Fail fast when the expected race/waiter condition never appears.
        assert.fail(`rebuild failed: ${formatReject(rebuildResult.reason)}`);
      }

      const reviewAudit = await prisma.auditEvent.count({
        where: {
          entityType: "attendance_adjustment",
          entityId: adj.id,
          action: "adjustment.review",
        },
      });
      if (reviewResult.status === "fulfilled" || reviewAudit > 0) {
        // Approve committed (even if a post-commit read raced) — freeze must remain.
        await assertApprovedFreezeIntact({
          employeeId: emp,
          hotelDate,
          adjustmentId: adj.id,
          intervalId: interval.id,
        });
      } else {
        const err = reviewResult.reason as { status?: number; code?: string };
        assert.ok(
          err?.status === 404 || err?.status === 409,
          `unexpected review failure: ${formatReject(reviewResult.reason)}`,
        );
      }
    });
  }

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let rep = 1; rep <= 3; rep++) {
    // Case probes concurrency/isolation: ordered race: rebuild waits on pending adj, approve first — freeze must survive (rep ${rep}).
    it(`ordered race: rebuild waits on pending adj, approve first — freeze must survive (rep ${rep})`, async () => {
      const emp = world.supervisor.employeeId;
      const day = `2026-06-${String(10 + rep).padStart(2, "0")}`;
      const { interval, adj, hotelDate } = await seedClosedShiftWithPendingBreak(
        emp,
        `ord${rep}`,
        day,
      );

      // Both paths touch the pending adjustment row: approve claims it, rebuild
      // deleteMany removes adjustments for snapshotted interval ids. Holding that
      // row forces rebuild to snapshot first, then wait on delete, while approve
      // waits on the claim — the real interleaving window.
      const settled = await orderedDatabaseRace(
        prisma,
        (tx) =>
          tx.$queryRaw`SELECT id FROM "AttendanceAdjustment" WHERE id = ${adj.id} FOR UPDATE`,
        () =>
          reviewAdjustment({
            adjustmentId: adj.id,
            reviewedById: world.manager.employeeId,
            decision: "approved",
          }),
        () => rebuildIntervalsForEmployee(emp, hotelDate, hotelTimezone),
      );

      const reviewResult = settled[0]!;
      const rebuildResult = settled[1]!;

      if (rebuildResult.status === "rejected") {
        // Fail fast when the expected race/waiter condition never appears.
        assert.fail(`rebuild failed: ${formatReject(rebuildResult.reason)}`);
      }
      // Approve was queued first on the adjustment row. If it could not claim,
      // this barrier did not exercise the approve-then-stale-delete window.
      assert.equal(
        reviewResult.status,
        "fulfilled",
        `approve-first race must let approve commit; got ${
          reviewResult.status === "rejected"
            ? formatReject(reviewResult.reason)
            : "ok"
        }`,
      );
      await assertApprovedFreezeIntact({
        employeeId: emp,
        hotelDate,
        adjustmentId: adj.id,
        intervalId: interval.id,
      });
    });
  }

  // Case: late punch ingest∥approve must not lose approved 450.
  it("late punch ingest∥approve must not lose approved 450", async () => {
    const emp = world.manager.employeeId;
    // Manager as subject is fine for punch/adjustment fixtures.
    const { interval, adj, hotelDate } = await seedClosedShiftWithPendingBreak(
      emp,
      "ingest",
      "2026-07-01",
    );

    const settled = await orderedDatabaseRace(
      prisma,
      (tx) =>
        tx.$queryRaw`SELECT id FROM "AttendanceAdjustment" WHERE id = ${adj.id} FOR UPDATE`,
      () =>
        reviewAdjustment({
          adjustmentId: adj.id,
          reviewedById: world.owner.employeeId,
          decision: "approved",
        }),
      () =>
        ingestEvent({
          externalEventId: `avr-late-be-${world.stamp}`,
          source: "approve-vs-rebuild",
          employeeId: emp,
          kind: AttendanceEventKind.break_end,
          deviceTime: "2026-07-01T12:30:00.000Z",
          receivedAt: "2026-07-01T13:10:00.000Z",
        }),
    );

    const reviewResult = settled[0]!;
    const ingestResult = settled[1]!;

    if (ingestResult.status === "rejected") {
      // Fail fast when the expected race/waiter condition never appears.
      assert.fail(`ingest failed: ${formatReject(ingestResult.reason)}`);
    }
    assert.equal(
      reviewResult.status,
      "fulfilled",
      `approve-first ingest race must let approve commit; got ${
        reviewResult.status === "rejected"
          ? formatReject(reviewResult.reason)
          : "ok"
      }`,
    );
    await assertApprovedFreezeIntact({
      employeeId: emp,
      hotelDate,
      adjustmentId: adj.id,
      intervalId: interval.id,
    });
  });
});
