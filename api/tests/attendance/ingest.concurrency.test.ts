/**
 * concurrent ingest behind FOR UPDATE barrier on open interval.
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
  // Concurrency/isolation step for the race under test.
  waitForBackendsBlockedByHolderChain,
  // Shape AttendanceWorld documents the fixture/response fields this suite touches.
  type AttendanceWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: attendance ingest concurrency.
describe("attendance ingest concurrency", () => {
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
      value: { ...opsBefore, hotelTimezone: "UTC" },
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "att-75 tz UTC",
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
        reason: "att-75 tz restore",
      });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupAttendanceWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case probes concurrency/isolation: dual ingest waits on locked interval; both succeed; control clean.
  it("dual ingest waits on locked interval; both succeed; control clean", async () => {
    // Bind emp for later setup or assertions in this scope.
    const emp = world.technician.employeeId;
    // Bind hotelDate for later setup or assertions in this scope.
    const hotelDate = new Date("2026-04-01T00:00:00.000Z");
    // Bind startedAt for later setup or assertions in this scope.
    const startedAt = new Date("2026-04-01T08:00:00.000Z");

    // lockIv: seeded entity required before the mutation under test.
    const lockIv = await prisma.attendanceInterval.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: emp,
        // Execute the next setup or assertion step for this scenario.
        hotelDate,
        // Execute the next setup or assertion step for this scenario.
        startedAt,
        // Execute the next setup or assertion step for this scenario.
        endedAt: null,
        // Execute the next setup or assertion step for this scenario.
        breakMinutes: 0,
        // Execute the next setup or assertion step for this scenario.
        workedMinutes: null,
        // Fixture field status for the seeded actor/entity.
        status: AttendanceIntervalStatus.open,
        // Execute the next setup or assertion step for this scenario.
        anomalyFlags: [],
      },
    });

    // controlEventsBefore: synchronize actors so the race window is observable.
    const controlEventsBefore = await prisma.attendanceEvent.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { employeeId: world.control.employeeId },
    });
    // controlIvBefore: synchronize actors so the race window is observable.
    const controlIvBefore = await prisma.attendanceInterval.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { employeeId: world.control.employeeId },
    });

    // Execute the next setup or assertion step for this scenario.
    let release!: () => void;
    // Bind gate for later setup or assertions in this scope.
    const gate = new Promise<void>((r) => {
      // Execute the next setup or assertion step for this scenario.
      release = r;
    });
    // Execute the next setup or assertion step for this scenario.
    let holderPid: number | null = null;
    // Bind lockHeld for later setup or assertions in this scope.
    let lockHeld = false;

    // Bind holder for later setup or assertions in this scope.
    const holder = prisma.$transaction(
      // Execute the next setup or assertion step for this scenario.
      async (tx) => {
        // pidRows: synchronize actors so the race window is observable.
        const pidRows = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::int AS pid
        `;
        // Execute the next setup or assertion step for this scenario.
        holderPid = pidRows[0]!.pid;
        // Await async work before asserting or releasing locks.
        await tx.$executeRaw`
          SELECT id FROM "AttendanceInterval" WHERE id = ${lockIv.id} FOR UPDATE
        `;
        // Concurrency/isolation step for the race under test.
        lockHeld = true;
        // Await async work before asserting or releasing locks.
        await gate;
      },
      // Runner option controlling stability or isolation of the suite.
      { timeout: 60_000, maxWait: 60_000 },
    );

    // Execute the next setup or assertion step for this scenario.
    let p1: Promise<unknown> | undefined;
    // Execute the next setup or assertion step for this scenario.
    let p2: Promise<unknown> | undefined;
    // Try path where partial failure must not leak suite state.
    try {
      // Repeat/poll to widen the race window or wait for lock waiters.
      for (let i = 0; i < 100 && !lockHeld; i += 1) {
        // Brief yield so lock waiters/UI can settle before asserting.
        await new Promise((r) => setTimeout(r, 20));
      }
      // Assert the observed value matches the intended post-condition.
      assert.ok(lockHeld && holderPid != null);

      // Bind tag for later setup or assertions in this scope.
      const tag = world.stamp;
      // Execute the next setup or assertion step for this scenario.
      p1 = ingestEvent({
        // Execute the next setup or assertion step for this scenario.
        externalEventId: `conc-in-${tag}`,
        // Execute the next setup or assertion step for this scenario.
        source: "conc-test",
        // Execute the next setup or assertion step for this scenario.
        employeeId: emp,
        // Concurrency/isolation step for the race under test.
        kind: AttendanceEventKind.clock_in,
        // Execute the next setup or assertion step for this scenario.
        deviceTime: "2026-04-01T08:00:00.000Z",
        // Execute the next setup or assertion step for this scenario.
        receivedAt: "2026-04-01T08:00:01.000Z",
        // Concurrency/isolation step for the race under test.
        clockSkewSeconds: 0,
      });
      // Execute the next setup or assertion step for this scenario.
      p2 = ingestEvent({
        // Execute the next setup or assertion step for this scenario.
        externalEventId: `conc-out-${tag}`,
        // Execute the next setup or assertion step for this scenario.
        source: "conc-test",
        // Execute the next setup or assertion step for this scenario.
        employeeId: emp,
        // Concurrency/isolation step for the race under test.
        kind: AttendanceEventKind.clock_out,
        // Execute the next setup or assertion step for this scenario.
        deviceTime: "2026-04-01T16:00:00.000Z",
        // Execute the next setup or assertion step for this scenario.
        receivedAt: "2026-04-01T16:00:01.000Z",
        // Concurrency/isolation step for the race under test.
        clockSkewSeconds: 0,
      });

      // blocked: synchronize actors so the race window is observable.
      const blocked = await waitForBackendsBlockedByHolderChain(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Execute the next setup or assertion step for this scenario.
        holderPid!,
        1,
        // Execute the next setup or assertion step for this scenario.
        15_000,
      );
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.ok(blocked.length >= 1, `expected >=1 waiter, got ${blocked.length}`);
      // Assert the observed value matches the intended post-condition.
      assert.ok(!blocked.includes(holderPid!), "holder must not be in waiters");

      // Execute the next setup or assertion step for this scenario.
      release();
      // Await async work before asserting or releasing locks.
      await holder;

      // settled: capture concurrent outcomes for race assertions.
      const settled = await Promise.allSettled([p1, p2]);
      // Iterate to cover variants or wait until a condition holds.
      for (const s of settled) {
        // Assert the observed value matches the intended post-condition.
        assert.equal(
          // Execute the next setup or assertion step for this scenario.
          s.status,
          // Execute the next setup or assertion step for this scenario.
          "fulfilled",
          // Execute the next setup or assertion step for this scenario.
          s.status === "rejected" ? String(s.reason) : "",
        );
      }

      // events: synchronize actors so the race window is observable.
      const events = await prisma.attendanceEvent.findMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { employeeId: emp, source: "conc-test" },
        // Execute the next setup or assertion step for this scenario.
        orderBy: { normalizedTime: "asc" },
      });
      // Assert collection size matches the expected post-condition.
      assert.equal(events.length, 2);
      // Assert the observed value matches the intended post-condition.
      assert.equal(events[0]!.kind, AttendanceEventKind.clock_in);
      // Assert the observed value matches the intended post-condition.
      assert.equal(events[1]!.kind, AttendanceEventKind.clock_out);

      // intervals: synchronize actors so the race window is observable.
      const intervals = await prisma.attendanceInterval.findMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { employeeId: emp, hotelDate },
      });
      // Assert collection size matches the expected post-condition.
      assert.equal(intervals.length, 1);
      // Assert HTTP status matches the contract for this path.
      assert.equal(intervals[0]!.status, AttendanceIntervalStatus.closed);
      // Assert the observed value matches the intended post-condition.
      assert.equal(intervals[0]!.workedMinutes, 480);
      // Assert the observed value matches the intended post-condition.
      assert.equal(intervals[0]!.breakMinutes, 0);

      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Await async work before asserting or releasing locks.
        await prisma.attendanceEvent.count({
          // SQL fragment used to observe locks or assert DB state.
          where: { employeeId: world.control.employeeId },
        }),
        // Execute the next setup or assertion step for this scenario.
        controlEventsBefore,
      );
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Await async work before asserting or releasing locks.
        await prisma.attendanceInterval.count({
          // SQL fragment used to observe locks or assert DB state.
          where: { employeeId: world.control.employeeId },
        }),
        // Execute the next setup or assertion step for this scenario.
        controlIvBefore,
      );
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Execute the next setup or assertion step for this scenario.
      release();
      // Await async work before asserting or releasing locks.
      await holder.catch(() => undefined);
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (p1 && p2) await Promise.allSettled([p1, p2]);
    }
  });
});