/**
 * Pure availability classifier + shift window helpers (no DB).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AttendanceIntervalStatus } from "@prisma/client";
import {
  classifyAvailability,
  hotelLocalHhMm,
  isWithinShiftWindow,
} from "./availability";

describe("isWithinShiftWindow", () => {
  it("handles same-day shifts", () => {
    assert.equal(isWithinShiftWindow("09:00", "08:00", "16:00"), true);
    assert.equal(isWithinShiftWindow("07:59", "08:00", "16:00"), false);
    assert.equal(isWithinShiftWindow("16:00", "08:00", "16:00"), false);
  });

  it("handles overnight shifts", () => {
    assert.equal(isWithinShiftWindow("23:00", "22:00", "06:00"), true);
    assert.equal(isWithinShiftWindow("05:00", "22:00", "06:00"), true);
    assert.equal(isWithinShiftWindow("12:00", "22:00", "06:00"), false);
  });

  it("treats equal start/end as full day", () => {
    assert.equal(isWithinShiftWindow("00:00", "00:00", "00:00"), true);
    assert.equal(isWithinShiftWindow("12:30", "00:00", "00:00"), true);
  });
});

describe("hotelLocalHhMm", () => {
  it("formats UTC instant in a known zone", () => {
    const instant = new Date("2026-06-15T12:30:00.000Z");
    assert.equal(hotelLocalHhMm(instant, "UTC"), "12:30");
  });
});

describe("classifyAvailability", () => {
  // Build open interval object holding related fields.
  const openInterval = {
    status: AttendanceIntervalStatus.open,
    startedAt: new Date("2026-06-15T06:00:00.000Z"),
    endedAt: null as Date | null,
  };

  it("busy when running a cleaning session", () => {
    assert.deepEqual(
      classifyAvailability({
        hasRunningSession: true,
        rosterShift: { startTime: "08:00", endTime: "16:00" },
        nowHhMm: "10:00",
        interval: openInterval,
        onBreak: false,
      }),
      { status: "busy", reasons: ["running_cleaning_session"] },
    );
  });

  it("off_shift when no roster", () => {
    assert.deepEqual(
      classifyAvailability({
        hasRunningSession: false,
        rosterShift: null,
        nowHhMm: "10:00",
        interval: openInterval,
        onBreak: false,
      }),
      { status: "off_shift", reasons: ["no_roster_shift"] },
    );
  });

  it("off_shift outside shift window", () => {
    assert.deepEqual(
      classifyAvailability({
        hasRunningSession: false,
        rosterShift: { startTime: "08:00", endTime: "16:00" },
        nowHhMm: "18:00",
        interval: openInterval,
        onBreak: false,
      }),
      { status: "off_shift", reasons: ["outside_shift_window"] },
    );
  });

  it("unknown when on shift but missing attendance", () => {
    assert.deepEqual(
      classifyAvailability({
        hasRunningSession: false,
        rosterShift: { startTime: "08:00", endTime: "16:00" },
        nowHhMm: "10:00",
        interval: null,
        onBreak: false,
      }),
      {
        status: "unknown",
        reasons: ["on_roster_shift", "missing_attendance"],
      },
    );
  });

  it("unknown when attendance needs_review", () => {
    assert.deepEqual(
      classifyAvailability({
        hasRunningSession: false,
        rosterShift: { startTime: "08:00", endTime: "16:00" },
        nowHhMm: "10:00",
        interval: {
          status: AttendanceIntervalStatus.needs_review,
          startedAt: openInterval.startedAt,
          endedAt: null,
        },
        onBreak: false,
      }),
      {
        status: "unknown",
        reasons: ["on_roster_shift", "attendance_needs_review"],
      },
    );
  });

  it("on_break when clocked in with unpaired break", () => {
    assert.deepEqual(
      classifyAvailability({
        hasRunningSession: false,
        rosterShift: { startTime: "08:00", endTime: "16:00" },
        nowHhMm: "10:00",
        interval: openInterval,
        onBreak: true,
      }),
      {
        status: "on_break",
        reasons: ["on_roster_shift", "on_break"],
      },
    );
  });

  it("available when clocked in on shift without running session", () => {
    assert.deepEqual(
      classifyAvailability({
        hasRunningSession: false,
        rosterShift: { startTime: "08:00", endTime: "16:00" },
        nowHhMm: "10:00",
        interval: openInterval,
        onBreak: false,
      }),
      {
        status: "available",
        reasons: ["on_roster_shift", "clocked_in"],
      },
    );
  });

  it("absent when clocked out", () => {
    assert.deepEqual(
      classifyAvailability({
        hasRunningSession: false,
        rosterShift: { startTime: "08:00", endTime: "16:00" },
        nowHhMm: "10:00",
        interval: {
          status: AttendanceIntervalStatus.closed,
          startedAt: openInterval.startedAt,
          endedAt: new Date("2026-06-15T09:00:00.000Z"),
        },
        onBreak: false,
      }),
      {
        status: "absent",
        reasons: ["on_roster_shift", "clocked_out"],
      },
    );
  });

  it("does not treat assigned tasks as busy (no running session)", () => {
    // Classifier has no task-count input — busy only from running session.
    const result = classifyAvailability({
      hasRunningSession: false,
      rosterShift: { startTime: "08:00", endTime: "16:00" },
      nowHhMm: "10:00",
      interval: openInterval,
      onBreak: false,
    });
    assert.equal(result.status, "available");
  });

  it("overnight shift + clocked in = available", () => {
    assert.deepEqual(
      classifyAvailability({
        hasRunningSession: false,
        rosterShift: { startTime: "22:00", endTime: "06:00" },
        nowHhMm: "23:30",
        interval: openInterval,
        onBreak: false,
      }),
      {
        status: "available",
        reasons: ["on_roster_shift", "clocked_in"],
      },
    );
  });
});
