/**
 * T-ATT-77a/b — DST spring/fall ingest→rebuild; zonedDayStartUtc direct asserts.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AttendanceEventKind,
  AttendanceIntervalStatus,
  PrismaClient,
} from "@prisma/client";
import {
  ingestEvent,
  zonedDayStartUtc,
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
const TZ = "Europe/Sofia";

describe("attendance DST ingest (T-ATT-77)", () => {
  let world: AttendanceWorld;
  let opsBefore: Awaited<ReturnType<typeof getOperations>>;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    world = await createAttendanceWorld(prisma);
    opsBefore = await getOperations();
    await updateSetting({
      key: "operations",
      value: { ...opsBefore, hotelTimezone: TZ },
      actorEmployeeId: world.owner.employeeId,
      reason: "att-77 tz Sofia",
    });
  });

  after(async () => {
    if (opsBefore) {
      await updateSetting({
        key: "operations",
        value: opsBefore,
        actorEmployeeId: world.owner.employeeId,
        reason: "att-77 tz restore",
      });
    }
    if (world) await cleanupAttendanceWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("T-ATT-77z zonedDayStartUtc differs from naive UTC midnight on Sofia DST nights", () => {
    const spring = zonedDayStartUtc("2026-03-29", TZ);
    const fall = zonedDayStartUtc("2026-10-25", TZ);
    const springDay = zonedDayStartUtc("2026-03-28", TZ);
    const fallDay = zonedDayStartUtc("2026-10-24", TZ);

    // Would fail if zonedDayStartUtc returned naive UTC midnight.
    assert.notEqual(spring.toISOString(), "2026-03-29T00:00:00.000Z");
    assert.notEqual(fall.toISOString(), "2026-10-25T00:00:00.000Z");
    assert.equal(spring.toISOString(), "2026-03-28T22:00:00.000Z"); // EET +2
    assert.equal(fall.toISOString(), "2026-10-24T21:00:00.000Z"); // EEST +3 still at local midnight
    assert.equal(springDay.toISOString(), "2026-03-27T22:00:00.000Z");
    assert.equal(fallDay.toISOString(), "2026-10-23T21:00:00.000Z");
  });

  it("T-ATT-77a spring-forward overnight → hotelDate 2026-03-28 workedMinutes 420", async () => {
    const emp = world.technician.employeeId;
    const tag = `spr-${world.stamp}`;
    await ingestEvent({
      externalEventId: `dst-spr-in-${tag}`,
      source: "dst-test",
      employeeId: emp,
      kind: AttendanceEventKind.clock_in,
      deviceTime: "2026-03-28T20:00:00.000Z",
      receivedAt: "2026-03-28T20:00:01.000Z",
      clockSkewSeconds: 0,
    });
    await ingestEvent({
      externalEventId: `dst-spr-out-${tag}`,
      source: "dst-test",
      employeeId: emp,
      kind: AttendanceEventKind.clock_out,
      deviceTime: "2026-03-29T03:00:00.000Z",
      receivedAt: "2026-03-29T03:00:01.000Z",
      clockSkewSeconds: 0,
    });

    const iv = await prisma.attendanceInterval.findFirstOrThrow({
      where: {
        employeeId: emp,
        hotelDate: new Date("2026-03-28T00:00:00.000Z"),
      },
    });
    assert.equal(iv.status, AttendanceIntervalStatus.closed);
    assert.equal(iv.breakMinutes, 0);
    assert.equal(iv.workedMinutes, 420);
    assert.equal(iv.startedAt.toISOString(), "2026-03-28T20:00:00.000Z");
    assert.equal(iv.endedAt!.toISOString(), "2026-03-29T03:00:00.000Z");

    const nextDay = await prisma.attendanceInterval.count({
      where: {
        employeeId: emp,
        hotelDate: new Date("2026-03-29T00:00:00.000Z"),
      },
    });
    assert.equal(nextDay, 0);
  });

  it("T-ATT-77b fall-back overnight → hotelDate 2026-10-24 workedMinutes 540", async () => {
    const emp = world.housekeeper.employeeId;
    const tag = `fall-${world.stamp}`;
    await ingestEvent({
      externalEventId: `dst-fall-in-${tag}`,
      source: "dst-test",
      employeeId: emp,
      kind: AttendanceEventKind.clock_in,
      deviceTime: "2026-10-24T19:00:00.000Z",
      receivedAt: "2026-10-24T19:00:01.000Z",
      clockSkewSeconds: 0,
    });
    await ingestEvent({
      externalEventId: `dst-fall-out-${tag}`,
      source: "dst-test",
      employeeId: emp,
      kind: AttendanceEventKind.clock_out,
      deviceTime: "2026-10-25T04:00:00.000Z",
      receivedAt: "2026-10-25T04:00:01.000Z",
      clockSkewSeconds: 0,
    });

    const iv = await prisma.attendanceInterval.findFirstOrThrow({
      where: {
        employeeId: emp,
        hotelDate: new Date("2026-10-24T00:00:00.000Z"),
      },
    });
    assert.equal(iv.status, AttendanceIntervalStatus.closed);
    assert.equal(iv.breakMinutes, 0);
    assert.equal(iv.workedMinutes, 540);
    assert.equal(iv.startedAt.toISOString(), "2026-10-24T19:00:00.000Z");
    assert.equal(iv.endedAt!.toISOString(), "2026-10-25T04:00:00.000Z");

    const nextDay = await prisma.attendanceInterval.count({
      where: {
        employeeId: emp,
        hotelDate: new Date("2026-10-25T00:00:00.000Z"),
      },
    });
    assert.equal(nextDay, 0);
  });
});