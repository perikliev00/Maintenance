/**
 * Characterization for buildAvailability (DB semantics + sort/workload).
 * Pure classifyAvailability remains in availability.test.ts.
 * HTTP surface: tests/cleaning/availability.http.test.ts.
 */
import assert from "node:assert/strict";
// Import module node:crypto for this service.
import { randomUUID } from "node:crypto";
// Import module node:test for this service.
import { after, before, describe, it } from "node:test";
// Import module dependency for this service.
import {
  // Run next step: AttendanceEventKind,
  AttendanceEventKind,
  // Run next step: AttendanceIntervalStatus,
  AttendanceIntervalStatus,
  // Run next step: SessionStatus,
  SessionStatus,
  // Run next step: TaskStatus,
  TaskStatus,
// Run next step: } from "@prisma/client";
} from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../../tests/assertTestDatabase for this service.
import { assertTestDatabase } from "../../../tests/assertTestDatabase";
// Import module dependency for this service.
import {
  // Run next step: cleanupCleaningWorld,
  cleanupCleaningWorld,
  // Run next step: createCleaningWorld,
  createCleaningWorld,
  // Run next step: makeHousekeepersAvailable,
  makeHousekeepersAvailable,
  // Run next step: resetCleaningWork,
  resetCleaningWork,
  // Declare type CleaningWorld for callers and internals.
  type CleaningWorld,
// Run next step: } from "../../../tests/cleaning/fixtures";
} from "../../../tests/cleaning/fixtures";
// Import module ../hotelTime for this service.
import { todayHotelDateYmd } from "../hotelTime";
// Import module ./availability for this service.
import { buildAvailability } from "./availability";

