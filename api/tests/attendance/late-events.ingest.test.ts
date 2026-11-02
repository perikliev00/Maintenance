/**
 * late-event ingest vs approved freeze and pending rematch.
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
  requestAdjustment,
  reviewAdjustment,
} from "../../src/services/attendance";
import {
  getOperations,
  updateSetting,
} from "../../src/services/settings";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  cleanupAttendanceWorld,
  createAttendanceWorld,
  type AttendanceWorld,
} from "./fixtures";

const prisma = new PrismaClient();

describe("attendance late-events ingest", () => {
  let world: AttendanceWorld;
  let opsBefore: Awaited<ReturnType<typeof getOperations>>;
  let stamp = "";

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    world = await createAttendanceWorld(prisma);
    stamp = world.stamp;
    opsBefore = await getOperations();
    await updateSetting({
      key: "operations",
      value: { ...opsBefore, hotelTimezone: "UTC" },
      actorEmployeeId: world.owner.employeeId,
      reason: "att-73 tz UTC",
    });
  });

  after(async () => {
    if (opsBefore) {
      await updateSetting({
        key: "operations",
        value: opsBefore,
        actorEmployeeId: world.owner.employeeId,
        reason: "att-73 tz restore",
      });
    }
    if (world) await cleanupAttendanceWorld(prisma, world);
    await prisma.$disconnect();
  });

  async function seedClosedShift(employeeId: string, tag: string) {
    const inRes = await ingestEvent({
      externalEventId: `late-in-${tag}-${stamp}`,
      source: "late-test",
      employeeId,
      kind: AttendanceEventKind.clock_in,
      deviceTime: "2026-03-15T08:00:00.000Z",
      receivedAt: "2026-03-15T08:00:05.000Z",
    });
    const outRes = await ingestEvent({
      externalEventId: `late-out-${tag}-${stamp}`,
      source: "late-test",
      employeeId,
      kind: AttendanceEventKind.clock_out,
      deviceTime: "2026-03-15T16:00:00.000Z",
      receivedAt: "2026-03-15T16:00:05.000Z",
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
    return { interval, clockInId: inRes.event.id };
  }

  it("approved freeze survives late ingest inside window", async () => {
    const emp = world.technician.employeeId;
    const controlBefore = await prisma.attendanceEvent.count({
      where: { employeeId: world.control.employeeId },
    });
    const { interval } = await seedClosedShift(emp, "73a");

    const adj = await requestAdjustment({
      intervalId: interval.id,
      requestedById: emp,
      actorRole: Role.technician,
      reason: "add break",
      proposedBreakMinutes: 30,
    });
    await reviewAdjustment({
      adjustmentId: adj.id,
      reviewedById: world.manager.employeeId,
      decision: "approved",
    });

    const frozen = await prisma.attendanceInterval.findUniqueOrThrow({
      where: { id: interval.id },
    });
    assert.equal(frozen.status, AttendanceIntervalStatus.adjusted);
    assert.equal(frozen.breakMinutes, 30);
    assert.equal(frozen.workedMinutes, 450);

    const approvedBefore = await prisma.attendanceAdjustment.findUniqueOrThrow({
      where: { id: adj.id },
    });
    assert.equal(approvedBefore.status, AttendanceAdjustmentStatus.approved);
    assert.ok(approvedBefore.reason.trim().length > 0);
    assert.equal(approvedBefore.proposedBreakMinutes, 30);
    assert.equal(approvedBefore.reviewedById, world.manager.employeeId);
    assert.ok(approvedBefore.reviewedAt);

    const auditsBefore = await prisma.auditEvent.findMany({
      where: {
        entityType: "attendance_adjustment",
        entityId: adj.id,
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        action: true,
        entityId: true,
        actorEmployeeId: true,
        summary: true,
        after: true,
      },
    });
    assert.ok(
      auditsBefore.length >= 1,
      "approved adjustment must have non-empty audit history before late ingest",
    );
    const auditIdsBefore = auditsBefore.map((a) => a.id);

    await ingestEvent({
      externalEventId: `late-break-${stamp}`,
      source: "late-test",
      employeeId: emp,
      kind: AttendanceEventKind.break_start,
      deviceTime: "2026-03-15T12:00:00.000Z",
      receivedAt: "2026-03-15T12:40:00.000Z",
      clockSkewSeconds: 2400,
    });
    await ingestEvent({
      externalEventId: `late-break-end-${stamp}`,
      source: "late-test",
      employeeId: emp,
      kind: AttendanceEventKind.break_end,
      deviceTime: "2026-03-15T12:30:00.000Z",
      receivedAt: "2026-03-15T13:10:00.000Z",
    });

    const after = await prisma.attendanceInterval.findUniqueOrThrow({
      where: { id: interval.id },
    });
    assert.equal(after.status, AttendanceIntervalStatus.adjusted);
    assert.equal(after.startedAt.getTime(), frozen.startedAt.getTime());
    assert.equal(after.endedAt?.getTime(), frozen.endedAt?.getTime());
    assert.equal(after.breakMinutes, 30);
    assert.equal(after.workedMinutes, 450);
    assert.equal(after.hotelDate.getTime(), frozen.hotelDate.getTime());

    const approvedAfter = await prisma.attendanceAdjustment.findUniqueOrThrow({
      where: { id: adj.id },
    });
    assert.equal(approvedAfter.id, approvedBefore.id);
    assert.equal(approvedAfter.status, AttendanceAdjustmentStatus.approved);
    assert.equal(approvedAfter.reason, approvedBefore.reason);
    assert.equal(
      approvedAfter.proposedBreakMinutes,
      approvedBefore.proposedBreakMinutes,
    );
    assert.equal(
      approvedAfter.proposedStartedAt?.getTime() ?? null,
      approvedBefore.proposedStartedAt?.getTime() ?? null,
    );
    assert.equal(
      approvedAfter.proposedEndedAt?.getTime() ?? null,
      approvedBefore.proposedEndedAt?.getTime() ?? null,
    );
    assert.equal(approvedAfter.requestedById, approvedBefore.requestedById);
    assert.equal(approvedAfter.reviewedById, approvedBefore.reviewedById);
    assert.equal(
      approvedAfter.reviewedAt?.getTime() ?? null,
      approvedBefore.reviewedAt?.getTime() ?? null,
    );
    assert.equal(approvedAfter.intervalId, interval.id);
    assert.equal(
      approvedAfter.createdAt.getTime(),
      approvedBefore.createdAt.getTime(),
    );

    const auditsAfter = await prisma.auditEvent.findMany({
      where: {
        entityType: "attendance_adjustment",
        entityId: adj.id,
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        action: true,
        entityId: true,
        actorEmployeeId: true,
        summary: true,
        after: true,
      },
    });
    assert.deepEqual(
      auditsAfter.map((a) => a.id),
      auditIdsBefore,
      "late ingest must not replace/delete/duplicate adjustment audit history",
    );
    assert.deepEqual(
      auditsAfter.map((a) => ({
        action: a.action,
        entityId: a.entityId,
        actorEmployeeId: a.actorEmployeeId,
        summary: a.summary,
        after: a.after,
      })),
      auditsBefore.map((a) => ({
        action: a.action,
        entityId: a.entityId,
        actorEmployeeId: a.actorEmployeeId,
        summary: a.summary,
        after: a.after,
      })),
    );

    const dupApproved = await prisma.attendanceAdjustment.count({
      where: {
        intervalId: interval.id,
        status: AttendanceAdjustmentStatus.approved,
        reason: approvedBefore.reason,
      },
    });
    assert.equal(dupApproved, 1, "must not duplicate approved adjustment rows");

    const controlAfter = await prisma.attendanceEvent.count({
      where: { employeeId: world.control.employeeId },
    });
    assert.equal(controlAfter, controlBefore);
  });

  it("pending rematch via late ingest remains reviewable", async () => {
    const emp = world.housekeeper.employeeId;
    const { interval, clockInId } = await seedClosedShift(emp, "74a");

    const pending = await requestAdjustment({
      intervalId: interval.id,
      requestedById: emp,
      actorRole: Role.housekeeper,
      reason: "second request",
      proposedBreakMinutes: 15,
    });
    assert.equal(pending.status, AttendanceAdjustmentStatus.pending);

    await ingestEvent({
      externalEventId: `late-out-extra-${stamp}`,
      source: "late-test",
      employeeId: emp,
      kind: AttendanceEventKind.clock_out,
      deviceTime: "2026-03-15T16:05:00.000Z",
      receivedAt: "2026-03-15T16:35:00.000Z",
    });

    const rematched = await prisma.attendanceAdjustment.findFirst({
      where: {
        status: AttendanceAdjustmentStatus.pending,
        reason: "second request",
        interval: { employeeId: emp },
      },
      include: { interval: true },
    });
    assert.ok(rematched, "pending must rematch after late ingest rebuild");
    assert.equal(rematched.requestedById, emp);
    assert.equal(rematched.proposedBreakMinutes, 15);
    assert.equal(
      rematched.interval.status,
      AttendanceIntervalStatus.needs_review,
    );
    assert.equal(rematched.interval.startEventId, clockInId);

    const reviewed = await reviewAdjustment({
      adjustmentId: rematched.id,
      reviewedById: world.manager.employeeId,
      decision: "approved",
    });
    assert.equal(reviewed.status, AttendanceIntervalStatus.adjusted);
    assert.equal(reviewed.breakMinutes, 15);
    assert.equal(reviewed.workedMinutes, 465);
  });
});