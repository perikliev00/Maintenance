/**
 * b — DST spring/fall ingest→rebuild; zonedDayStartUtc direct asserts.
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
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  ingestEvent,
  // Execute the next setup or assertion step for this scenario.
  zonedDayStartUtc,
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
// Bind TZ for later setup or assertions in this scope.
const TZ = "Europe/Sofia";

// Suite: attendance DST ingest.
describe("attendance DST ingest", () => {
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
      value: { ...opsBefore, hotelTimezone: TZ },
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "att-77 tz Sofia",
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
        reason: "att-77 tz restore",
      });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupAttendanceWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: zonedDayStartUtc differs from naive UTC midnight on Sofia DST nights.
  it("zonedDayStartUtc differs from naive UTC midnight on Sofia DST nights", () => {
    // Bind spring for later setup or assertions in this scope.
    const spring = zonedDayStartUtc("2026-03-29", TZ);
    // Bind fall for later setup or assertions in this scope.
    const fall = zonedDayStartUtc("2026-10-25", TZ);
    // Bind springDay for later setup or assertions in this scope.
    const springDay = zonedDayStartUtc("2026-03-28", TZ);
    // Bind fallDay for later setup or assertions in this scope.
    const fallDay = zonedDayStartUtc("2026-10-24", TZ);

    // Would fail if zonedDayStartUtc returned naive UTC midnight.
    assert.notEqual(spring.toISOString(), "2026-03-29T00:00:00.000Z");
    // Assert the observed value matches the intended post-condition.
    assert.notEqual(fall.toISOString(), "2026-10-25T00:00:00.000Z");
    assert.equal(spring.toISOString(), "2026-03-28T22:00:00.000Z"); // EET +2
    assert.equal(fall.toISOString(), "2026-10-24T21:00:00.000Z"); // EEST +3 still at local midnight
    // Assert the observed value matches the intended post-condition.
    assert.equal(springDay.toISOString(), "2026-03-27T22:00:00.000Z");
    // Assert the observed value matches the intended post-condition.
    assert.equal(fallDay.toISOString(), "2026-10-23T21:00:00.000Z");
  });

  // Case: spring-forward overnight → hotelDate 2026-03-28 workedMinutes 420.
  it("spring-forward overnight → hotelDate 2026-03-28 workedMinutes 420", async () => {
    // Bind emp for later setup or assertions in this scope.
    const emp = world.technician.employeeId;
    // Bind tag for later setup or assertions in this scope.
    const tag = `spr-${world.stamp}`;
    // Await async work before asserting or releasing locks.
    await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `dst-spr-in-${tag}`,
      // Execute the next setup or assertion step for this scenario.
      source: "dst-test",
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Concurrency/isolation step for the race under test.
      kind: AttendanceEventKind.clock_in,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: "2026-03-28T20:00:00.000Z",
      // Execute the next setup or assertion step for this scenario.
      receivedAt: "2026-03-28T20:00:01.000Z",
      // Concurrency/isolation step for the race under test.
      clockSkewSeconds: 0,
    });
    // Await async work before asserting or releasing locks.
    await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `dst-spr-out-${tag}`,
      // Execute the next setup or assertion step for this scenario.
      source: "dst-test",
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Concurrency/isolation step for the race under test.
      kind: AttendanceEventKind.clock_out,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: "2026-03-29T03:00:00.000Z",
      // Execute the next setup or assertion step for this scenario.
      receivedAt: "2026-03-29T03:00:01.000Z",
      // Concurrency/isolation step for the race under test.
      clockSkewSeconds: 0,
    });

    // iv: synchronize actors so the race window is observable.
    const iv = await prisma.attendanceInterval.findFirstOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: emp,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date("2026-03-28T00:00:00.000Z"),
      },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(iv.status, AttendanceIntervalStatus.closed);
    // Assert the observed value matches the intended post-condition.
    assert.equal(iv.breakMinutes, 0);
    // Assert the observed value matches the intended post-condition.
    assert.equal(iv.workedMinutes, 420);
    // Assert the observed value matches the intended post-condition.
    assert.equal(iv.startedAt.toISOString(), "2026-03-28T20:00:00.000Z");
    // Assert the observed value matches the intended post-condition.
    assert.equal(iv.endedAt!.toISOString(), "2026-03-29T03:00:00.000Z");

    // nextDay: synchronize actors so the race window is observable.
    const nextDay = await prisma.attendanceInterval.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: emp,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date("2026-03-29T00:00:00.000Z"),
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(nextDay, 0);
  });

  // Case: fall-back overnight → hotelDate 2026-10-24 workedMinutes 540.
  it("fall-back overnight → hotelDate 2026-10-24 workedMinutes 540", async () => {
    // Bind emp for later setup or assertions in this scope.
    const emp = world.housekeeper.employeeId;
    // Bind tag for later setup or assertions in this scope.
    const tag = `fall-${world.stamp}`;
    // Await async work before asserting or releasing locks.
    await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `dst-fall-in-${tag}`,
      // Execute the next setup or assertion step for this scenario.
      source: "dst-test",
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Concurrency/isolation step for the race under test.
      kind: AttendanceEventKind.clock_in,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: "2026-10-24T19:00:00.000Z",
      // Execute the next setup or assertion step for this scenario.
      receivedAt: "2026-10-24T19:00:01.000Z",
      // Concurrency/isolation step for the race under test.
      clockSkewSeconds: 0,
    });
    // Await async work before asserting or releasing locks.
    await ingestEvent({
      // Execute the next setup or assertion step for this scenario.
      externalEventId: `dst-fall-out-${tag}`,
      // Execute the next setup or assertion step for this scenario.
      source: "dst-test",
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Concurrency/isolation step for the race under test.
      kind: AttendanceEventKind.clock_out,
      // Execute the next setup or assertion step for this scenario.
      deviceTime: "2026-10-25T04:00:00.000Z",
      // Execute the next setup or assertion step for this scenario.
      receivedAt: "2026-10-25T04:00:01.000Z",
      // Concurrency/isolation step for the race under test.
      clockSkewSeconds: 0,
    });

    // iv: synchronize actors so the race window is observable.
    const iv = await prisma.attendanceInterval.findFirstOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: emp,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date("2026-10-24T00:00:00.000Z"),
      },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(iv.status, AttendanceIntervalStatus.closed);
    // Assert the observed value matches the intended post-condition.
    assert.equal(iv.breakMinutes, 0);
    // Assert the observed value matches the intended post-condition.
    assert.equal(iv.workedMinutes, 540);
    // Assert the observed value matches the intended post-condition.
    assert.equal(iv.startedAt.toISOString(), "2026-10-24T19:00:00.000Z");
    // Assert the observed value matches the intended post-condition.
    assert.equal(iv.endedAt!.toISOString(), "2026-10-25T04:00:00.000Z");

    // nextDay: synchronize actors so the race window is observable.
    const nextDay = await prisma.attendanceInterval.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: emp,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date("2026-10-25T00:00:00.000Z"),
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(nextDay, 0);
  });
});