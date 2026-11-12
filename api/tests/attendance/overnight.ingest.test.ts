/**
 * overnight shift with break crossing midnight (Europe/Sofia).
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  AttendanceEventKind,
  // Execute the next setup or assertion step for this scenario.
  AttendanceIntervalStatus,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import bindings from ../../src/services/attendance.
import { ingestEvent } from "../../src/services/attendance";
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

// Suite: attendance overnight ingest.
describe("attendance overnight ingest", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: AttendanceWorld;
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
      reason: "att-76 tz Sofia",
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
        reason: "att-76 tz restore",
      });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupAttendanceWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: overnight break across midnight → one interval hotelDate=D break=45.
  it("overnight break across midnight → one interval hotelDate=D break=45", async () => {
    // Bind emp for later setup or assertions in this scope.
    const emp = world.technician.employeeId;
    // Bind tag for later setup or assertions in this scope.
    const tag = world.stamp;
    // D = 2026-10-07 local Sofia (EEST UTC+3)
    // 20:00 → 17:00Z; break 23:30→00:15 = 20:30Z→21:15Z; out 06:00 → 03:00Z
    const inRes = await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `ovn-in-${tag}`,
      // Execute the next setup or assertion step for this scenario.
      source: "overnight-test",
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Concurrency/isolation step for the race under test.
      kind: AttendanceEventKind.clock_in,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: "2026-10-07T17:00:00.000Z",
      // Execute the next setup or assertion step for this scenario.
      receivedAt: "2026-10-07T17:00:01.000Z",
      // Concurrency/isolation step for the race under test.
      clockSkewSeconds: 0,
    });
    // Await async work before asserting or releasing locks.
    await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `ovn-bs-${tag}`,
      // Execute the next setup or assertion step for this scenario.
      source: "overnight-test",
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Execute the next setup or assertion step for this scenario.
      kind: AttendanceEventKind.break_start,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: "2026-10-07T20:30:00.000Z",
      // Execute the next setup or assertion step for this scenario.
      receivedAt: "2026-10-07T20:30:01.000Z",
      // Concurrency/isolation step for the race under test.
      clockSkewSeconds: 0,
    });
    // Await async work before asserting or releasing locks.
    await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `ovn-be-${tag}`,
      // Execute the next setup or assertion step for this scenario.
      source: "overnight-test",
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Execute the next setup or assertion step for this scenario.
      kind: AttendanceEventKind.break_end,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: "2026-10-07T21:15:00.000Z",
      // Execute the next setup or assertion step for this scenario.
      receivedAt: "2026-10-07T21:15:01.000Z",
      // Concurrency/isolation step for the race under test.
      clockSkewSeconds: 0,
    });
    // outRes: synchronize actors so the race window is observable.
    const outRes = await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `ovn-out-${tag}`,
      // Execute the next setup or assertion step for this scenario.
      source: "overnight-test",
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Concurrency/isolation step for the race under test.
      kind: AttendanceEventKind.clock_out,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: "2026-10-08T03:00:00.000Z",
      // Execute the next setup or assertion step for this scenario.
      receivedAt: "2026-10-08T03:00:01.000Z",
      // Concurrency/isolation step for the race under test.
      clockSkewSeconds: 0,
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(inRes.created && outRes.created);

    // Bind dayD for later setup or assertions in this scope.
    const dayD = new Date("2026-10-07T00:00:00.000Z");
    // Bind dayD1 for later setup or assertions in this scope.
    const dayD1 = new Date("2026-10-08T00:00:00.000Z");
    // onD: synchronize actors so the race window is observable.
    const onD = await prisma.attendanceInterval.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { employeeId: emp, hotelDate: dayD },
    });
    // onD1: synchronize actors so the race window is observable.
    const onD1 = await prisma.attendanceInterval.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { employeeId: emp, hotelDate: dayD1 },
    });
    // Assert collection size matches the expected post-condition.
    assert.equal(onD.length, 1, "exactly one interval on hotelDate D");
    // Assert collection size matches the expected post-condition.
    assert.equal(onD1.length, 0, "no interval on D+1");

    // Bind iv for later setup or assertions in this scope.
    const iv = onD[0]!;
    // Assert HTTP status matches the contract for this path.
    assert.equal(iv.status, AttendanceIntervalStatus.closed);
    // Assert the observed value matches the intended post-condition.
    assert.equal(iv.startEventId, inRes.event.id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(iv.endEventId, outRes.event.id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(iv.breakMinutes, 45);
    // Bind raw for later setup or assertions in this scope.
    const raw = Math.round(
      // Execute the next setup or assertion step for this scenario.
      (iv.endedAt!.getTime() - iv.startedAt.getTime()) / 60_000,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(raw, 600);
    // Assert the observed value matches the intended post-condition.
    assert.equal(iv.workedMinutes, 555);
    // Assert the observed value matches the intended post-condition.
    assert.equal(iv.startedAt.toISOString(), "2026-10-07T17:00:00.000Z");
    // Assert the observed value matches the intended post-condition.
    assert.equal(iv.endedAt!.toISOString(), "2026-10-08T03:00:00.000Z");
  });
});