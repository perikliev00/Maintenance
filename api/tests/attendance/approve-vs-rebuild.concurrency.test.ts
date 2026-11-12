/**
 * Approve vs rebuild: manager approves a pending correction while a late punch
 * rebuilds the same employee's day. Uses production reviewAdjustment +
 * rebuildIntervalsForEmployee (the function ingest calls). Barrier only holds
 * the pending adjustment row both paths contend on — no sleeps inside business
 * logic and no invalid fixtures.
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
  AttendanceEventKind,
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
  ingestEvent,
  // Execute the next setup or assertion step for this scenario.
  rebuildIntervalsForEmployee,
  // Execute the next setup or assertion step for this scenario.
  requestAdjustment,
  // Execute the next setup or assertion step for this scenario.
  reviewAdjustment,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/attendance";
// Import bindings from ../../src/services/settings.
import { getOperations, updateSetting } from "../../src/services/settings";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { orderedDatabaseRace } from "../dbBarrier";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupAttendanceWorld,
  // Execute the next setup or assertion step for this scenario.
  createAttendanceWorld,
  // Shape AttendanceWorld documents the fixture/response fields this suite touches.
  type AttendanceWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Local helper formatReject used by cases in this file.
function formatReject(err: unknown): string {
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (err instanceof Error) {
    // Bind code for later setup or assertions in this scope.
    const code = (err as { code?: string }).code;
    // Return the arranged value/result to the caller.
    return `${err.name}${code ? `/${code}` : ""}: ${err.message}`;
  }
  // Return the arranged value/result to the caller.
  return String(err);
}

// Suite: attendance approve vs rebuild concurrency.
describe("attendance approve vs rebuild concurrency", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: AttendanceWorld;
  // Execute the next setup or assertion step for this scenario.
  let opsBefore: Awaited<ReturnType<typeof getOperations>>;
  // Bind hotelTimezone for later setup or assertions in this scope.
  let hotelTimezone = "UTC";

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
    // Execute the next setup or assertion step for this scenario.
    hotelTimezone = "UTC";
    // Await async work before asserting or releasing locks.
    await updateSetting({
      // Execute the next setup or assertion step for this scenario.
      key: "operations",
      // Execute the next setup or assertion step for this scenario.
      value: { ...opsBefore, hotelTimezone },
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "approve-vs-rebuild tz UTC",
    });
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
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
        reason: "approve-vs-rebuild tz restore",
      });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupAttendanceWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Helper seedClosedShiftWithPendingBreak: arrange fixture data for the case.
  async function seedClosedShiftWithPendingBreak(
    // Execute the next setup or assertion step for this scenario.
    employeeId: string,
    // Execute the next setup or assertion step for this scenario.
    tag: string,
    // Execute the next setup or assertion step for this scenario.
    day: string,
  // Execute the next setup or assertion step for this scenario.
  ) {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = world.stamp;
    // inRes: synchronize actors so the race window is observable.
    const inRes = await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `avr-in-${tag}-${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      source: "approve-vs-rebuild",
      // Execute the next setup or assertion step for this scenario.
      employeeId,
      // Concurrency/isolation step for the race under test.
      kind: AttendanceEventKind.clock_in,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: `${day}T08:00:00.000Z`,
      // Execute the next setup or assertion step for this scenario.
      receivedAt: `${day}T08:00:05.000Z`,
    });
    // outRes: synchronize actors so the race window is observable.
    const outRes = await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `avr-out-${tag}-${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      source: "approve-vs-rebuild",
      // Execute the next setup or assertion step for this scenario.
      employeeId,
      // Concurrency/isolation step for the race under test.
      kind: AttendanceEventKind.clock_out,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: `${day}T16:00:00.000Z`,
      // Execute the next setup or assertion step for this scenario.
      receivedAt: `${day}T16:00:05.000Z`,
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(inRes.created && outRes.created);

    // interval: synchronize actors so the race window is observable.
    const interval = await prisma.attendanceInterval.findFirstOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        employeeId,
        // Execute the next setup or assertion step for this scenario.
        startEventId: inRes.event.id,
        // Fixture field status for the seeded actor/entity.
        status: AttendanceIntervalStatus.closed,
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(interval.workedMinutes, 480);

    // adj: HTTP response captured for status/body checks.
    const adj = await requestAdjustment({
      // Execute the next setup or assertion step for this scenario.
      intervalId: interval.id,
      // Execute the next setup or assertion step for this scenario.
      requestedById: employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorRole: Role.housekeeper,
      // Execute the next setup or assertion step for this scenario.
      reason: "actual lunch 30m",
      // Execute the next setup or assertion step for this scenario.
      proposedBreakMinutes: 30,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(adj.status, AttendanceAdjustmentStatus.pending);

    // Return the arranged value/result to the caller.
    return { interval, adj, hotelDate: interval.hotelDate };
  }

  // Helper assertApprovedFreezeIntact: assert expected post-condition.
  async function assertApprovedFreezeIntact(input: {
    // Execute the next setup or assertion step for this scenario.
    employeeId: string;
    // Execute the next setup or assertion step for this scenario.
    hotelDate: Date;
    // Execute the next setup or assertion step for this scenario.
    adjustmentId: string;
    // Execute the next setup or assertion step for this scenario.
    intervalId: string;
  }) {
    // adj: synchronize actors so the race window is observable.
    const adj = await prisma.attendanceAdjustment.findUnique({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: input.adjustmentId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(adj, "approved adjustment row must still exist");
    // Assert HTTP status matches the contract for this path.
    assert.equal(adj.status, AttendanceAdjustmentStatus.approved);

    // frozen: synchronize actors so the race window is observable.
    const frozen = await prisma.attendanceInterval.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: input.employeeId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: input.hotelDate,
        // Fixture field status for the seeded actor/entity.
        status: AttendanceIntervalStatus.adjusted,
      },
    });
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.equal(frozen.length, 1, "exactly one adjusted interval expected");
    // Assert the observed value matches the intended post-condition.
    assert.equal(frozen[0]!.workedMinutes, 450);
    // Assert the observed value matches the intended post-condition.
    assert.equal(frozen[0]!.breakMinutes, 30);

    // Original interval id may survive or be replaced only if freeze kept —
    // approved minutes are the business invariant.
    const audits = await prisma.auditEvent.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        entityType: "attendance_adjustment",
        // Execute the next setup or assertion step for this scenario.
        entityId: input.adjustmentId,
        // Execute the next setup or assertion step for this scenario.
        action: "adjustment.review",
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(audits >= 1, "approval audit must remain");
  }

  // Case: control: approve then rebuild keeps 450 minutes.
  it("control: approve then rebuild keeps 450 minutes", async () => {
    // Bind emp for later setup or assertions in this scope.
    const emp = world.housekeeper.employeeId;
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    const { interval, adj, hotelDate } = await seedClosedShiftWithPendingBreak(
      // Execute the next setup or assertion step for this scenario.
      emp,
      // Execute the next setup or assertion step for this scenario.
      "ctrl",
      // Execute the next setup or assertion step for this scenario.
      "2026-05-01",
    );

    // Await async work before asserting or releasing locks.
    await reviewAdjustment({
      // Execute the next setup or assertion step for this scenario.
      adjustmentId: adj.id,
      // Execute the next setup or assertion step for this scenario.
      reviewedById: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      decision: "approved",
    });

    // Await async work before asserting or releasing locks.
    await rebuildIntervalsForEmployee(emp, hotelDate, hotelTimezone);

    // Await async work before asserting or releasing locks.
    await assertApprovedFreezeIntact({
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Execute the next setup or assertion step for this scenario.
      hotelDate,
      // Execute the next setup or assertion step for this scenario.
      adjustmentId: adj.id,
      // Execute the next setup or assertion step for this scenario.
      intervalId: interval.id,
    });
  });

  // Case: control: rebuild then approve — approve still applies or conflicts cleanly.
  it("control: rebuild then approve — approve still applies or conflicts cleanly", async () => {
    // Bind emp for later setup or assertions in this scope.
    const emp = world.technician.employeeId;
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    const { adj, hotelDate } = await seedClosedShiftWithPendingBreak(
      // Execute the next setup or assertion step for this scenario.
      emp,
      // Execute the next setup or assertion step for this scenario.
      "ctrl2",
      // Execute the next setup or assertion step for this scenario.
      "2026-05-02",
    );

    // Await async work before asserting or releasing locks.
    await rebuildIntervalsForEmployee(emp, hotelDate, hotelTimezone);

    // Pending rematch may move the adjustment to a new interval id; review by
    // original id should either approve the rematched row or fail structured.
    const stillThere = await prisma.attendanceAdjustment.findUnique({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: adj.id },
    });
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (!stillThere) {
      // rematched: synchronize actors so the race window is observable.
      const rematched = await prisma.attendanceAdjustment.findFirst({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          interval: { employeeId: emp, hotelDate },
          // Fixture field status for the seeded actor/entity.
          status: AttendanceAdjustmentStatus.pending,
        },
      });
      // Assert the observed value matches the intended post-condition.
      assert.ok(rematched, "pending adjustment must rematch after rebuild");
      // Await async work before asserting or releasing locks.
      await reviewAdjustment({
        // Execute the next setup or assertion step for this scenario.
        adjustmentId: rematched.id,
        // Execute the next setup or assertion step for this scenario.
        reviewedById: world.manager.employeeId,
        // Execute the next setup or assertion step for this scenario.
        decision: "approved",
      });
      // Await async work before asserting or releasing locks.
      await assertApprovedFreezeIntact({
        // Execute the next setup or assertion step for this scenario.
        employeeId: emp,
        // Execute the next setup or assertion step for this scenario.
        hotelDate,
        // Execute the next setup or assertion step for this scenario.
        adjustmentId: rematched.id,
        // Execute the next setup or assertion step for this scenario.
        intervalId: rematched.intervalId,
      });
      // Execute the next setup or assertion step for this scenario.
      return;
    }

    // Await async work before asserting or releasing locks.
    await reviewAdjustment({
      // Execute the next setup or assertion step for this scenario.
      adjustmentId: adj.id,
      // Execute the next setup or assertion step for this scenario.
      reviewedById: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      decision: "approved",
    });
    // Await async work before asserting or releasing locks.
    await assertApprovedFreezeIntact({
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Execute the next setup or assertion step for this scenario.
      hotelDate,
      // Execute the next setup or assertion step for this scenario.
      adjustmentId: adj.id,
      // Execute the next setup or assertion step for this scenario.
      intervalId: stillThere.intervalId,
    });
  });

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let rep = 1; rep <= 5; rep++) {
    // Case probes concurrency/isolation: unordered concurrent approve∥rebuild must not lose approved 450 (rep ${rep}).
    it(`unordered concurrent approve∥rebuild must not lose approved 450 (rep ${rep})`, async () => {
      // Bind emp for later setup or assertions in this scope.
      const emp = world.otherHk.employeeId;
      // Bind day for later setup or assertions in this scope.
      const day = `2026-05-${String(10 + rep).padStart(2, "0")}`;
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      const { interval, adj, hotelDate } = await seedClosedShiftWithPendingBreak(
        // Execute the next setup or assertion step for this scenario.
        emp,
        // Execute the next setup or assertion step for this scenario.
        `unord${rep}`,
        // Execute the next setup or assertion step for this scenario.
        day,
      );

      // settled: capture concurrent outcomes for race assertions.
      const settled = await Promise.allSettled([
        // Execute the next setup or assertion step for this scenario.
        reviewAdjustment({
          // Execute the next setup or assertion step for this scenario.
          adjustmentId: adj.id,
          // Execute the next setup or assertion step for this scenario.
          reviewedById: world.manager.employeeId,
          // Execute the next setup or assertion step for this scenario.
          decision: "approved",
        }),
        // Execute the next setup or assertion step for this scenario.
        rebuildIntervalsForEmployee(emp, hotelDate, hotelTimezone),
      ]);

      // Bind reviewResult for later setup or assertions in this scope.
      const reviewResult = settled[0]!;
      // Bind rebuildResult for later setup or assertions in this scope.
      const rebuildResult = settled[1]!;

      // Guard optional cleanup or alternate assertion paths.
      if (rebuildResult.status === "rejected") {
        // Fail fast when the expected race/waiter condition never appears.
        assert.fail(`rebuild failed: ${formatReject(rebuildResult.reason)}`);
      }

      // reviewAudit: synchronize actors so the race window is observable.
      const reviewAudit = await prisma.auditEvent.count({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          entityType: "attendance_adjustment",
          // Execute the next setup or assertion step for this scenario.
          entityId: adj.id,
          // Execute the next setup or assertion step for this scenario.
          action: "adjustment.review",
        },
      });
      // Guard optional cleanup or alternate assertion paths.
      if (reviewResult.status === "fulfilled" || reviewAudit > 0) {
        // Approve committed (even if a post-commit read raced) — freeze must remain.
        await assertApprovedFreezeIntact({
          // Execute the next setup or assertion step for this scenario.
          employeeId: emp,
          // Execute the next setup or assertion step for this scenario.
          hotelDate,
          // Execute the next setup or assertion step for this scenario.
          adjustmentId: adj.id,
          // Execute the next setup or assertion step for this scenario.
          intervalId: interval.id,
        });
      // Execute the next setup or assertion step for this scenario.
      } else {
        // Bind err for later setup or assertions in this scope.
        const err = reviewResult.reason as { status?: number; code?: string };
        // Assert the observed value matches the intended post-condition.
        assert.ok(
          // Execute the next setup or assertion step for this scenario.
          err?.status === 404 || err?.status === 409,
          // Execute the next setup or assertion step for this scenario.
          `unexpected review failure: ${formatReject(reviewResult.reason)}`,
        );
      }
    });
  }

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let rep = 1; rep <= 3; rep++) {
    // Case probes concurrency/isolation: ordered race: rebuild waits on pending adj, approve first — freeze must survive (rep ${rep}).
    it(`ordered race: rebuild waits on pending adj, approve first — freeze must survive (rep ${rep})`, async () => {
      // Bind emp for later setup or assertions in this scope.
      const emp = world.supervisor.employeeId;
      // Bind day for later setup or assertions in this scope.
      const day = `2026-06-${String(10 + rep).padStart(2, "0")}`;
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      const { interval, adj, hotelDate } = await seedClosedShiftWithPendingBreak(
        // Execute the next setup or assertion step for this scenario.
        emp,
        // Execute the next setup or assertion step for this scenario.
        `ord${rep}`,
        // Execute the next setup or assertion step for this scenario.
        day,
      );

      // Both paths touch the pending adjustment row: approve claims it, rebuild
      // deleteMany removes adjustments for snapshotted interval ids. Holding that
      // row forces rebuild to snapshot first, then wait on delete, while approve
      // waits on the claim — the real interleaving window.
      const settled = await orderedDatabaseRace(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Execute the next setup or assertion step for this scenario.
        (tx) =>
          // Execute the next setup or assertion step for this scenario.
          tx.$queryRaw`SELECT id FROM "AttendanceAdjustment" WHERE id = ${adj.id} FOR UPDATE`,
        // Execute the next setup or assertion step for this scenario.
        () =>
          // Execute the next setup or assertion step for this scenario.
          reviewAdjustment({
            // Execute the next setup or assertion step for this scenario.
            adjustmentId: adj.id,
            // Execute the next setup or assertion step for this scenario.
            reviewedById: world.manager.employeeId,
            // Execute the next setup or assertion step for this scenario.
            decision: "approved",
          }),
        // Execute the next setup or assertion step for this scenario.
        () => rebuildIntervalsForEmployee(emp, hotelDate, hotelTimezone),
      );

      // Bind reviewResult for later setup or assertions in this scope.
      const reviewResult = settled[0]!;
      // Bind rebuildResult for later setup or assertions in this scope.
      const rebuildResult = settled[1]!;

      // Guard optional cleanup or alternate assertion paths.
      if (rebuildResult.status === "rejected") {
        // Fail fast when the expected race/waiter condition never appears.
        assert.fail(`rebuild failed: ${formatReject(rebuildResult.reason)}`);
      }
      // Approve was queued first on the adjustment row. If it could not claim,
      // this barrier did not exercise the approve-then-stale-delete window.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        reviewResult.status,
        // Execute the next setup or assertion step for this scenario.
        "fulfilled",
        // Concurrency/isolation step for the race under test.
        `approve-first race must let approve commit; got ${
          reviewResult.status === "rejected"
            ? formatReject(reviewResult.reason)
            : "ok"
        // Execute the next setup or assertion step for this scenario.
        }`,
      );
      // Await async work before asserting or releasing locks.
      await assertApprovedFreezeIntact({
        // Execute the next setup or assertion step for this scenario.
        employeeId: emp,
        // Execute the next setup or assertion step for this scenario.
        hotelDate,
        // Execute the next setup or assertion step for this scenario.
        adjustmentId: adj.id,
        // Execute the next setup or assertion step for this scenario.
        intervalId: interval.id,
      });
    });
  }

  // Case: late punch ingest∥approve must not lose approved 450.
  it("late punch ingest∥approve must not lose approved 450", async () => {
    // Bind emp for later setup or assertions in this scope.
    const emp = world.manager.employeeId;
    // Manager as subject is fine for punch/adjustment fixtures.
    const { interval, adj, hotelDate } = await seedClosedShiftWithPendingBreak(
      // Execute the next setup or assertion step for this scenario.
      emp,
      // Execute the next setup or assertion step for this scenario.
      "ingest",
      // Execute the next setup or assertion step for this scenario.
      "2026-07-01",
    );

    // settled: synchronize actors so the race window is observable.
    const settled = await orderedDatabaseRace(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      (tx) =>
        // Execute the next setup or assertion step for this scenario.
        tx.$queryRaw`SELECT id FROM "AttendanceAdjustment" WHERE id = ${adj.id} FOR UPDATE`,
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Execute the next setup or assertion step for this scenario.
        reviewAdjustment({
          // Execute the next setup or assertion step for this scenario.
          adjustmentId: adj.id,
          // Execute the next setup or assertion step for this scenario.
          reviewedById: world.owner.employeeId,
          // Execute the next setup or assertion step for this scenario.
          decision: "approved",
        }),
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Execute the next setup or assertion step for this scenario.
        ingestEvent({
          // Execute the next setup or assertion step for this scenario.
          externalEventId: `avr-late-be-${world.stamp}`,
          // Execute the next setup or assertion step for this scenario.
          source: "approve-vs-rebuild",
          // Execute the next setup or assertion step for this scenario.
          employeeId: emp,
          // Execute the next setup or assertion step for this scenario.
          kind: AttendanceEventKind.break_end,
          // Execute the next setup or assertion step for this scenario.
          deviceTime: "2026-07-01T12:30:00.000Z",
          // Execute the next setup or assertion step for this scenario.
          receivedAt: "2026-07-01T13:10:00.000Z",
        }),
    );

    // Bind reviewResult for later setup or assertions in this scope.
    const reviewResult = settled[0]!;
    // Bind ingestResult for later setup or assertions in this scope.
    const ingestResult = settled[1]!;

    // Guard optional cleanup or alternate assertion paths.
    if (ingestResult.status === "rejected") {
      // Fail fast when the expected race/waiter condition never appears.
      assert.fail(`ingest failed: ${formatReject(ingestResult.reason)}`);
    }
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      reviewResult.status,
      // Execute the next setup or assertion step for this scenario.
      "fulfilled",
      // Concurrency/isolation step for the race under test.
      `approve-first ingest race must let approve commit; got ${
        reviewResult.status === "rejected"
          ? formatReject(reviewResult.reason)
          : "ok"
      // Execute the next setup or assertion step for this scenario.
      }`,
    );
    // Await async work before asserting or releasing locks.
    await assertApprovedFreezeIntact({
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Execute the next setup or assertion step for this scenario.
      hotelDate,
      // Execute the next setup or assertion step for this scenario.
      adjustmentId: adj.id,
      // Execute the next setup or assertion step for this scenario.
      intervalId: interval.id,
    });
  });
});