// Run next step: describe("buildAvailability characterization", () => {
describe("buildAvailability characterization", () => {
  // Capture world for use in this scope.
  let world: CleaningWorld;
  // Capture hotel date ymd for use in this scope.
  let hotelDateYmd: string;
  // Capture hotel date key for use in this scope.
  let hotelDateKey: Date;

  // Run next step: before(async () => {
  before(async () => {
    // Wait for the async step before continuing.
    await assertTestDatabase(prisma);
    // Update world as control flow progresses.
    world = await createCleaningWorld(prisma);
    // Update hotel date ymd as control flow progresses.
    hotelDateYmd = await todayHotelDateYmd();
    // Update hotel date key as control flow progresses.
    hotelDateKey = new Date(`${hotelDateYmd}T00:00:00.000Z`);
  });

  // Run next step: after(async () => {
  after(async () => {
    // Branch when this condition holds so the right path runs.
    if (world) {
      // Wait for the async step before continuing.
      await resetCleaningWork(prisma, world);
      // Wait for the async step before continuing.
      await cleanupCleaningWorld(prisma, world);
    }
    // Wait for the async step before continuing.
    await prisma.$disconnect();
  });

  // Run next step: it("empty employee list returns [] without querying side eff…
  it("empty employee list returns [] without querying side effects", async () => {
    // Load rows asynchronously for the next steps.
    const rows = await buildAvailability({
      // Set employees on the structure being built.
      employees: [],
      // Set db on the structure being built.
      db: prisma,
      // Set now on the structure being built.
      now: new Date(),
      // Run next step: hotelDateKey,
      hotelDateKey,
      // Set nowHhMm on the structure being built.
      nowHhMm: "12:00",
      // Set checkedAt on the structure being built.
      checkedAt: "2000-01-01T00:00:00.000Z",
    });
    // Run next step: assert.deepEqual(rows, []);
    assert.deepEqual(rows, []);
  });

  // Run next step: it("available housekeepers sort by assignedTaskCount then na…
  it("available housekeepers sort by assignedTaskCount then name; load ≠ busy", async () => {
    // Wait for the async step before continuing.
    await resetCleaningWork(prisma, world);
    // Wait for the async step before continuing.
    await makeHousekeepersAvailable(prisma, {
      // Set employeeIds on the structure being built.
      employeeIds: [world.hk1.employeeId, world.hk2.employeeId],
      // Set shiftId on the structure being built.
      shiftId: world.availabilityShiftId,
      // Run next step: hotelDateYmd,
      hotelDateYmd,
    });

    // Give hk1 two active assignments (one per location/day); hk2 none — both still available.
    for (const locationId of [world.locationAId, world.locationBId]) {
      // Wait for the async step before continuing.
      await prisma.cleaningTask.create({
        // Set data on the structure being built.
        data: {
          // Run next step: locationId,
          locationId,
          // Set assignedEmployeeId on the structure being built.
          assignedEmployeeId: world.hk1.employeeId,
          // Set hotelDate on the structure being built.
          hotelDate: hotelDateKey,
          // Set status on the structure being built.
          status: TaskStatus.assigned,
          // Set cleaningCycle on the structure being built.
          cleaningCycle: 0,
          // Set serviceType on the structure being built.
          serviceType: "departure",
        },
      });
    }

    // Capture checked at for use in this scope.
    const checkedAt = "2026-06-15T10:00:00.000Z";
    // Load rows asynchronously for the next steps.
    const rows = await buildAvailability({
      // Set employees on the structure being built.
      employees: [
        // Run next step: {
        {
          // Set id on the structure being built.
          id: world.hk2.employeeId,
          // Set fullName on the structure being built.
          fullName: "CLN Housekeeper 2",
          // Set employeeNumber on the structure being built.
          employeeNumber: world.hk2.employeeNumber,
        },
        // Run next step: {
        {
          // Set id on the structure being built.
          id: world.hk1.employeeId,
          // Set fullName on the structure being built.
          fullName: "CLN Housekeeper 1",
          // Set employeeNumber on the structure being built.
          employeeNumber: world.hk1.employeeNumber,
        },
      ],
      // Set db on the structure being built.
      db: prisma,
      // Set now on the structure being built.
      now: new Date(),
      // Run next step: hotelDateKey,
      hotelDateKey,
      // Set nowHhMm on the structure being built.
      nowHhMm: "12:00", // full-day fixture shift 00:00–00:00
      // Run next step: checkedAt,
      checkedAt,
    });

    // Run next step: assert.equal(rows.length, 2);
    assert.equal(rows.length, 2);
    // Run next step: assert.ok(rows.every((r) => r.availabilityStatus === "availa…
    assert.ok(rows.every((r) => r.availabilityStatus === "available"));
    // Run next step: assert.equal(rows[0]!.employeeId, world.hk2.employeeId); // …
    assert.equal(rows[0]!.employeeId, world.hk2.employeeId); // lower load first
    // Run next step: assert.equal(rows[0]!.assignedTaskCount, 0);
    assert.equal(rows[0]!.assignedTaskCount, 0);
    // Run next step: assert.equal(rows[1]!.employeeId, world.hk1.employeeId);
    assert.equal(rows[1]!.employeeId, world.hk1.employeeId);
    // Run next step: assert.equal(rows[1]!.assignedTaskCount, 2);
    assert.equal(rows[1]!.assignedTaskCount, 2);
    // Run next step: assert.ok(rows.every((r) => r.checkedAt === checkedAt));
    assert.ok(rows.every((r) => r.checkedAt === checkedAt));
    // Run next step: assert.ok(rows.every((r) => r.sectorEligibility === "hotel_w…
    assert.ok(rows.every((r) => r.sectorEligibility === "hotel_wide"));
  });

  // Run next step: it("running session → busy and surfaces currentRunningTask; …
  it("running session → busy and surfaces currentRunningTask; status sort before available", async () => {
    // Wait for the async step before continuing.
    await resetCleaningWork(prisma, world);
    // Wait for the async step before continuing.
    await makeHousekeepersAvailable(prisma, {
      // Set employeeIds on the structure being built.
      employeeIds: [world.hk1.employeeId, world.hk2.employeeId],
      // Set shiftId on the structure being built.
      shiftId: world.availabilityShiftId,
      // Run next step: hotelDateYmd,
      hotelDateYmd,
    });

    // Load task asynchronously for the next steps.
    const task = await prisma.cleaningTask.create({
      // Set data on the structure being built.
      data: {
        // Set locationId on the structure being built.
        locationId: world.locationAId,
        // Set assignedEmployeeId on the structure being built.
        assignedEmployeeId: world.hk1.employeeId,
        // Set hotelDate on the structure being built.
        hotelDate: hotelDateKey,
        // Set status on the structure being built.
        status: TaskStatus.in_progress,
        // Set cleaningCycle on the structure being built.
        cleaningCycle: 0,
        // Set serviceType on the structure being built.
        serviceType: "departure",
      },
    });
    // Wait for the async step before continuing.
    await prisma.cleaningSession.create({
      // Set data on the structure being built.
      data: {
        // Set taskId on the structure being built.
        taskId: task.id,
        // Set employeeId on the structure being built.
        employeeId: world.hk1.employeeId,
        // Set startedAt on the structure being built.
        startedAt: new Date(),
        // Set status on the structure being built.
        status: SessionStatus.running,
        // Set anomalyFlags on the structure being built.
        anomalyFlags: [],
        // Set startCommandId on the structure being built.
        startCommandId: randomUUID(),
      },
    });

    // Load rows asynchronously for the next steps.
    const rows = await buildAvailability({
      // Set employees on the structure being built.
      employees: [
        // Run next step: {
        {
          // Set id on the structure being built.
          id: world.hk1.employeeId,
          // Set fullName on the structure being built.
          fullName: "CLN Housekeeper 1",
          // Set employeeNumber on the structure being built.
          employeeNumber: world.hk1.employeeNumber,
        },
        // Run next step: {
        {
          // Set id on the structure being built.
          id: world.hk2.employeeId,
          // Set fullName on the structure being built.
          fullName: "CLN Housekeeper 2",
          // Set employeeNumber on the structure being built.
          employeeNumber: world.hk2.employeeNumber,
        },
      ],
      // Set db on the structure being built.
      db: prisma,
      // Set now on the structure being built.
      now: new Date(),
      // Run next step: hotelDateKey,
      hotelDateKey,
      // Set nowHhMm on the structure being built.
      nowHhMm: "12:00",
      // Set checkedAt on the structure being built.
      checkedAt: new Date().toISOString(),
    });

    // Capture busy for use in this scope.
    const busy = rows.find((r) => r.employeeId === world.hk1.employeeId)!;
    // Capture free for use in this scope.
    const free = rows.find((r) => r.employeeId === world.hk2.employeeId)!;
    // Run next step: assert.equal(busy.availabilityStatus, "busy");
    assert.equal(busy.availabilityStatus, "busy");
    // Run next step: assert.deepEqual(busy.availabilityReasons, ["running_cleanin…
    assert.deepEqual(busy.availabilityReasons, ["running_cleaning_session"]);
    // Run next step: assert.equal(busy.currentRunningTask?.taskId, task.id);
    assert.equal(busy.currentRunningTask?.taskId, task.id);
    // Run next step: assert.equal(busy.currentRunningTask?.locationId, world.loca…
    assert.equal(busy.currentRunningTask?.locationId, world.locationAId);
    // Run next step: assert.equal(free.availabilityStatus, "available");
    assert.equal(free.availabilityStatus, "available");
    // available (0) before busy (3)
    assert.equal(rows[0]!.employeeId, world.hk2.employeeId);
    // Run next step: assert.equal(rows[1]!.employeeId, world.hk1.employeeId);
    assert.equal(rows[1]!.employeeId, world.hk1.employeeId);
  });

  // Run next step: it("no roster → off_shift; open break → on_break", async () …
  it("no roster → off_shift; open break → on_break", async () => {
    // Wait for the async step before continuing.
    await resetCleaningWork(prisma, world);
    // World seed may already roster both HKs — strip hk1 for off_shift.
    await prisma.employeeShiftRoster.deleteMany({
      // Set where on the structure being built.
      where: { employeeId: world.hk1.employeeId, hotelDate: hotelDateKey },
    });
    // Wait for the async step before continuing.
    await prisma.attendanceInterval.updateMany({
      // Set where on the structure being built.
      where: {
        // Set employeeId on the structure being built.
        employeeId: world.hk1.employeeId,
        // Set hotelDate on the structure being built.
        hotelDate: hotelDateKey,
        // Set status on the structure being built.
        status: AttendanceIntervalStatus.open,
        // Set endedAt on the structure being built.
        endedAt: null,
      },
      // Set data on the structure being built.
      data: {
        // Set status on the structure being built.
        status: AttendanceIntervalStatus.closed,
        // Set endedAt on the structure being built.
        endedAt: new Date(),
      },
    });
    // Wait for the async step before continuing.
    await makeHousekeepersAvailable(prisma, {
      // Set employeeIds on the structure being built.
      employeeIds: [world.hk2.employeeId],
      // Set shiftId on the structure being built.
      shiftId: world.availabilityShiftId,
      // Run next step: hotelDateYmd,
      hotelDateYmd,
    });

    // Load interval asynchronously for the next steps.
    const interval = await prisma.attendanceInterval.findFirst({
      // Set where on the structure being built.
      where: {
        // Set employeeId on the structure being built.
        employeeId: world.hk2.employeeId,
        // Set hotelDate on the structure being built.
        hotelDate: hotelDateKey,
        // Set status on the structure being built.
        status: AttendanceIntervalStatus.open,
      },
      // Set orderBy on the structure being built.
      orderBy: { startedAt: "desc" },
    });
    // Run next step: assert.ok(interval);
    assert.ok(interval);
    // Capture stamp for use in this scope.
    const stamp = randomUUID();
    // Wait for the async step before continuing.
    await prisma.attendanceEvent.create({
      // Set data on the structure being built.
      data: {
        // Set employeeId on the structure being built.
        employeeId: world.hk2.employeeId,
        // Set kind on the structure being built.
        kind: AttendanceEventKind.break_start,
        // Set source on the structure being built.
        source: "availability-char",
        // Set externalEventId on the structure being built.
        externalEventId: `brk-${stamp}`,
        // Set deviceTime on the structure being built.
        deviceTime: new Date(interval!.startedAt.getTime() + 60_000),
        // Set normalizedTime on the structure being built.
        normalizedTime: new Date(interval!.startedAt.getTime() + 60_000),
      },
    });

    // Load rows asynchronously for the next steps.
    const rows = await buildAvailability({
      // Set employees on the structure being built.
      employees: [
        // Run next step: {
        {
          // Set id on the structure being built.
          id: world.hk1.employeeId,
          // Set fullName on the structure being built.
          fullName: "CLN Housekeeper 1",
          // Set employeeNumber on the structure being built.
          employeeNumber: world.hk1.employeeNumber,
        },
        // Run next step: {
        {
          // Set id on the structure being built.
          id: world.hk2.employeeId,
          // Set fullName on the structure being built.
          fullName: "CLN Housekeeper 2",
          // Set employeeNumber on the structure being built.
          employeeNumber: world.hk2.employeeNumber,
        },
      ],
      // Set db on the structure being built.
      db: prisma,
      // Set now on the structure being built.
      now: new Date(),
      // Run next step: hotelDateKey,
      hotelDateKey,
      // Set nowHhMm on the structure being built.
      nowHhMm: "12:00",
      // Set checkedAt on the structure being built.
      checkedAt: new Date().toISOString(),
    });

    // Capture no roster for use in this scope.
    const noRoster = rows.find((r) => r.employeeId === world.hk1.employeeId)!;
    // Capture on break for use in this scope.
    const onBreak = rows.find((r) => r.employeeId === world.hk2.employeeId)!;
    // Run next step: assert.equal(noRoster.availabilityStatus, "off_shift");
    assert.equal(noRoster.availabilityStatus, "off_shift");
    // Run next step: assert.deepEqual(noRoster.availabilityReasons, ["no_roster_s…
    assert.deepEqual(noRoster.availabilityReasons, ["no_roster_shift"]);
    // Run next step: assert.equal(noRoster.currentShift, null);
    assert.equal(noRoster.currentShift, null);
    // Run next step: assert.equal(onBreak.availabilityStatus, "on_break");
    assert.equal(onBreak.availabilityStatus, "on_break");
    // Run next step: assert.ok(onBreak.availabilityReasons.includes("on_break"));
    assert.ok(onBreak.availabilityReasons.includes("on_break"));
    // on_break (2) before off_shift (5)
    assert.equal(rows[0]!.employeeId, world.hk2.employeeId);
  });
});
