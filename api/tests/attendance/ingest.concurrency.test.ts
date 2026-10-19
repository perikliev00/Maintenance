/**
 * T-ATT-75a — concurrent ingest behind FOR UPDATE barrier on open interval.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AttendanceEventKind,
  AttendanceIntervalStatus,
  PrismaClient,
} from "@prisma/client";
import { ingestEvent } from "../../src/services/attendance";
import {
  getOperations,
  updateSetting,
} from "../../src/services/settings";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  cleanupAttendanceWorld,
  createAttendanceWorld,
  waitForBackendsBlockedByHolderChain,
  type AttendanceWorld,
} from "./fixtures";

const prisma = new PrismaClient();

describe("attendance ingest concurrency (T-ATT-75)", () => {
  let world: AttendanceWorld;
  let opsBefore: Awaited<ReturnType<typeof getOperations>>;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    world = await createAttendanceWorld(prisma);
    opsBefore = await getOperations();
    await updateSetting({
      key: "operations",
      value: { ...opsBefore, hotelTimezone: "UTC" },
      actorEmployeeId: world.owner.employeeId,
      reason: "att-75 tz UTC",
    });
  });

  after(async () => {
    if (opsBefore) {
      await updateSetting({
        key: "operations",
        value: opsBefore,
        actorEmployeeId: world.owner.employeeId,
        reason: "att-75 tz restore",
      });
    }
    if (world) await cleanupAttendanceWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("T-ATT-75a dual ingest waits on locked interval; both succeed; control clean", async () => {
    const emp = world.technician.employeeId;
    const hotelDate = new Date("2026-04-01T00:00:00.000Z");
    const startedAt = new Date("2026-04-01T08:00:00.000Z");

    const lockIv = await prisma.attendanceInterval.create({
      data: {
        employeeId: emp,
        hotelDate,
        startedAt,
        endedAt: null,
        breakMinutes: 0,
        workedMinutes: null,
        status: AttendanceIntervalStatus.open,
        anomalyFlags: [],
      },
    });

    const controlEventsBefore = await prisma.attendanceEvent.count({
      where: { employeeId: world.control.employeeId },
    });
    const controlIvBefore = await prisma.attendanceInterval.count({
      where: { employeeId: world.control.employeeId },
    });

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let holderPid: number | null = null;
    let lockHeld = false;

    const holder = prisma.$transaction(
      async (tx) => {
        const pidRows = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::int AS pid
        `;
        holderPid = pidRows[0]!.pid;
        await tx.$executeRaw`
          SELECT id FROM "AttendanceInterval" WHERE id = ${lockIv.id} FOR UPDATE
        `;
        lockHeld = true;
        await gate;
      },
      { timeout: 60_000, maxWait: 60_000 },
    );

    let p1: Promise<unknown> | undefined;
    let p2: Promise<unknown> | undefined;
    try {
      for (let i = 0; i < 100 && !lockHeld; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(lockHeld && holderPid != null);

      const tag = world.stamp;
      p1 = ingestEvent({
        externalEventId: `conc-in-${tag}`,
        source: "conc-test",
        employeeId: emp,
        kind: AttendanceEventKind.clock_in,
        deviceTime: "2026-04-01T08:00:00.000Z",
        receivedAt: "2026-04-01T08:00:01.000Z",
        clockSkewSeconds: 0,
      });
      p2 = ingestEvent({
        externalEventId: `conc-out-${tag}`,
        source: "conc-test",
        employeeId: emp,
        kind: AttendanceEventKind.clock_out,
        deviceTime: "2026-04-01T16:00:00.000Z",
        receivedAt: "2026-04-01T16:00:01.000Z",
        clockSkewSeconds: 0,
      });

      const blocked = await waitForBackendsBlockedByHolderChain(
        prisma,
        holderPid!,
        1,
        15_000,
      );
      assert.ok(blocked.length >= 1, `expected >=1 waiter, got ${blocked.length}`);
      assert.ok(!blocked.includes(holderPid!), "holder must not be in waiters");

      release();
      await holder;

      const settled = await Promise.allSettled([p1, p2]);
      for (const s of settled) {
        assert.equal(
          s.status,
          "fulfilled",
          s.status === "rejected" ? String(s.reason) : "",
        );
      }

      const events = await prisma.attendanceEvent.findMany({
        where: { employeeId: emp, source: "conc-test" },
        orderBy: { normalizedTime: "asc" },
      });
      assert.equal(events.length, 2);
      assert.equal(events[0]!.kind, AttendanceEventKind.clock_in);
      assert.equal(events[1]!.kind, AttendanceEventKind.clock_out);

      const intervals = await prisma.attendanceInterval.findMany({
        where: { employeeId: emp, hotelDate },
      });
      assert.equal(intervals.length, 1);
      assert.equal(intervals[0]!.status, AttendanceIntervalStatus.closed);
      assert.equal(intervals[0]!.workedMinutes, 480);
      assert.equal(intervals[0]!.breakMinutes, 0);

      assert.equal(
        await prisma.attendanceEvent.count({
          where: { employeeId: world.control.employeeId },
        }),
        controlEventsBefore,
      );
      assert.equal(
        await prisma.attendanceInterval.count({
          where: { employeeId: world.control.employeeId },
        }),
        controlIvBefore,
      );
    } finally {
      release();
      await holder.catch(() => undefined);
      if (p1 && p2) await Promise.allSettled([p1, p2]);
    }
  });
});