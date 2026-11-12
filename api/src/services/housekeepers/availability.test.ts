/**
 * Pure availability classifier + shift window helpers (no DB).
 */
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module @prisma/client for this service.
import { AttendanceIntervalStatus } from "@prisma/client";
// Import module dependency for this service.
import {
  // Run next step: classifyAvailability,
  classifyAvailability,
  // Run next step: hotelLocalHhMm,
  hotelLocalHhMm,
  // Run next step: isWithinShiftWindow,
  isWithinShiftWindow,
// Run next step: } from "./availability";
} from "./availability";

// Run next step: describe("isWithinShiftWindow", () => {
describe("isWithinShiftWindow", () => {
  // Run next step: it("handles same-day shifts", () => {
  it("handles same-day shifts", () => {
    // Run next step: assert.equal(isWithinShiftWindow("09:00", "08:00", "16:00"),…
    assert.equal(isWithinShiftWindow("09:00", "08:00", "16:00"), true);
    // Run next step: assert.equal(isWithinShiftWindow("07:59", "08:00", "16:00"),…
    assert.equal(isWithinShiftWindow("07:59", "08:00", "16:00"), false);
    // Run next step: assert.equal(isWithinShiftWindow("16:00", "08:00", "16:00"),…
    assert.equal(isWithinShiftWindow("16:00", "08:00", "16:00"), false);
  });

  // Run next step: it("handles overnight shifts", () => {
  it("handles overnight shifts", () => {
    // Run next step: assert.equal(isWithinShiftWindow("23:00", "22:00", "06:00"),…
    assert.equal(isWithinShiftWindow("23:00", "22:00", "06:00"), true);
    // Run next step: assert.equal(isWithinShiftWindow("05:00", "22:00", "06:00"),…
    assert.equal(isWithinShiftWindow("05:00", "22:00", "06:00"), true);
    // Run next step: assert.equal(isWithinShiftWindow("12:00", "22:00", "06:00"),…
    assert.equal(isWithinShiftWindow("12:00", "22:00", "06:00"), false);
  });

  // Run next step: it("treats equal start/end as full day", () => {
  it("treats equal start/end as full day", () => {
    // Run next step: assert.equal(isWithinShiftWindow("00:00", "00:00", "00:00"),…
    assert.equal(isWithinShiftWindow("00:00", "00:00", "00:00"), true);
    // Run next step: assert.equal(isWithinShiftWindow("12:30", "00:00", "00:00"),…
    assert.equal(isWithinShiftWindow("12:30", "00:00", "00:00"), true);
  });
});

// Run next step: describe("hotelLocalHhMm", () => {
describe("hotelLocalHhMm", () => {
  // Run next step: it("formats UTC instant in a known zone", () => {
  it("formats UTC instant in a known zone", () => {
    // Capture instant for use in this scope.
    const instant = new Date("2026-06-15T12:30:00.000Z");
    // Run next step: assert.equal(hotelLocalHhMm(instant, "UTC"), "12:30");
    assert.equal(hotelLocalHhMm(instant, "UTC"), "12:30");
  });
});

