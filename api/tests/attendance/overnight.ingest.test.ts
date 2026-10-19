/**
 * T-ATT-76a — overnight shift with break crossing midnight (Europe/Sofia).
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
  type AttendanceWorld,
} from "./fixtures";

const prisma = new PrismaClient();

describe("attendance overnight ingest (T-ATT-76)", () => {
  let world: AttendanceWorld;
  let opsBefore: Awaited<ReturnType<typeof getOperations>>;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    world = await createAttendanceWorld(prisma);
    opsBefore = await getOperations();
    await updateSetting({
      key: "operations",
      value: { ...opsBefore, hotelTimezone: "Europe/Sofia" },
      actorEmployeeId: world.owner.employeeId,
      reason: "att-76 tz Sofia",
    });
  });

  after(async () => {
    if (opsBefore) {
      await updateSetting({
        key: "operations",
        value: opsBefore,
        actorEmployeeId: world.owner.employeeId,
        reason: "att-76 tz restore",
      });
    }
    if (world) await cleanupAttendanceWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("T-ATT-76a overnight break across midnight → one interval hotelDate=D break=45", async () => {
    const emp = world.technician.employeeId;
    const tag = world.stamp;
    // D = 2026-10-07 local Sofia (EEST UTC+3)
    // 20:00 → 17:00Z; break 23:30→00:15 = 20:30Z→21:15Z; out 06:00 → 03:00Z
    const inRes = await ingestEvent({
      externalEventId: `ovn-in-${tag}`,
      source: "overnight-test",
      employeeId: emp,
      kind: AttendanceEventKind.clock_in,
      deviceTime: "2026-10-07T17:00:00.000Z",
      receivedAt: "2026-10-07T17:00:01.000Z",
      clockSkewSeconds: 0,
    });
    await ingestEvent({
      externalEventId: `ovn-bs-${tag}`,
      source: "overnight-test",
      employeeId: emp,
      kind: AttendanceEventKind.break_start,
      deviceTime: "2026-10-07T20:30:00.000Z",
      receivedAt: "2026-10-07T20:30:01.000Z",
      clockSkewSeconds: 0,
    });
    await ingestEvent({
      externalEventId: `ovn-be-${tag}`,
      source: "overnight-test",
      employeeId: emp,
      kind: AttendanceEventKind.break_end,
      deviceTime: "2026-10-07T21:15:00.000Z",
      receivedAt: "2026-10-07T21:15:01.000Z",
      clockSkewSeconds: 0,
    });
    const outRes = await ingestEvent({
      externalEventId: `ovn-out-${tag}`,
      source: "overnight-test",
      employeeId: emp,
      kind: AttendanceEventKind.clock_out,
      deviceTime: "2026-10-08T03:00:00.000Z",
      receivedAt: "2026-10-08T03:00:01.000Z",
      clockSkewSeconds: 0,
    });
    assert.ok(inRes.created && outRes.created);

    const dayD = new Date("2026-10-07T00:00:00.000Z");
    const dayD1 = new Date("2026-10-08T00:00:00.000Z");
    const onD = await prisma.attendanceInterval.findMany({
      where: { employeeId: emp, hotelDate: dayD },
    });
    const onD1 = await prisma.attendanceInterval.findMany({
      where: { employeeId: emp, hotelDate: dayD1 },
    });
    assert.equal(onD.length, 1, "exactly one interval on hotelDate D");
    assert.equal(onD1.length, 0, "no interval on D+1");

    const iv = onD[0]!;
    assert.equal(iv.status, AttendanceIntervalStatus.closed);
    assert.equal(iv.startEventId, inRes.event.id);
    assert.equal(iv.endEventId, outRes.event.id);
    assert.equal(iv.breakMinutes, 45);
    const raw = Math.round(
      (iv.endedAt!.getTime() - iv.startedAt.getTime()) / 60_000,
    );
    assert.equal(raw, 600);
    assert.equal(iv.workedMinutes, 555);
    assert.equal(iv.startedAt.toISOString(), "2026-10-07T17:00:00.000Z");
    assert.equal(iv.endedAt!.toISOString(), "2026-10-08T03:00:00.000Z");
  });
});