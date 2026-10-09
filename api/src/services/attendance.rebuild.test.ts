import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  AttendanceAdjustmentStatus,
  AttendanceEventKind,
  AttendanceIntervalStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import {
  rebuildIntervalsForEmployee,
  requestAdjustment,
  reviewAdjustment,
} from "./attendance";
const prisma = new PrismaClient();

describe("rebuildIntervalsForEmployee adjustment history", () => {
  const createdEventIds: string[] = [];
  let employeeId = "";
  let reviewerId = "";
  let hotelDate = new Date("2026-10-08T00:00:00.000Z");

  after(async () => {
    if (employeeId) {
      await prisma.attendanceAdjustment.deleteMany({
        where: { interval: { employeeId } },
      });
      await prisma.attendanceInterval.deleteMany({ where: { employeeId } });
      await prisma.attendanceEvent.deleteMany({
        where: { id: { in: createdEventIds } },
      });
    }
    await prisma.$disconnect();
  });

  it("keeps rejected adjustment history after late-event rebuild", async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: "owner@meridian.local" },
    });
    const tech = await prisma.user.findUniqueOrThrow({
      where: { email: "technician@meridian.local" },
    });
    assert.ok(owner.employeeId);
    assert.ok(tech.employeeId);
    employeeId = tech.employeeId;
    reviewerId = owner.employeeId;

    const stamp = Date.now();
    // Use UTC so hotel-day keys match normalized event times without DST edge cases.
    const tz = "UTC";
    hotelDate = new Date("2026-03-15T00:00:00.000Z");
    const prevHotelDate = new Date("2026-03-14T00:00:00.000Z");

    // Isolate: wipe intervals/adjustments/events for this employee on the test days.
    await prisma.attendanceAdjustment.deleteMany({
      where: {
        interval: {
          employeeId,
          hotelDate: { in: [hotelDate, prevHotelDate] },
        },
      },
    });
    await prisma.attendanceInterval.deleteMany({
      where: { employeeId, hotelDate: { in: [hotelDate, prevHotelDate] } },
    });
    await prisma.attendanceEvent.deleteMany({
      where: {
        employeeId,
        normalizedTime: {
          gte: new Date("2026-03-14T00:00:00.000Z"),
          lt: new Date("2026-03-17T00:00:00.000Z"),
        },
      },
    });

    const clockIn = await prisma.attendanceEvent.create({
      data: {
        employeeId,
        kind: AttendanceEventKind.clock_in,
        source: "rebuild-test",
        externalEventId: `rebuild-in-${stamp}`,
        deviceTime: new Date("2026-03-15T08:00:00.000Z"),
        receivedAt: new Date("2026-03-15T08:00:05.000Z"),
        normalizedTime: new Date("2026-03-15T08:00:00.000Z"),
      },
    });
    createdEventIds.push(clockIn.id);

    const clockOut = await prisma.attendanceEvent.create({
      data: {
        employeeId,
        kind: AttendanceEventKind.clock_out,
        source: "rebuild-test",
        externalEventId: `rebuild-out-${stamp}`,
        deviceTime: new Date("2026-03-15T16:00:00.000Z"),
        receivedAt: new Date("2026-03-15T16:00:05.000Z"),
        normalizedTime: new Date("2026-03-15T16:00:00.000Z"),
      },
    });
    createdEventIds.push(clockOut.id);

    await rebuildIntervalsForEmployee(employeeId, hotelDate, tz);

    const interval = await prisma.attendanceInterval.findFirstOrThrow({
      where: { employeeId, hotelDate, startEventId: clockIn.id },
    });
    assert.equal(interval.status, AttendanceIntervalStatus.closed);
    assert.equal(interval.workedMinutes, 480);

    const adj = await requestAdjustment({
      intervalId: interval.id,
      requestedById: employeeId,
      actorRole: Role.technician,
      reason: "forgot break",
      proposedBreakMinutes: 30,
    });
    await reviewAdjustment({
      adjustmentId: adj.id,
      reviewedById: reviewerId,
      decision: "rejected",
      reason: "no evidence",
    });

    const rejectedBefore = await prisma.attendanceAdjustment.findUniqueOrThrow({
      where: { id: adj.id },
    });
    assert.equal(rejectedBefore.status, AttendanceAdjustmentStatus.rejected);

    // Late attendance event (extra clock marker) triggers rebuild of the day.
    const lateEvent = await prisma.attendanceEvent.create({
      data: {
        employeeId,
        kind: AttendanceEventKind.clock_out,
        source: "rebuild-test",
        externalEventId: `rebuild-late-${stamp}`,
        deviceTime: new Date("2026-03-15T16:05:00.000Z"),
        receivedAt: new Date("2026-03-15T16:35:00.000Z"),
        normalizedTime: new Date("2026-03-15T16:05:00.000Z"),
      },
    });
    createdEventIds.push(lateEvent.id);

    await rebuildIntervalsForEmployee(employeeId, hotelDate, tz);

    const afterIntervals = await prisma.attendanceInterval.findMany({
      where: { employeeId, hotelDate },
      include: { adjustments: true },
    });
    assert.ok(afterIntervals.length >= 1);
    const rematched = afterIntervals.flatMap((iv) => iv.adjustments);
    const kept = rematched.find(
      (a) =>
        a.status === AttendanceAdjustmentStatus.rejected &&
        a.reason.includes("no evidence"),
    );
    assert.ok(kept, "rejected adjustment history must remain after rebuild");
    assert.equal(kept.reviewedById, reviewerId);
    assert.ok(kept.reviewedAt);

    // Pending rematch: create another openable pending on rebuilt interval
    const closed = afterIntervals.find(
      (iv) => iv.startEventId === clockIn.id && iv.status !== AttendanceIntervalStatus.adjusted,
    );
    assert.ok(closed);
    const pending = await requestAdjustment({
      intervalId: closed.id,
      requestedById: employeeId,
      actorRole: Role.technician,
      reason: "second request",
      proposedBreakMinutes: 15,
    });
    await rebuildIntervalsForEmployee(employeeId, hotelDate, tz);
    const pendingAfter = await prisma.attendanceAdjustment.findFirst({
      where: {
        status: AttendanceAdjustmentStatus.pending,
        reason: "second request",
        interval: { employeeId, hotelDate },
      },
      include: { interval: true },
    });
    assert.ok(pendingAfter, "pending remains linked after rebuild");
    assert.equal(
      pendingAfter.interval.status,
      AttendanceIntervalStatus.needs_review,
    );
    assert.notEqual(pendingAfter.id, pending.id); // recreated with preserved fields
    assert.equal(pendingAfter.requestedById, employeeId);

    // Second rebuild must not duplicate rejected history rows for same request
    await rebuildIntervalsForEmployee(employeeId, hotelDate, tz);
    const rejectedCount = await prisma.attendanceAdjustment.count({
      where: {
        status: AttendanceAdjustmentStatus.rejected,
        reason: { contains: "no evidence" },
        interval: { employeeId, hotelDate },
      },
    });
    assert.equal(rejectedCount, 1, "rebuild must not duplicate rejected history");
  });
});
