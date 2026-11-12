/**
 * late-event ingest vs approved freeze and pending rematch.
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
  requestAdjustment,
  // Execute the next setup or assertion step for this scenario.
  reviewAdjustment,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/attendance";
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

// Suite: attendance late-events ingest.
describe("attendance late-events ingest", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: AttendanceWorld;
  // Execute the next setup or assertion step for this scenario.
  let opsBefore: Awaited<ReturnType<typeof getOperations>>;
  // stamp: unique stamp so parallel runs do not collide.
  let stamp = "";

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createAttendanceWorld(prisma);
    // Execute the next setup or assertion step for this scenario.
    stamp = world.stamp;
    // Await async work before asserting or releasing locks.
    opsBefore = await getOperations();
    // Await async work before asserting or releasing locks.
    await updateSetting({
      // Execute the next setup or assertion step for this scenario.
      key: "operations",
      // Execute the next setup or assertion step for this scenario.
      value: { ...opsBefore, hotelTimezone: "UTC" },
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "att-73 tz UTC",
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
        reason: "att-73 tz restore",
      });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupAttendanceWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Helper seedClosedShift: arrange fixture data for the case.
  async function seedClosedShift(employeeId: string, tag: string) {
    // inRes: synchronize actors so the race window is observable.
    const inRes = await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `late-in-${tag}-${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      source: "late-test",
      // Execute the next setup or assertion step for this scenario.
      employeeId,
      // Concurrency/isolation step for the race under test.
      kind: AttendanceEventKind.clock_in,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: "2026-03-15T08:00:00.000Z",
      // Execute the next setup or assertion step for this scenario.
      receivedAt: "2026-03-15T08:00:05.000Z",
    });
    // outRes: synchronize actors so the race window is observable.
    const outRes = await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `late-out-${tag}-${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      source: "late-test",
      // Execute the next setup or assertion step for this scenario.
      employeeId,
      // Concurrency/isolation step for the race under test.
      kind: AttendanceEventKind.clock_out,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: "2026-03-15T16:00:00.000Z",
      // Execute the next setup or assertion step for this scenario.
      receivedAt: "2026-03-15T16:00:05.000Z",
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
    // Return the arranged value/result to the caller.
    return { interval, clockInId: inRes.event.id };
  }

  // Case: approved freeze survives late ingest inside window.
  it("approved freeze survives late ingest inside window", async () => {
    // Bind emp for later setup or assertions in this scope.
    const emp = world.technician.employeeId;
    // controlBefore: synchronize actors so the race window is observable.
    const controlBefore = await prisma.attendanceEvent.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { employeeId: world.control.employeeId },
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    const { interval } = await seedClosedShift(emp, "73a");

    // adj: HTTP response captured for status/body checks.
    const adj = await requestAdjustment({
      // Execute the next setup or assertion step for this scenario.
      intervalId: interval.id,
      // Execute the next setup or assertion step for this scenario.
      requestedById: emp,
      // Execute the next setup or assertion step for this scenario.
      actorRole: Role.technician,
      // Execute the next setup or assertion step for this scenario.
      reason: "add break",
      // Execute the next setup or assertion step for this scenario.
      proposedBreakMinutes: 30,
    });
    // Await async work before asserting or releasing locks.
    await reviewAdjustment({
      // Execute the next setup or assertion step for this scenario.
      adjustmentId: adj.id,
      // Execute the next setup or assertion step for this scenario.
      reviewedById: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      decision: "approved",
    });

    // frozen: synchronize actors so the race window is observable.
    const frozen = await prisma.attendanceInterval.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: interval.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(frozen.status, AttendanceIntervalStatus.adjusted);
    // Assert the observed value matches the intended post-condition.
    assert.equal(frozen.breakMinutes, 30);
    // Assert the observed value matches the intended post-condition.
    assert.equal(frozen.workedMinutes, 450);

    // approvedBefore: in-process HTTP server handle for this suite.
    const approvedBefore = await prisma.attendanceAdjustment.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: adj.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(approvedBefore.status, AttendanceAdjustmentStatus.approved);
    // Assert collection size matches the expected post-condition.
    assert.ok(approvedBefore.reason.trim().length > 0);
    // Assert the observed value matches the intended post-condition.
    assert.equal(approvedBefore.proposedBreakMinutes, 30);
    // Assert the observed value matches the intended post-condition.
    assert.equal(approvedBefore.reviewedById, world.manager.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.ok(approvedBefore.reviewedAt);

    // auditsBefore: synchronize actors so the race window is observable.
    const auditsBefore = await prisma.auditEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        entityType: "attendance_adjustment",
        // Execute the next setup or assertion step for this scenario.
        entityId: adj.id,
      },
      // Execute the next setup or assertion step for this scenario.
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      // SQL fragment used to observe locks or assert DB state.
      select: {
        // Execute the next setup or assertion step for this scenario.
        id: true,
        // Execute the next setup or assertion step for this scenario.
        action: true,
        // Execute the next setup or assertion step for this scenario.
        entityId: true,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: true,
        // Execute the next setup or assertion step for this scenario.
        summary: true,
        // Execute the next setup or assertion step for this scenario.
        after: true,
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      auditsBefore.length >= 1,
      // Execute the next setup or assertion step for this scenario.
      "approved adjustment must have non-empty audit history before late ingest",
    );
    // Bind auditIdsBefore for later setup or assertions in this scope.
    const auditIdsBefore = auditsBefore.map((a) => a.id);

    // Await async work before asserting or releasing locks.
    await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `late-break-${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      source: "late-test",
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Execute the next setup or assertion step for this scenario.
      kind: AttendanceEventKind.break_start,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: "2026-03-15T12:00:00.000Z",
      // Execute the next setup or assertion step for this scenario.
      receivedAt: "2026-03-15T12:40:00.000Z",
      // Concurrency/isolation step for the race under test.
      clockSkewSeconds: 2400,
    });
    // Await async work before asserting or releasing locks.
    await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `late-break-end-${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      source: "late-test",
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Execute the next setup or assertion step for this scenario.
      kind: AttendanceEventKind.break_end,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: "2026-03-15T12:30:00.000Z",
      // Execute the next setup or assertion step for this scenario.
      receivedAt: "2026-03-15T13:10:00.000Z",
    });

    // after: synchronize actors so the race window is observable.
    const after = await prisma.attendanceInterval.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: interval.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(after.status, AttendanceIntervalStatus.adjusted);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.startedAt.getTime(), frozen.startedAt.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.endedAt?.getTime(), frozen.endedAt?.getTime());
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.breakMinutes, 30);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.workedMinutes, 450);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.hotelDate.getTime(), frozen.hotelDate.getTime());

    // approvedAfter: in-process HTTP server handle for this suite.
    const approvedAfter = await prisma.attendanceAdjustment.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: adj.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(approvedAfter.id, approvedBefore.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal(approvedAfter.status, AttendanceAdjustmentStatus.approved);
    // Assert the observed value matches the intended post-condition.
    assert.equal(approvedAfter.reason, approvedBefore.reason);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      approvedAfter.proposedBreakMinutes,
      // Execute the next setup or assertion step for this scenario.
      approvedBefore.proposedBreakMinutes,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      approvedAfter.proposedStartedAt?.getTime() ?? null,
      // Execute the next setup or assertion step for this scenario.
      approvedBefore.proposedStartedAt?.getTime() ?? null,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      approvedAfter.proposedEndedAt?.getTime() ?? null,
      // Execute the next setup or assertion step for this scenario.
      approvedBefore.proposedEndedAt?.getTime() ?? null,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(approvedAfter.requestedById, approvedBefore.requestedById);
    // Assert the observed value matches the intended post-condition.
    assert.equal(approvedAfter.reviewedById, approvedBefore.reviewedById);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      approvedAfter.reviewedAt?.getTime() ?? null,
      // Execute the next setup or assertion step for this scenario.
      approvedBefore.reviewedAt?.getTime() ?? null,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(approvedAfter.intervalId, interval.id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      approvedAfter.createdAt.getTime(),
      // Execute the next setup or assertion step for this scenario.
      approvedBefore.createdAt.getTime(),
    );

    // auditsAfter: synchronize actors so the race window is observable.
    const auditsAfter = await prisma.auditEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        entityType: "attendance_adjustment",
        // Execute the next setup or assertion step for this scenario.
        entityId: adj.id,
      },
      // Execute the next setup or assertion step for this scenario.
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      // SQL fragment used to observe locks or assert DB state.
      select: {
        // Execute the next setup or assertion step for this scenario.
        id: true,
        // Execute the next setup or assertion step for this scenario.
        action: true,
        // Execute the next setup or assertion step for this scenario.
        entityId: true,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: true,
        // Execute the next setup or assertion step for this scenario.
        summary: true,
        // Execute the next setup or assertion step for this scenario.
        after: true,
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      auditsAfter.map((a) => a.id),
      // Execute the next setup or assertion step for this scenario.
      auditIdsBefore,
      // Execute the next setup or assertion step for this scenario.
      "late ingest must not replace/delete/duplicate adjustment audit history",
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      auditsAfter.map((a) => ({
        // Execute the next setup or assertion step for this scenario.
        action: a.action,
        // Execute the next setup or assertion step for this scenario.
        entityId: a.entityId,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: a.actorEmployeeId,
        // Execute the next setup or assertion step for this scenario.
        summary: a.summary,
        // Execute the next setup or assertion step for this scenario.
        after: a.after,
      })),
      // Execute the next setup or assertion step for this scenario.
      auditsBefore.map((a) => ({
        // Execute the next setup or assertion step for this scenario.
        action: a.action,
        // Execute the next setup or assertion step for this scenario.
        entityId: a.entityId,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: a.actorEmployeeId,
        // Execute the next setup or assertion step for this scenario.
        summary: a.summary,
        // Execute the next setup or assertion step for this scenario.
        after: a.after,
      })),
    );

    // dupApproved: in-process HTTP server handle for this suite.
    const dupApproved = await prisma.attendanceAdjustment.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        intervalId: interval.id,
        // Fixture field status for the seeded actor/entity.
        status: AttendanceAdjustmentStatus.approved,
        // Execute the next setup or assertion step for this scenario.
        reason: approvedBefore.reason,
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(dupApproved, 1, "must not duplicate approved adjustment rows");

    // controlAfter: synchronize actors so the race window is observable.
    const controlAfter = await prisma.attendanceEvent.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { employeeId: world.control.employeeId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(controlAfter, controlBefore);
  });

  // Case: pending rematch via late ingest remains reviewable.
  it("pending rematch via late ingest remains reviewable", async () => {
    // Bind emp for later setup or assertions in this scope.
    const emp = world.housekeeper.employeeId;
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    const { interval, clockInId } = await seedClosedShift(emp, "74a");

    // pending: HTTP response captured for status/body checks.
    const pending = await requestAdjustment({
      // Execute the next setup or assertion step for this scenario.
      intervalId: interval.id,
      // Execute the next setup or assertion step for this scenario.
      requestedById: emp,
      // Execute the next setup or assertion step for this scenario.
      actorRole: Role.housekeeper,
      // Execute the next setup or assertion step for this scenario.
      reason: "second request",
      // Execute the next setup or assertion step for this scenario.
      proposedBreakMinutes: 15,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(pending.status, AttendanceAdjustmentStatus.pending);

    // Await async work before asserting or releasing locks.
    await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `late-out-extra-${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      source: "late-test",
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Concurrency/isolation step for the race under test.
      kind: AttendanceEventKind.clock_out,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: "2026-03-15T16:05:00.000Z",
      // Execute the next setup or assertion step for this scenario.
      receivedAt: "2026-03-15T16:35:00.000Z",
    });

    // rematched: synchronize actors so the race window is observable.
    const rematched = await prisma.attendanceAdjustment.findFirst({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Fixture field status for the seeded actor/entity.
        status: AttendanceAdjustmentStatus.pending,
        // Execute the next setup or assertion step for this scenario.
        reason: "second request",
        // Execute the next setup or assertion step for this scenario.
        interval: { employeeId: emp },
      },
      // Execute the next setup or assertion step for this scenario.
      include: { interval: true },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(rematched, "pending must rematch after late ingest rebuild");
    // Assert the observed value matches the intended post-condition.
    assert.equal(rematched.requestedById, emp);
    // Assert the observed value matches the intended post-condition.
    assert.equal(rematched.proposedBreakMinutes, 15);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      rematched.interval.status,
      // Execute the next setup or assertion step for this scenario.
      AttendanceIntervalStatus.needs_review,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(rematched.interval.startEventId, clockInId);

    // reviewed: synchronize actors so the race window is observable.
    const reviewed = await reviewAdjustment({
      // Execute the next setup or assertion step for this scenario.
      adjustmentId: rematched.id,
      // Execute the next setup or assertion step for this scenario.
      reviewedById: world.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      decision: "approved",
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(reviewed.status, AttendanceIntervalStatus.adjusted);
    // Assert the observed value matches the intended post-condition.
    assert.equal(reviewed.breakMinutes, 15);
    // Assert the observed value matches the intended post-condition.
    assert.equal(reviewed.workedMinutes, 465);
  });
});