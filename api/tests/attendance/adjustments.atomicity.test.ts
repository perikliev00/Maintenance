/**
 * TD-05 — adjustment request/review: required audit shares the business TX;
 * notices go through the attendance notification outbox (never fail the response).
 * Failures are injected with throw-away Postgres triggers (no app mocking).
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
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
import { flushAttendanceNotificationOutbox } from "../../src/services/attendance/notificationOutbox";
import { getSetting, updateSetting } from "../../src/services/settings";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  cleanupAttendanceWorld,
  createAttendanceWorld,
  createClosedInterval,
  ensureActionGrant,
  type AttendanceWorld,
} from "./fixtures";

const prisma = new PrismaClient();

/** Install a BEFORE INSERT trigger that raises when `condition` matches; run `action`. */
async function withFailingInsert<T>(
  table: "AuditEvent" | "Notification",
  condition: string,
  action: () => Promise<T>,
): Promise<T> {
  const name = `att_atomic_fail_${randomUUID().replaceAll("-", "")}`;
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'att_atomicity_test'; END IF; RETURN NEW; END $$`,
  );
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      return await action();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "${table}"`);
    }
  } finally {
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
  }
}

describe("attendance adjustment atomicity (TD-05)", () => {
  let world: AttendanceWorld;
  let settings: Awaited<ReturnType<typeof getSetting<"notifications">>>;
  const adjustmentIds: string[] = [];
  let disposeGrants: Array<() => Promise<void>> = [];

  const hotelDate = new Date("2026-10-13T00:00:00.000Z");
  const S0 = new Date("2026-10-13T08:00:00.000Z");
  const E0 = new Date("2026-10-13T16:00:00.000Z");

  const seedInterval = () =>
    createClosedInterval(prisma, {
      employeeId: world.technician.employeeId,
      hotelDate,
      startedAt: S0,
      endedAt: E0,
      breakMinutes: 30,
      workedMinutes: 450,
    });

  async function requestFor(intervalId: string) {
    const adj = await requestAdjustment({
      intervalId,
      requestedById: world.technician.employeeId,
      actorRole: Role.technician,
      reason: "td05",
      proposedStartedAt: new Date(S0.getTime() + 30 * 60_000).toISOString(),
    });
    adjustmentIds.push(adj.id);
    return adj;
  }

  before(async () => {
    await assertTestDatabase(prisma);
    world = await createAttendanceWorld(prisma);
    disposeGrants = [
      await ensureActionGrant(
        prisma,
        Role.technician,
        "attendance.request_adjustment",
      ),
      await ensureActionGrant(
        prisma,
        Role.manager,
        "attendance.approve_adjustment",
      ),
    ];
    settings = await getSetting("notifications");
    await updateSetting({
      key: "notifications",
      value: { ...settings, in_app: { ...settings.in_app, enabled: true } },
      actorEmployeeId: world.owner.employeeId,
    });
  });

  beforeEach(async () => {
    await prisma.attendanceNotificationOutbox.deleteMany({});
  });

  after(async () => {
    if (world) {
      await updateSetting({
        key: "notifications",
        value: settings,
        actorEmployeeId: world.owner.employeeId,
      });
      await prisma.attendanceNotificationOutbox.deleteMany({});
      await prisma.notification.deleteMany({
        where: { entityId: { in: adjustmentIds } },
      });
      await prisma.auditEvent.deleteMany({
        where: { entityId: { in: adjustmentIds } },
      });
      for (const dispose of disposeGrants) await dispose();
      await cleanupAttendanceWorld(prisma, world);
    }
    await prisma.$disconnect();
  });

  it("request: audit failure rolls back adjustment + interval flip + outbox", async () => {
    const iv = await seedInterval();
    await withFailingInsert(
      "AuditEvent",
      `NEW."action" = 'adjustment.request' AND NEW."actorEmployeeId" = '${world.technician.employeeId}'`,
      () =>
        assert.rejects(
          requestAdjustment({
            intervalId: iv.id,
            requestedById: world.technician.employeeId,
            actorRole: Role.technician,
            reason: "audit will fail",
            proposedBreakMinutes: 45,
          }),
          /att_atomicity_test/,
        ),
    );

    assert.equal(
      await prisma.attendanceAdjustment.count({ where: { intervalId: iv.id } }),
      0,
    );
    const after = await prisma.attendanceInterval.findUniqueOrThrow({
      where: { id: iv.id },
    });
    assert.equal(after.status, AttendanceIntervalStatus.closed);
    assert.equal(await prisma.attendanceNotificationOutbox.count(), 0);

    // Clean retry succeeds and leaves exactly one pending adjustment + audit.
    const adj = await requestFor(iv.id);
    assert.equal(adj.status, AttendanceAdjustmentStatus.pending);
    assert.equal(
      await prisma.attendanceAdjustment.count({ where: { intervalId: iv.id } }),
      1,
    );
    assert.equal(
      await prisma.auditEvent.count({
        where: { entityId: adj.id, action: "adjustment.request" },
      }),
      1,
    );
  });

  for (const decision of ["approved", "rejected"] as const) {
    it(`review ${decision}: audit failure leaves adjustment pending; retry succeeds`, async () => {
      const iv = await seedInterval();
      const adj = await requestFor(iv.id);

      await withFailingInsert(
        "AuditEvent",
        `NEW."action" = 'adjustment.review' AND NEW."entityId" = '${adj.id}'`,
        () =>
          assert.rejects(
            reviewAdjustment({
              adjustmentId: adj.id,
              reviewedById: world.manager.employeeId,
              decision,
            }),
            /att_atomicity_test/,
          ),
      );

      // Nothing from the business write survived the failed audit.
      const pending = await prisma.attendanceAdjustment.findUniqueOrThrow({
        where: { id: adj.id },
      });
      assert.equal(pending.status, AttendanceAdjustmentStatus.pending);
      assert.equal(pending.reviewedById, null);
      assert.equal(pending.reviewedAt, null);
      const ivMid = await prisma.attendanceInterval.findUniqueOrThrow({
        where: { id: iv.id },
      });
      assert.equal(ivMid.status, AttendanceIntervalStatus.needs_review);
      assert.equal(ivMid.startedAt.getTime(), S0.getTime());
      assert.equal(
        await prisma.attendanceNotificationOutbox.count({
          where: { dedupeKey: `attendance.adjustment_reviewed:${adj.id}` },
        }),
        0,
      );

      // Retry: not "already reviewed" — the decision applies exactly once.
      const reviewed = await reviewAdjustment({
        adjustmentId: adj.id,
        reviewedById: world.manager.employeeId,
        decision,
      });
      assert.equal(
        reviewed.status,
        decision === "approved"
          ? AttendanceIntervalStatus.adjusted
          : AttendanceIntervalStatus.needs_review,
      );
      assert.equal(
        await prisma.auditEvent.count({
          where: { entityId: adj.id, action: "adjustment.review" },
        }),
        1,
      );
    });
  }

  it("notification failure after commit+audit does not fail review; flush + replay repair", async () => {
    const iv = await seedInterval();
    const adj = await requestFor(iv.id);
    const key = `attendance.adjustment_reviewed:${adj.id}`;

    const reviewed = await withFailingInsert(
      "Notification",
      `NEW."entityId" = '${adj.id}' AND NEW.type = 'attendance.adjustment_reviewed'`,
      () =>
        reviewAdjustment({
          adjustmentId: adj.id,
          reviewedById: world.manager.employeeId,
          decision: "approved",
        }),
    );
    // Business write + audit are committed and the response is a success.
    assert.equal(reviewed.status, AttendanceIntervalStatus.adjusted);
    assert.equal(
      (
        await prisma.attendanceAdjustment.findUniqueOrThrow({
          where: { id: adj.id },
        })
      ).status,
      AttendanceAdjustmentStatus.approved,
    );
    assert.equal(
      await prisma.auditEvent.count({
        where: { entityId: adj.id, action: "adjustment.review" },
      }),
      1,
    );
    // Intent is durable and still pending; no notice has been delivered yet.
    const intent = await prisma.attendanceNotificationOutbox.findUniqueOrThrow({
      where: { dedupeKey: key },
    });
    assert.equal(intent.deliveredAt, null);
    assert.equal(
      await prisma.notification.count({
        where: { entityId: adj.id, type: "attendance.adjustment_reviewed" },
      }),
      0,
    );

    // Same reviewer retrying the same decision gets a clean success (not 409)
    // and the replay delivers the pending notice; no second audit/apply.
    const replay = await reviewAdjustment({
      adjustmentId: adj.id,
      reviewedById: world.manager.employeeId,
      decision: "approved",
    });
    assert.equal(replay.status, AttendanceIntervalStatus.adjusted);
    assert.equal(
      await prisma.auditEvent.count({
        where: { entityId: adj.id, action: "adjustment.review" },
      }),
      1,
    );
    assert.equal(
      await prisma.notification.count({
        where: { entityId: adj.id, type: "attendance.adjustment_reviewed" },
      }),
      1,
    );
    assert.ok(
      (
        await prisma.attendanceNotificationOutbox.findUniqueOrThrow({
          where: { dedupeKey: key },
        })
      ).deliveredAt,
    );

    // A different decision (or reviewer) on a reviewed adjustment is still 409.
    await assert.rejects(
      () =>
        reviewAdjustment({
          adjustmentId: adj.id,
          reviewedById: world.manager.employeeId,
          decision: "rejected",
        }),
      (err: unknown) => err instanceof AppError && err.status === 409,
    );
    assert.deepEqual(await flushAttendanceNotificationOutbox(), {
      delivered: 0,
      pending: 0,
    });
  });

  it("request notice failure keeps request success; background flush delivers without duplicates", async () => {
    const iv = await seedInterval();
    const adj = await withFailingInsert(
      "Notification",
      `NEW.type = 'attendance.adjustment_requested' AND NEW."actorEmployeeId" = '${world.technician.employeeId}'`,
      () => requestFor(iv.id),
    );
    assert.equal(adj.status, AttendanceAdjustmentStatus.pending);
    assert.equal(
      await prisma.auditEvent.count({
        where: { entityId: adj.id, action: "adjustment.request" },
      }),
      1,
    );
    const key = `attendance.adjustment_requested:${adj.id}`;
    assert.equal(
      (
        await prisma.attendanceNotificationOutbox.findUniqueOrThrow({
          where: { dedupeKey: key },
        })
      ).deliveredAt,
      null,
    );

    const flushed = await flushAttendanceNotificationOutbox();
    assert.equal(flushed.pending, 0);
    assert.ok(flushed.delivered >= 1);
    const count = await prisma.notification.count({
      where: { entityId: adj.id, type: "attendance.adjustment_requested" },
    });
    assert.ok(count >= 1, "approvers notified after flush");
    await flushAttendanceNotificationOutbox();
    assert.equal(
      await prisma.notification.count({
        where: { entityId: adj.id, type: "attendance.adjustment_requested" },
      }),
      count,
    );
  });
});
