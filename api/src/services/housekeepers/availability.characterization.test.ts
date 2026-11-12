/**
 * Characterization for buildAvailability (DB semantics + sort/workload).
 * Pure classifyAvailability remains in availability.test.ts.
 * HTTP surface: tests/cleaning/availability.http.test.ts.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import {
  AttendanceEventKind,
  AttendanceIntervalStatus,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../../db";
import { assertTestDatabase } from "../../../tests/assertTestDatabase";
import {
  cleanupCleaningWorld,
  createCleaningWorld,
  makeHousekeepersAvailable,
  resetCleaningWork,
  // Declare type CleaningWorld for callers and internals.
  type CleaningWorld,
} from "../../../tests/cleaning/fixtures";
import { todayHotelDateYmd } from "../hotelTime";
import { buildAvailability } from "./availability";

describe("buildAvailability characterization", () => {
  let world: CleaningWorld;
  // Capture hotel date ymd for use in this scope.
  let hotelDateYmd: string;
  // Capture hotel date key for use in this scope.
  let hotelDateKey: Date;

  before(async () => {
    await assertTestDatabase(prisma);
    world = await createCleaningWorld(prisma);
    // Update hotel date ymd as control flow progresses.
    hotelDateYmd = await todayHotelDateYmd();
    // Update hotel date key as control flow progresses.
    hotelDateKey = new Date(`${hotelDateYmd}T00:00:00.000Z`);
  });

  after(async () => {
    if (world) {
      await resetCleaningWork(prisma, world);
      await cleanupCleaningWorld(prisma, world);
    }
    await prisma.$disconnect();
  });

  it("empty employee list returns [] without querying side effects", async () => {
    const rows = await buildAvailability({
      employees: [],
      db: prisma,
      now: new Date(),
      hotelDateKey,
      nowHhMm: "12:00",
      checkedAt: "2000-01-01T00:00:00.000Z",
    });
    assert.deepEqual(rows, []);
  });

  it("available housekeepers sort by assignedTaskCount then name; load ≠ busy", async () => {
    await resetCleaningWork(prisma, world);
    await makeHousekeepersAvailable(prisma, {
      employeeIds: [world.hk1.employeeId, world.hk2.employeeId],
      shiftId: world.availabilityShiftId,
      hotelDateYmd,
    });

    // Give hk1 two active assignments (one per location/day); hk2 none — both still available.
    for (const locationId of [world.locationAId, world.locationBId]) {
      await prisma.cleaningTask.create({
        data: {
          locationId,
          assignedEmployeeId: world.hk1.employeeId,
          hotelDate: hotelDateKey,
          status: TaskStatus.assigned,
          cleaningCycle: 0,
          serviceType: "departure",
        },
      });
    }

    // Capture checked at for use in this scope.
    const checkedAt = "2026-06-15T10:00:00.000Z";
    const rows = await buildAvailability({
      employees: [
        {
          id: world.hk2.employeeId,
          fullName: "CLN Housekeeper 2",
          employeeNumber: world.hk2.employeeNumber,
        },
        {
          id: world.hk1.employeeId,
          fullName: "CLN Housekeeper 1",
          employeeNumber: world.hk1.employeeNumber,
        },
      ],
      db: prisma,
      now: new Date(),
      hotelDateKey,
      nowHhMm: "12:00", // full-day fixture shift 00:00–00:00
      checkedAt,
    });

    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.availabilityStatus === "available"));
    assert.equal(rows[0]!.employeeId, world.hk2.employeeId); // lower load first
    assert.equal(rows[0]!.assignedTaskCount, 0);
    assert.equal(rows[1]!.employeeId, world.hk1.employeeId);
    assert.equal(rows[1]!.assignedTaskCount, 2);
    assert.ok(rows.every((r) => r.checkedAt === checkedAt));
    assert.ok(rows.every((r) => r.sectorEligibility === "hotel_wide"));
  });

  it("running session → busy and surfaces currentRunningTask; status sort before available", async () => {
    await resetCleaningWork(prisma, world);
    await makeHousekeepersAvailable(prisma, {
      employeeIds: [world.hk1.employeeId, world.hk2.employeeId],
      shiftId: world.availabilityShiftId,
      hotelDateYmd,
    });

    const task = await prisma.cleaningTask.create({
      data: {
        locationId: world.locationAId,
        assignedEmployeeId: world.hk1.employeeId,
        hotelDate: hotelDateKey,
        status: TaskStatus.in_progress,
        cleaningCycle: 0,
        serviceType: "departure",
      },
    });
    await prisma.cleaningSession.create({
      data: {
        taskId: task.id,
        employeeId: world.hk1.employeeId,
        startedAt: new Date(),
        status: SessionStatus.running,
        anomalyFlags: [],
        startCommandId: randomUUID(),
      },
    });

    const rows = await buildAvailability({
      employees: [
        {
          id: world.hk1.employeeId,
          fullName: "CLN Housekeeper 1",
          employeeNumber: world.hk1.employeeNumber,
        },
        {
          id: world.hk2.employeeId,
          fullName: "CLN Housekeeper 2",
          employeeNumber: world.hk2.employeeNumber,
        },
      ],
      db: prisma,
      now: new Date(),
      hotelDateKey,
      nowHhMm: "12:00",
      checkedAt: new Date().toISOString(),
    });

    const busy = rows.find((r) => r.employeeId === world.hk1.employeeId)!;
    const free = rows.find((r) => r.employeeId === world.hk2.employeeId)!;
    assert.equal(busy.availabilityStatus, "busy");
    assert.deepEqual(busy.availabilityReasons, ["running_cleaning_session"]);
    assert.equal(busy.currentRunningTask?.taskId, task.id);
    assert.equal(busy.currentRunningTask?.locationId, world.locationAId);
    assert.equal(free.availabilityStatus, "available");
    // available (0) before busy (3)
    assert.equal(rows[0]!.employeeId, world.hk2.employeeId);
    assert.equal(rows[1]!.employeeId, world.hk1.employeeId);
  });

  it("no roster → off_shift; open break → on_break", async () => {
    await resetCleaningWork(prisma, world);
    // World seed may already roster both HKs — strip hk1 for off_shift.
    await prisma.employeeShiftRoster.deleteMany({
      where: { employeeId: world.hk1.employeeId, hotelDate: hotelDateKey },
    });
    await prisma.attendanceInterval.updateMany({
      where: {
        employeeId: world.hk1.employeeId,
        hotelDate: hotelDateKey,
        status: AttendanceIntervalStatus.open,
        endedAt: null,
      },
      data: {
        status: AttendanceIntervalStatus.closed,
        endedAt: new Date(),
      },
    });
    await makeHousekeepersAvailable(prisma, {
      employeeIds: [world.hk2.employeeId],
      shiftId: world.availabilityShiftId,
      hotelDateYmd,
    });

    const interval = await prisma.attendanceInterval.findFirst({
      where: {
        employeeId: world.hk2.employeeId,
        hotelDate: hotelDateKey,
        status: AttendanceIntervalStatus.open,
      },
      orderBy: { startedAt: "desc" },
    });
    assert.ok(interval);
    const stamp = randomUUID();
    await prisma.attendanceEvent.create({
      data: {
        employeeId: world.hk2.employeeId,
        kind: AttendanceEventKind.break_start,
        source: "availability-char",
        externalEventId: `brk-${stamp}`,
        deviceTime: new Date(interval!.startedAt.getTime() + 60_000),
        normalizedTime: new Date(interval!.startedAt.getTime() + 60_000),
      },
    });

    const rows = await buildAvailability({
      employees: [
        {
          id: world.hk1.employeeId,
          fullName: "CLN Housekeeper 1",
          employeeNumber: world.hk1.employeeNumber,
        },
        {
          id: world.hk2.employeeId,
          fullName: "CLN Housekeeper 2",
          employeeNumber: world.hk2.employeeNumber,
        },
      ],
      db: prisma,
      now: new Date(),
      hotelDateKey,
      nowHhMm: "12:00",
      checkedAt: new Date().toISOString(),
    });

    // Capture no roster for use in this scope.
    const noRoster = rows.find((r) => r.employeeId === world.hk1.employeeId)!;
    // Capture on break for use in this scope.
    const onBreak = rows.find((r) => r.employeeId === world.hk2.employeeId)!;
    assert.equal(noRoster.availabilityStatus, "off_shift");
    assert.deepEqual(noRoster.availabilityReasons, ["no_roster_shift"]);
    assert.equal(noRoster.currentShift, null);
    assert.equal(onBreak.availabilityStatus, "on_break");
    assert.ok(onBreak.availabilityReasons.includes("on_break"));
    // on_break (2) before off_shift (5)
    assert.equal(rows[0]!.employeeId, world.hk2.employeeId);
  });
});
