/**
 * TD-05 — adjustment request/review: required audit shares the business TX;
 * notices go through the attendance notification outbox (never fail the response).
 * Failures are injected with throw-away Postgres triggers (no app mocking).
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
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
// Import bindings from ../../src/services/attendance/notificationOutbox.
import { flushAttendanceNotificationOutbox } from "../../src/services/attendance/notificationOutbox";
// Import bindings from ../../src/services/settings.
import { getSetting, updateSetting } from "../../src/services/settings";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
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

/** Install a BEFORE INSERT trigger that raises when `condition` matches; run `action`. */
async function withFailingInsert<T>(
  // Delivery/replay step for async notification paths.
  table: "AuditEvent" | "Notification",
  // Execute the next setup or assertion step for this scenario.
  condition: string,
  // Execute the next setup or assertion step for this scenario.
  action: () => Promise<T>,
// Execute the next setup or assertion step for this scenario.
): Promise<T> {
  // name: unique stamp so parallel runs do not collide.
  const name = `att_atomic_fail_${randomUUID().replaceAll("-", "")}`;
  // Await async work before asserting or releasing locks.
  await prisma.$executeRawUnsafe(
    // Execute the next setup or assertion step for this scenario.
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'att_atomicity_test'; END IF; RETURN NEW; END $$`,
  );
  // Try path where partial failure must not leak suite state.
  try {
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(
      // Execute the next setup or assertion step for this scenario.
      `CREATE TRIGGER ${name} BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    // Try path where partial failure must not leak suite state.
    try {
      // Return the arranged value/result to the caller.
      return await action();
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "${table}"`);
    }
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
  }
}

// Suite: attendance adjustment atomicity (TD-05).
describe("attendance adjustment atomicity (TD-05)", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: AttendanceWorld;
  // Delivery/replay step for async notification paths.
  let settings: Awaited<ReturnType<typeof getSetting<"notifications">>>;
  // Execute the next setup or assertion step for this scenario.
  const adjustmentIds: string[] = [];
  // Execute the next setup or assertion step for this scenario.
  let disposeGrants: Array<() => Promise<void>> = [];

  // Bind hotelDate for later setup or assertions in this scope.
  const hotelDate = new Date("2026-10-13T00:00:00.000Z");
  // Bind S0 for later setup or assertions in this scope.
  const S0 = new Date("2026-10-13T08:00:00.000Z");
  // Bind E0 for later setup or assertions in this scope.
  const E0 = new Date("2026-10-13T16:00:00.000Z");

  // Bind seedInterval for later setup or assertions in this scope.
  const seedInterval = () =>
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    createClosedInterval(prisma, {
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate,
      // Execute the next setup or assertion step for this scenario.
      startedAt: S0,
      // Execute the next setup or assertion step for this scenario.
      endedAt: E0,
      // Execute the next setup or assertion step for this scenario.
      breakMinutes: 30,
      // Execute the next setup or assertion step for this scenario.
      workedMinutes: 450,
    });

  // Local helper requestFor used by cases in this file.
  async function requestFor(intervalId: string) {
    // adj: HTTP response captured for status/body checks.
    const adj = await requestAdjustment({
      // Execute the next setup or assertion step for this scenario.
      intervalId,
      // Execute the next setup or assertion step for this scenario.
      requestedById: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorRole: Role.technician,
      // Execute the next setup or assertion step for this scenario.
      reason: "td05",
      // Execute the next setup or assertion step for this scenario.
      proposedStartedAt: new Date(S0.getTime() + 30 * 60_000).toISOString(),
    });
    // Execute the next setup or assertion step for this scenario.
    adjustmentIds.push(adj.id);
    // Return the arranged value/result to the caller.
    return adj;
  }

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createAttendanceWorld(prisma);
    // Execute the next setup or assertion step for this scenario.
    disposeGrants = [
      // Await async work before asserting or releasing locks.
      await ensureActionGrant(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Execute the next setup or assertion step for this scenario.
        Role.technician,
        // Execute the next setup or assertion step for this scenario.
        "attendance.request_adjustment",
      ),
      // Await async work before asserting or releasing locks.
      await ensureActionGrant(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Execute the next setup or assertion step for this scenario.
        Role.manager,
        // Execute the next setup or assertion step for this scenario.
        "attendance.approve_adjustment",
      ),
    ];
    // Await async work before asserting or releasing locks.
    settings = await getSetting("notifications");
    // Await async work before asserting or releasing locks.
    await updateSetting({
      // Delivery/replay step for async notification paths.
      key: "notifications",
      // Execute the next setup or assertion step for this scenario.
      value: { ...settings, in_app: { ...settings.in_app, enabled: true } },
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
    });
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await prisma.attendanceNotificationOutbox.deleteMany({});
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) {
      // Await async work before asserting or releasing locks.
      await updateSetting({
        // Delivery/replay step for async notification paths.
        key: "notifications",
        // Execute the next setup or assertion step for this scenario.
        value: settings,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
      });
      // Await async work before asserting or releasing locks.
      await prisma.attendanceNotificationOutbox.deleteMany({});
      // Await async work before asserting or releasing locks.
      await prisma.notification.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityId: { in: adjustmentIds } },
      });
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityId: { in: adjustmentIds } },
      });
      // Iterate to cover variants or wait until a condition holds.
      for (const dispose of disposeGrants) await dispose();
      // Await async work before asserting or releasing locks.
      await cleanupAttendanceWorld(prisma, world);
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: request: audit failure rolls back adjustment + interval flip + outbox.
  it("request: audit failure rolls back adjustment + interval flip + outbox", async () => {
    // iv: seeded entity required before the mutation under test.
    const iv = await seedInterval();
    // Await async work before asserting or releasing locks.
    await withFailingInsert(
      // Execute the next setup or assertion step for this scenario.
      "AuditEvent",
      // Execute the next setup or assertion step for this scenario.
      `NEW."action" = 'adjustment.request' AND NEW."actorEmployeeId" = '${world.technician.employeeId}'`,
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Assert the observed value matches the intended post-condition.
        assert.rejects(
          // Execute the next setup or assertion step for this scenario.
          requestAdjustment({
            // Execute the next setup or assertion step for this scenario.
            intervalId: iv.id,
            // Execute the next setup or assertion step for this scenario.
            requestedById: world.technician.employeeId,
            // Execute the next setup or assertion step for this scenario.
            actorRole: Role.technician,
            // Execute the next setup or assertion step for this scenario.
            reason: "audit will fail",
            // Execute the next setup or assertion step for this scenario.
            proposedBreakMinutes: 45,
          }),
          // Execute the next setup or assertion step for this scenario.
          /att_atomicity_test/,
        ),
    );

    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.attendanceAdjustment.count({ where: { intervalId: iv.id } }),
      0,
    );
    // after: synchronize actors so the race window is observable.
    const after = await prisma.attendanceInterval.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: iv.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(after.status, AttendanceIntervalStatus.closed);
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.attendanceNotificationOutbox.count(), 0);

    // Clean retry succeeds and leaves exactly one pending adjustment + audit.
    const adj = await requestFor(iv.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal(adj.status, AttendanceAdjustmentStatus.pending);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.attendanceAdjustment.count({ where: { intervalId: iv.id } }),
      1,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityId: adj.id, action: "adjustment.request" },
      }),
      1,
    );
  });

  // Iterate to cover variants or wait until a condition holds.
  for (const decision of ["approved", "rejected"] as const) {
    // Case: review ${decision}: audit failure leaves adjustment pending; retry succeeds.
    it(`review ${decision}: audit failure leaves adjustment pending; retry succeeds`, async () => {
      // iv: seeded entity required before the mutation under test.
      const iv = await seedInterval();
      // adj: HTTP response captured for status/body checks.
      const adj = await requestFor(iv.id);

      // Await async work before asserting or releasing locks.
      await withFailingInsert(
        // Execute the next setup or assertion step for this scenario.
        "AuditEvent",
        // Execute the next setup or assertion step for this scenario.
        `NEW."action" = 'adjustment.review' AND NEW."entityId" = '${adj.id}'`,
        // Execute the next setup or assertion step for this scenario.
        () =>
          // Assert the observed value matches the intended post-condition.
          assert.rejects(
            // Execute the next setup or assertion step for this scenario.
            reviewAdjustment({
              // Execute the next setup or assertion step for this scenario.
              adjustmentId: adj.id,
              // Execute the next setup or assertion step for this scenario.
              reviewedById: world.manager.employeeId,
              // Execute the next setup or assertion step for this scenario.
              decision,
            }),
            // Execute the next setup or assertion step for this scenario.
            /att_atomicity_test/,
          ),
      );

      // Nothing from the business write survived the failed audit.
      const pending = await prisma.attendanceAdjustment.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: adj.id },
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(pending.status, AttendanceAdjustmentStatus.pending);
      // Assert the observed value matches the intended post-condition.
      assert.equal(pending.reviewedById, null);
      // Assert the observed value matches the intended post-condition.
      assert.equal(pending.reviewedAt, null);
      // ivMid: unique stamp so parallel runs do not collide.
      const ivMid = await prisma.attendanceInterval.findUniqueOrThrow({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: iv.id },
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(ivMid.status, AttendanceIntervalStatus.needs_review);
      // Assert the observed value matches the intended post-condition.
      assert.equal(ivMid.startedAt.getTime(), S0.getTime());
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Await async work before asserting or releasing locks.
        await prisma.attendanceNotificationOutbox.count({
          // SQL fragment used to observe locks or assert DB state.
          where: { dedupeKey: `attendance.adjustment_reviewed:${adj.id}` },
        }),
        0,
      );

      // Retry: not "already reviewed" — the decision applies exactly once.
      const reviewed = await reviewAdjustment({
        // Execute the next setup or assertion step for this scenario.
        adjustmentId: adj.id,
        // Execute the next setup or assertion step for this scenario.
        reviewedById: world.manager.employeeId,
        // Execute the next setup or assertion step for this scenario.
        decision,
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        reviewed.status,
        // Execute the next setup or assertion step for this scenario.
        decision === "approved"
          ? AttendanceIntervalStatus.adjusted
          : AttendanceIntervalStatus.needs_review,
      );
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Await async work before asserting or releasing locks.
        await prisma.auditEvent.count({
          // SQL fragment used to observe locks or assert DB state.
          where: { entityId: adj.id, action: "adjustment.review" },
        }),
        1,
      );
    });
  }

  // Case: notification failure after commit+audit does not fail review; flush + replay repair.
  it("notification failure after commit+audit does not fail review; flush + replay repair", async () => {
    // iv: seeded entity required before the mutation under test.
    const iv = await seedInterval();
    // adj: HTTP response captured for status/body checks.
    const adj = await requestFor(iv.id);
    // Bind key for later setup or assertions in this scope.
    const key = `attendance.adjustment_reviewed:${adj.id}`;

    // reviewed: seeded entity required before the mutation under test.
    const reviewed = await withFailingInsert(
      // Delivery/replay step for async notification paths.
      "Notification",
      // Execute the next setup or assertion step for this scenario.
      `NEW."entityId" = '${adj.id}' AND NEW.type = 'attendance.adjustment_reviewed'`,
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
    );
    // Business write + audit are committed and the response is a success.
    assert.equal(reviewed.status, AttendanceIntervalStatus.adjusted);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      (
        // Await async work before asserting or releasing locks.
        await prisma.attendanceAdjustment.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: adj.id },
        })
      // Execute the next setup or assertion step for this scenario.
      ).status,
      // Execute the next setup or assertion step for this scenario.
      AttendanceAdjustmentStatus.approved,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityId: adj.id, action: "adjustment.review" },
      }),
      1,
    );
    // Intent is durable and still pending; no notice has been delivered yet.
    const intent = await prisma.attendanceNotificationOutbox.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { dedupeKey: key },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(intent.deliveredAt, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.notification.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityId: adj.id, type: "attendance.adjustment_reviewed" },
      }),
      0,
    );

    // Same reviewer retrying the same decision gets a clean success (not 409)
    // and the replay delivers the pending notice; no second audit/apply.
    const replay = await reviewAdjustment({
      // Execute the next setup or assertion step for this scenario.
      adjustmentId: adj.id,
      // Execute the next setup or assertion step for this scenario.
      reviewedById: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      decision: "approved",
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(replay.status, AttendanceIntervalStatus.adjusted);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityId: adj.id, action: "adjustment.review" },
      }),
      1,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.notification.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityId: adj.id, type: "attendance.adjustment_reviewed" },
      }),
      1,
    );
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      (
        // Await async work before asserting or releasing locks.
        await prisma.attendanceNotificationOutbox.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { dedupeKey: key },
        })
      // Execute the next setup or assertion step for this scenario.
      ).deliveredAt,
    );

    // A different decision (or reviewer) on a reviewed adjustment is still 409.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Execute the next setup or assertion step for this scenario.
        reviewAdjustment({
          // Execute the next setup or assertion step for this scenario.
          adjustmentId: adj.id,
          // Execute the next setup or assertion step for this scenario.
          reviewedById: world.manager.employeeId,
          // Execute the next setup or assertion step for this scenario.
          decision: "rejected",
        }),
      // Execute the next setup or assertion step for this scenario.
      (err: unknown) => err instanceof AppError && err.status === 409,
    );
    {
      // empty: synchronize actors so the race window is observable.
      const empty = await flushAttendanceNotificationOutbox();
      // Assert the observed value matches the intended post-condition.
      assert.equal(empty.delivered, 0);
      // Assert the observed value matches the intended post-condition.
      assert.equal(empty.pending, 0);
      // Assert the observed value matches the intended post-condition.
      assert.equal(empty.backlog, 0);
    }
  });

  // Case: request notice failure keeps request success; background flush delivers without duplicates.
  it("request notice failure keeps request success; background flush delivers without duplicates", async () => {
    // iv: seeded entity required before the mutation under test.
    const iv = await seedInterval();
    // adj: seeded entity required before the mutation under test.
    const adj = await withFailingInsert(
      // Delivery/replay step for async notification paths.
      "Notification",
      // Execute the next setup or assertion step for this scenario.
      `NEW.type = 'attendance.adjustment_requested' AND NEW."actorEmployeeId" = '${world.technician.employeeId}'`,
      // Execute the next setup or assertion step for this scenario.
      () => requestFor(iv.id),
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(adj.status, AttendanceAdjustmentStatus.pending);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityId: adj.id, action: "adjustment.request" },
      }),
      1,
    );
    // Bind key for later setup or assertions in this scope.
    const key = `attendance.adjustment_requested:${adj.id}`;
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      (
        // Await async work before asserting or releasing locks.
        await prisma.attendanceNotificationOutbox.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { dedupeKey: key },
        })
      // Execute the next setup or assertion step for this scenario.
      ).deliveredAt,
      // Execute the next setup or assertion step for this scenario.
      null,
    );

    // flushed: synchronize actors so the race window is observable.
    const flushed = await flushAttendanceNotificationOutbox();
    // Assert the observed value matches the intended post-condition.
    assert.equal(flushed.pending, 0);
    // Assert the observed value matches the intended post-condition.
    assert.ok(flushed.delivered >= 1);
    // count: synchronize actors so the race window is observable.
    const count = await prisma.notification.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { entityId: adj.id, type: "attendance.adjustment_requested" },
    });
    // Assert collection size matches the expected post-condition.
    assert.ok(count >= 1, "approvers notified after flush");
    // Await async work before asserting or releasing locks.
    await flushAttendanceNotificationOutbox();
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.notification.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityId: adj.id, type: "attendance.adjustment_requested" },
      }),
      // Execute the next setup or assertion step for this scenario.
      count,
    );
  });
});
