// Strict assert helpers for precise test failures.
import assert from "node:assert/strict";
// Node test runner (describe/it/hooks).
import { after, describe, it } from "node:test";
// Module import required below.
import {
  AttendanceAdjustmentStatus,
  AttendanceEventKind,
  AttendanceIntervalStatus,
  PrismaClient,
  Role,
// Support the surrounding control flow.
} from "@prisma/client";
// Module import required below.
import {
  rebuildIntervalsForEmployee,
  requestAdjustment,
  reviewAdjustment,
// Support the surrounding control flow.
} from "./index";
// Module import required below.
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  ensureUnrelatedControlFixture,
  UNRELATED_CONTROL_EMAIL,
// Support the surrounding control flow.
} from "../../../tests/fixtures";

// Local prisma used below.
const prisma = new PrismaClient();

// Test suite: rebuildIntervalsForEmployee adjustment history.
describe("rebuildIntervalsForEmployee adjustment history", () => {
  // Accumulator list createdEventIds.
  const createdEventIds: string[] = [];
  // Accumulator list fixtureEmployeeIds.
  const fixtureEmployeeIds: string[] = [];
  // Local employeeId used below.
  let employeeId = "";
  // Local reviewerId used below.
  let reviewerId = "";
  // Date hotelDate for window math.
  let hotelDate = new Date("2026-10-08T00:00:00.000Z");

  // Tear down after cases.
  after(async () => {
    // Await side effect before continuing.
    await cleanupEmployeeGraph(prisma, fixtureEmployeeIds);
    // Prisma side effect for this step.
    await prisma.$disconnect();
  });

  // Test case: keeps rejected adjustment history after late-event rebuild.
  it("keeps rejected adjustment history after late-event rebuild", async () => {
    // Await control before dependent work.
    const control = await ensureUnrelatedControlFixture(prisma);
    // Local stamp used below.
    const stamp = Date.now();
    // Await subject before dependent work.
    const subject = await createEmployeeWithUser(prisma, {
      // Set employeeNumber.
      employeeNumber: `T03-ATT-S-${stamp}`,
      // Set email.
      email: `t03-att-subject-${stamp}@test.local`,
      // Set role.
      role: Role.technician,
      // Set fullName.
      fullName: "T03 Attendance Subject",
    });
    // Await reviewer before dependent work.
    const reviewer = await createEmployeeWithUser(prisma, {
      // Set employeeNumber.
      employeeNumber: `T03-ATT-R-${stamp}`,
      // Set email.
      email: `t03-att-reviewer-${stamp}@test.local`,
      // Set role.
      role: Role.owner,
      // Set fullName.
      fullName: "T03 Attendance Reviewer",
    });
    // Support the surrounding control flow.
    fixtureEmployeeIds.push(subject.employeeId, reviewer.employeeId);
    // Assign employeeId.
    employeeId = subject.employeeId;
    // Assign reviewerId.
    reviewerId = reviewer.employeeId;

    // Use UTC so hotel-day keys match normalized event times without DST edge cases.
    const tz = "UTC";
    // Assign hotelDate.
    hotelDate = new Date("2026-03-15T00:00:00.000Z");
    // Date prevHotelDate for window math.
    const prevHotelDate = new Date("2026-03-14T00:00:00.000Z");

    // Isolate: wipe only this fixture employee's intervals/adjustments/events on test days.
    await prisma.attendanceAdjustment.deleteMany({
      // Filter matching rows.
      where: {
        // Field interval on this type/payload.
        interval: {
          employeeId,
          // Time field hotelDate.
          hotelDate: { in: [hotelDate, prevHotelDate] },
        },
      },
    });
    // Delete obsolete row(s).
    await prisma.attendanceInterval.deleteMany({
      // Filter matching rows.
      where: { employeeId, hotelDate: { in: [hotelDate, prevHotelDate] } },
    });
    // Delete obsolete row(s).
    await prisma.attendanceEvent.deleteMany({
      // Filter matching rows.
      where: {
        employeeId,
        // Field normalizedTime on this type/payload.
        normalizedTime: {
          // Time field gte.
          gte: new Date("2026-03-14T00:00:00.000Z"),
          // Time field lt.
          lt: new Date("2026-03-17T00:00:00.000Z"),
        },
      },
    });

    // Create row and keep as clockIn.
    const clockIn = await prisma.attendanceEvent.create({
      // Mutation data payload.
      data: {
        employeeId,
        // Field kind on this type/payload.
        kind: AttendanceEventKind.clock_in,
        // Field source on this type/payload.
        source: "rebuild-test",
        // Field externalEventId on this type/payload.
        externalEventId: `rebuild-in-${stamp}`,
        // Time field deviceTime.
        deviceTime: new Date("2026-03-15T08:00:00.000Z"),
        // Time field receivedAt.
        receivedAt: new Date("2026-03-15T08:00:05.000Z"),
        // Time field normalizedTime.
        normalizedTime: new Date("2026-03-15T08:00:00.000Z"),
      },
    });
    // Support the surrounding control flow.
    createdEventIds.push(clockIn.id);

    // Create row and keep as clockOut.
    const clockOut = await prisma.attendanceEvent.create({
      // Mutation data payload.
      data: {
        employeeId,
        // Field kind on this type/payload.
        kind: AttendanceEventKind.clock_out,
        // Field source on this type/payload.
        source: "rebuild-test",
        // Field externalEventId on this type/payload.
        externalEventId: `rebuild-out-${stamp}`,
        // Time field deviceTime.
        deviceTime: new Date("2026-03-15T16:00:00.000Z"),
        // Time field receivedAt.
        receivedAt: new Date("2026-03-15T16:00:05.000Z"),
        // Time field normalizedTime.
        normalizedTime: new Date("2026-03-15T16:00:00.000Z"),
      },
    });
    // Support the surrounding control flow.
    createdEventIds.push(clockOut.id);

    // Await side effect before continuing.
    await rebuildIntervalsForEmployee(employeeId, hotelDate, tz);

    // Fetch interval by unique/first match.
    const interval = await prisma.attendanceInterval.findFirstOrThrow({
      // Filter matching rows.
      where: { employeeId, hotelDate, startEventId: clockIn.id },
    });
    // Compare scalar values.
    assert.equal(interval.status, AttendanceIntervalStatus.closed);
    // Compare scalar values.
    assert.equal(interval.workedMinutes, 480);

    // Await adj before dependent work.
    const adj = await requestAdjustment({
      // Set intervalId.
      intervalId: interval.id,
      // Set requestedById.
      requestedById: employeeId,
      // Set actorRole.
      actorRole: Role.technician,
      // Set reason.
      reason: "forgot break",
      // Set proposedBreakMinutes.
      proposedBreakMinutes: 30,
    });
    // Await side effect before continuing.
    await reviewAdjustment({
      // Set adjustmentId.
      adjustmentId: adj.id,
      // Set reviewedById.
      reviewedById: reviewerId,
      // Set decision.
      decision: "rejected",
      // Set reason.
      reason: "no evidence",
    });

    // Fetch rejectedBefore by unique/first match.
    const rejectedBefore = await prisma.attendanceAdjustment.findUniqueOrThrow({
      // Filter matching rows.
      where: { id: adj.id },
    });
    // Compare scalar values.
    assert.equal(rejectedBefore.status, AttendanceAdjustmentStatus.rejected);

    // Late attendance event (extra clock marker) triggers rebuild of the day.
    const lateEvent = await prisma.attendanceEvent.create({
      // Mutation data payload.
      data: {
        employeeId,
        // Field kind on this type/payload.
        kind: AttendanceEventKind.clock_out,
        // Field source on this type/payload.
        source: "rebuild-test",
        // Field externalEventId on this type/payload.
        externalEventId: `rebuild-late-${stamp}`,
        // Time field deviceTime.
        deviceTime: new Date("2026-03-15T16:05:00.000Z"),
        // Time field receivedAt.
        receivedAt: new Date("2026-03-15T16:35:00.000Z"),
        // Time field normalizedTime.
        normalizedTime: new Date("2026-03-15T16:05:00.000Z"),
      },
    });
    // Support the surrounding control flow.
    createdEventIds.push(lateEvent.id);

    // Await side effect before continuing.
    await rebuildIntervalsForEmployee(employeeId, hotelDate, tz);

    // Load afterIntervals rows for this window/scope.
    const afterIntervals = await prisma.attendanceInterval.findMany({
      // Filter matching rows.
      where: { employeeId, hotelDate },
      // Include relations for labels/checks.
      include: { adjustments: true },
    });
    // Require truthy condition.
    assert.ok(afterIntervals.length >= 1);
    // Local rematched used below.
    const rematched = afterIntervals.flatMap((iv) => iv.adjustments);
    // Local kept used below.
    const kept = rematched.find(
      // Support the surrounding control flow.
      (a) =>
        // Additional clause in this boolean decision.
        a.status === AttendanceAdjustmentStatus.rejected &&
        // Support the surrounding control flow.
        a.reason.includes("no evidence"),
    );
    // Require truthy condition.
    assert.ok(kept, "rejected adjustment history must remain after rebuild");
    // Compare scalar values.
    assert.equal(kept.reviewedById, reviewerId);
    // Require truthy condition.
    assert.ok(kept.reviewedAt);

    // Pending rematch: create another openable pending on rebuilt interval
    const closed = afterIntervals.find(
      // Support the surrounding control flow.
      (iv) =>
        // Additional clause in this boolean decision.
        iv.startEventId === clockIn.id &&
        // Support the surrounding control flow.
        iv.status !== AttendanceIntervalStatus.adjusted,
    );
    // Require truthy condition.
    assert.ok(closed);
    // Await pending before dependent work.
    const pending = await requestAdjustment({
      // Set intervalId.
      intervalId: closed.id,
      // Set requestedById.
      requestedById: employeeId,
      // Set actorRole.
      actorRole: Role.technician,
      // Set reason.
      reason: "second request",
      // Set proposedBreakMinutes.
      proposedBreakMinutes: 15,
    });
    // Await side effect before continuing.
    await rebuildIntervalsForEmployee(employeeId, hotelDate, tz);
    // Fetch pendingAfter by unique/first match.
    const pendingAfter = await prisma.attendanceAdjustment.findFirst({
      // Filter matching rows.
      where: {
        // Field status on this type/payload.
        status: AttendanceAdjustmentStatus.pending,
        // Field reason on this type/payload.
        reason: "second request",
        // Time field interval.
        interval: { employeeId, hotelDate },
      },
      // Include relations for labels/checks.
      include: { interval: true },
    });
    // Require truthy condition.
    assert.ok(pendingAfter, "pending remains linked after rebuild");
    // Compare scalar values.
    assert.equal(
      // Support the surrounding control flow.
      pendingAfter.interval.status,
      // Support the surrounding control flow.
      AttendanceIntervalStatus.needs_review,
    );
    assert.notEqual(pendingAfter.id, pending.id); // recreated with preserved fields
    // Compare scalar values.
    assert.equal(pendingAfter.requestedById, employeeId);

    // Second rebuild must not duplicate rejected history rows for same request
    await rebuildIntervalsForEmployee(employeeId, hotelDate, tz);
    // Count rows into rejectedCount.
    const rejectedCount = await prisma.attendanceAdjustment.count({
      // Filter matching rows.
      where: {
        // Field status on this type/payload.
        status: AttendanceAdjustmentStatus.rejected,
        // Field reason on this type/payload.
        reason: { contains: "no evidence" },
        // Time field interval.
        interval: { employeeId, hotelDate },
      },
    });
    // Compare scalar values.
    assert.equal(rejectedCount, 1, "rebuild must not duplicate rejected history");

    // Fetch controlStill by unique/first match.
    const controlStill = await prisma.user.findUnique({
      // Filter matching rows.
      where: { email: UNRELATED_CONTROL_EMAIL },
    });
    // Require truthy condition.
    assert.ok(controlStill, "unrelated control fixture must remain");
    // Compare scalar values.
    assert.equal(controlStill.employeeId, control.employeeId);
  });
});