// Run next step: describe("classifyAvailability", () => {
describe("classifyAvailability", () => {
  // Build open interval object holding related fields.
  const openInterval = {
    // Set status on the structure being built.
    status: AttendanceIntervalStatus.open,
    // Set startedAt on the structure being built.
    startedAt: new Date("2026-06-15T06:00:00.000Z"),
    // Set endedAt on the structure being built.
    endedAt: null as Date | null,
  };

  // Run next step: it("busy when running a cleaning session", () => {
  it("busy when running a cleaning session", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: classifyAvailability({
      classifyAvailability({
        // Set hasRunningSession on the structure being built.
        hasRunningSession: true,
        // Set rosterShift on the structure being built.
        rosterShift: { startTime: "08:00", endTime: "16:00" },
        // Set nowHhMm on the structure being built.
        nowHhMm: "10:00",
        // Set interval on the structure being built.
        interval: openInterval,
        // Set onBreak on the structure being built.
        onBreak: false,
      }),
      // Run next step: { status: "busy", reasons: ["running_cleaning_session"] },
      { status: "busy", reasons: ["running_cleaning_session"] },
    );
  });

  // Run next step: it("off_shift when no roster", () => {
  it("off_shift when no roster", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: classifyAvailability({
      classifyAvailability({
        // Set hasRunningSession on the structure being built.
        hasRunningSession: false,
        // Set rosterShift on the structure being built.
        rosterShift: null,
        // Set nowHhMm on the structure being built.
        nowHhMm: "10:00",
        // Set interval on the structure being built.
        interval: openInterval,
        // Set onBreak on the structure being built.
        onBreak: false,
      }),
      // Run next step: { status: "off_shift", reasons: ["no_roster_shift"] },
      { status: "off_shift", reasons: ["no_roster_shift"] },
    );
  });

  // Run next step: it("off_shift outside shift window", () => {
  it("off_shift outside shift window", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: classifyAvailability({
      classifyAvailability({
        // Set hasRunningSession on the structure being built.
        hasRunningSession: false,
        // Set rosterShift on the structure being built.
        rosterShift: { startTime: "08:00", endTime: "16:00" },
        // Set nowHhMm on the structure being built.
        nowHhMm: "18:00",
        // Set interval on the structure being built.
        interval: openInterval,
        // Set onBreak on the structure being built.
        onBreak: false,
      }),
      // Run next step: { status: "off_shift", reasons: ["outside_shift_window"] },
      { status: "off_shift", reasons: ["outside_shift_window"] },
    );
  });

  // Run next step: it("unknown when on shift but missing attendance", () => {
  it("unknown when on shift but missing attendance", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: classifyAvailability({
      classifyAvailability({
        // Set hasRunningSession on the structure being built.
        hasRunningSession: false,
        // Set rosterShift on the structure being built.
        rosterShift: { startTime: "08:00", endTime: "16:00" },
        // Set nowHhMm on the structure being built.
        nowHhMm: "10:00",
        // Set interval on the structure being built.
        interval: null,
        // Set onBreak on the structure being built.
        onBreak: false,
      }),
      // Run next step: {
      {
        // Set status on the structure being built.
        status: "unknown",
        // Set reasons on the structure being built.
        reasons: ["on_roster_shift", "missing_attendance"],
      },
    );
  });

  // Run next step: it("unknown when attendance needs_review", () => {
  it("unknown when attendance needs_review", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: classifyAvailability({
      classifyAvailability({
        // Set hasRunningSession on the structure being built.
        hasRunningSession: false,
        // Set rosterShift on the structure being built.
        rosterShift: { startTime: "08:00", endTime: "16:00" },
        // Set nowHhMm on the structure being built.
        nowHhMm: "10:00",
        // Set interval on the structure being built.
        interval: {
          // Set status on the structure being built.
          status: AttendanceIntervalStatus.needs_review,
          // Set startedAt on the structure being built.
          startedAt: openInterval.startedAt,
          // Set endedAt on the structure being built.
          endedAt: null,
        },
        // Set onBreak on the structure being built.
        onBreak: false,
      }),
      // Run next step: {
      {
        // Set status on the structure being built.
        status: "unknown",
        // Set reasons on the structure being built.
        reasons: ["on_roster_shift", "attendance_needs_review"],
      },
    );
  });

  // Run next step: it("on_break when clocked in with unpaired break", () => {
  it("on_break when clocked in with unpaired break", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: classifyAvailability({
      classifyAvailability({
        // Set hasRunningSession on the structure being built.
        hasRunningSession: false,
        // Set rosterShift on the structure being built.
        rosterShift: { startTime: "08:00", endTime: "16:00" },
        // Set nowHhMm on the structure being built.
        nowHhMm: "10:00",
        // Set interval on the structure being built.
        interval: openInterval,
        // Set onBreak on the structure being built.
        onBreak: true,
      }),
      // Run next step: {
      {
        // Set status on the structure being built.
        status: "on_break",
        // Set reasons on the structure being built.
        reasons: ["on_roster_shift", "on_break"],
      },
    );
  });

  // Run next step: it("available when clocked in on shift without running sessi…
  it("available when clocked in on shift without running session", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: classifyAvailability({
      classifyAvailability({
        // Set hasRunningSession on the structure being built.
        hasRunningSession: false,
        // Set rosterShift on the structure being built.
        rosterShift: { startTime: "08:00", endTime: "16:00" },
        // Set nowHhMm on the structure being built.
        nowHhMm: "10:00",
        // Set interval on the structure being built.
        interval: openInterval,
        // Set onBreak on the structure being built.
        onBreak: false,
      }),
      // Run next step: {
      {
        // Set status on the structure being built.
        status: "available",
        // Set reasons on the structure being built.
        reasons: ["on_roster_shift", "clocked_in"],
      },
    );
  });

  // Run next step: it("absent when clocked out", () => {
  it("absent when clocked out", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: classifyAvailability({
      classifyAvailability({
        // Set hasRunningSession on the structure being built.
        hasRunningSession: false,
        // Set rosterShift on the structure being built.
        rosterShift: { startTime: "08:00", endTime: "16:00" },
        // Set nowHhMm on the structure being built.
        nowHhMm: "10:00",
        // Set interval on the structure being built.
        interval: {
          // Set status on the structure being built.
          status: AttendanceIntervalStatus.closed,
          // Set startedAt on the structure being built.
          startedAt: openInterval.startedAt,
          // Set endedAt on the structure being built.
          endedAt: new Date("2026-06-15T09:00:00.000Z"),
        },
        // Set onBreak on the structure being built.
        onBreak: false,
      }),
      // Run next step: {
      {
        // Set status on the structure being built.
        status: "absent",
        // Set reasons on the structure being built.
        reasons: ["on_roster_shift", "clocked_out"],
      },
    );
  });

  // Run next step: it("does not treat assigned tasks as busy (no running sessio…
  it("does not treat assigned tasks as busy (no running session)", () => {
    // Classifier has no task-count input — busy only from running session.
    const result = classifyAvailability({
      // Set hasRunningSession on the structure being built.
      hasRunningSession: false,
      // Set rosterShift on the structure being built.
      rosterShift: { startTime: "08:00", endTime: "16:00" },
      // Set nowHhMm on the structure being built.
      nowHhMm: "10:00",
      // Set interval on the structure being built.
      interval: openInterval,
      // Set onBreak on the structure being built.
      onBreak: false,
    });
    // Run next step: assert.equal(result.status, "available");
    assert.equal(result.status, "available");
  });

  // Run next step: it("overnight shift + clocked in = available", () => {
  it("overnight shift + clocked in = available", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: classifyAvailability({
      classifyAvailability({
        // Set hasRunningSession on the structure being built.
        hasRunningSession: false,
        // Set rosterShift on the structure being built.
        rosterShift: { startTime: "22:00", endTime: "06:00" },
        // Set nowHhMm on the structure being built.
        nowHhMm: "23:30",
        // Set interval on the structure being built.
        interval: openInterval,
        // Set onBreak on the structure being built.
        onBreak: false,
      }),
      // Run next step: {
      {
        // Set status on the structure being built.
        status: "available",
        // Set reasons on the structure being built.
        reasons: ["on_roster_shift", "clocked_in"],
      },
    );
  });
});
