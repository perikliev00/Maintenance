// Strict assert helpers for precise test failures.
import assert from "node:assert/strict";
// Node test runner (describe/it/hooks).
import { describe, it } from "node:test";
// Prisma client enums and input types.
import { AttendanceEventKind, AttendanceIntervalStatus } from "@prisma/client";
// Runtime import from ../errors.
import { AppError } from "../errors";
// Module import required below.
import {
  OPEN_MISSING_END_HOURS,
  assertValidAdjustmentTimes,
  addDaysYmd,
  computeWorkedMinutes,
  eventRequiresIntervalLink,
  hotelDateKey,
  pairEventsToIntervalDrafts,
  uniqueFlags,
  // Type alias RebuildEvent.
  type RebuildEvent,
// Support the surrounding control flow.
} from "./attendanceRules";

// Test suite: assertValidAdjustmentTimes.
describe("assertValidAdjustmentTimes", () => {
  // Date start for window math.
  const start = new Date("2026-10-08T08:00:00.000Z");

  // Test case: allows end after start with break within span.
  it("allows end after start with break within span", () => {
    // Date end for window math.
    const end = new Date("2026-10-08T16:00:00.000Z");
    // Assert expected outcome.
    assert.doesNotThrow(() => assertValidAdjustmentTimes(start, end, 30));
    // Assert expected outcome.
    assert.doesNotThrow(() => assertValidAdjustmentTimes(start, end, 480));
  });

  // Test case: skips checks when endedAt is null (open interval).
  it("skips checks when endedAt is null (open interval)", () => {
    // Assert expected outcome.
    assert.doesNotThrow(() => assertValidAdjustmentTimes(start, null, 999));
  });

  // Test case: rejects end before start.
  it("rejects end before start", () => {
    // Date end for window math.
    const end = new Date("2026-10-08T07:00:00.000Z");
    // Expect an error on this path.
    assert.throws(
      // Support the surrounding control flow.
      () => assertValidAdjustmentTimes(start, end, 0),
      // Support the surrounding control flow.
      (err: unknown) =>
        // Additional clause in this boolean decision.
        err instanceof AppError &&
        // Additional clause in this boolean decision.
        err.status === 400 &&
        // Additional clause in this boolean decision.
        err.code === "validation" &&
        // Assign err.message.
        err.message === "End must be after start",
    );
  });

  // Test case: rejects end equal to start.
  it("rejects end equal to start", () => {
    // Expect an error on this path.
    assert.throws(
      // Support the surrounding control flow.
      () => assertValidAdjustmentTimes(start, start, 0),
      // Support the surrounding control flow.
      (err: unknown) =>
        // Additional clause in this boolean decision.
        err instanceof AppError &&
        // Additional clause in this boolean decision.
        err.status === 400 &&
        // Additional clause in this boolean decision.
        err.code === "validation" &&
        // Assign err.message.
        err.message === "End must be after start",
    );
  });

  // Test case: rejects break minutes that exceed interval duration.
  it("rejects break minutes that exceed interval duration", () => {
    const end = new Date("2026-10-08T09:00:00.000Z"); // 60 minutes
    // Expect an error on this path.
    assert.throws(
      // Support the surrounding control flow.
      () => assertValidAdjustmentTimes(start, end, 61),
      // Support the surrounding control flow.
      (err: unknown) =>
        // Additional clause in this boolean decision.
        err instanceof AppError &&
        // Additional clause in this boolean decision.
        err.status === 400 &&
        // Additional clause in this boolean decision.
        err.code === "validation" &&
        // Assign err.message.
        err.message === "Break minutes exceed interval duration",
    );
  });
});

// Internal helper ev.
function ev(
  // Param partial required by this function.
  partial: Partial<RebuildEvent> &
    // Support the surrounding control flow.
    Pick<RebuildEvent, "id" | "kind" | "normalizedTime">,
): RebuildEvent {
  // Return response object.
  return {
    // Set clockSkewSeconds.
    clockSkewSeconds: null,
    // Spread additional fields/filters.
    ...partial,
  };
}

// Test suite: attendance ingest rebuild pairing.
describe("attendance ingest rebuild pairing", () => {
  // Test case: pairs clock_in then clock_out into a closed interval.
  it("pairs clock_in then clock_out into a closed interval", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out1",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.startEventId, "in1");
    // Compare scalar values.
    assert.equal(drafts[0]!.endEventId, "out1");
    // Compare scalar values.
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.closed);
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, 480);
  });

  // Test case: restores intervals from an event stream after a partial apply gap.
  it("restores intervals from an event stream after a partial apply gap", () => {
    // Simulates: clock_in event exists but interval never written; later
    // clock_out arrives — full rebuild must create the closed interval.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "orphan-in",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T09:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T17:30:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.startEventId, "orphan-in");
    // Compare scalar values.
    assert.equal(drafts[0]!.endEventId, "out");
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, 510);
  });

  // Test case: leaves adjusted (frozen) ranges untouched and skips overlapping events.
  it("leaves adjusted (frozen) ranges untouched and skips overlapping events", () => {
    // Date frozenStart for window math.
    const frozenStart = new Date("2026-10-06T08:00:00.000Z").getTime();
    // Date frozenEnd for window math.
    const frozenEnd = new Date("2026-10-06T12:00:00.000Z").getTime();
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in-frozen",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out-frozen",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T12:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "in2",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T13:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out2",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T17:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [{ startMs: frozenStart, endMs: frozenEnd }],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.startEventId, "in2");
    // Compare scalar values.
    assert.equal(drafts[0]!.endEventId, "out2");
  });

  // Test case: flags duplicate clock_in while open and orphan clock_out.
  it("flags duplicate clock_in while open and orphan clock_out", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "in2",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T09:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out1",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "orphan-out",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T18:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 2);
    // Require truthy condition.
    assert.ok(drafts[0]!.anomalyFlags.includes("duplicate_kind"));
    // Compare scalar values.
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
    // Require truthy condition.
    assert.ok(drafts[1]!.anomalyFlags.includes("missing_end"));
    // Compare scalar values.
    assert.equal(drafts[1]!.endEventId, "orphan-out");
  });

  // Test case: keeps open clock_in as open just under OPEN_MISSING_END_HOURS.
  it("keeps open clock_in as open just under OPEN_MISSING_END_HOURS", () => {
    // Date startedAt for window math.
    const startedAt = new Date("2026-10-06T08:00:00.000Z");
    // Date now for window math.
    const now = new Date(
      // Support the surrounding control flow.
      startedAt.getTime() + (OPEN_MISSING_END_HOURS * 3600_000 - 1),
    );
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Set normalizedTime.
          normalizedTime: startedAt,
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
      now,
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.open);
    // Require truthy condition.
    assert.ok(!drafts[0]!.anomalyFlags.includes("missing_end"));
  });

  // Test case: flags open clock_in as needs_review at OPEN_MISSING_END_HOURS.
  it("flags open clock_in as needs_review at OPEN_MISSING_END_HOURS", () => {
    // Date startedAt for window math.
    const startedAt = new Date("2026-10-06T08:00:00.000Z");
    // Date now for window math.
    const now = new Date(
      // Support the surrounding control flow.
      startedAt.getTime() + OPEN_MISSING_END_HOURS * 3600_000,
    );
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Set normalizedTime.
          normalizedTime: startedAt,
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
      now,
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
    // Require truthy condition.
    assert.ok(drafts[0]!.anomalyFlags.includes("missing_end"));
  });

  // Test case: flags open clock_in as needs_review past OPEN_MISSING_END_HOURS.
  it("flags open clock_in as needs_review past OPEN_MISSING_END_HOURS", () => {
    // Date startedAt for window math.
    const startedAt = new Date("2026-10-06T08:00:00.000Z");
    // Date now for window math.
    const now = new Date(
      // Support the surrounding control flow.
      startedAt.getTime() + (OPEN_MISSING_END_HOURS + 6.5) * 3600_000,
    );
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Set normalizedTime.
          normalizedTime: startedAt,
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
      now,
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
    // Require truthy condition.
    assert.ok(drafts[0]!.anomalyFlags.includes("missing_end"));
  });

  // Test case: counts breaks inside an interval window.
  it("counts breaks inside an interval window", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "bs",
          // Set kind.
          kind: AttendanceEventKind.break_start,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T12:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "be",
          // Set kind.
          kind: AttendanceEventKind.break_end,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T12:30:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out1",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.breakMinutes, 30);
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, 450);
  });

  // Test case: marks clock kinds as start/end links (breaks attach by time window).
  it("marks clock kinds as start/end links (breaks attach by time window)", () => {
    // Heal-on-retry rebuilds whenever findIntervalForEvent returns null for
    // any kind; this helper only documents pairing roles.
    assert.equal(eventRequiresIntervalLink(AttendanceEventKind.clock_in), true);
    // Compare scalar values.
    assert.equal(eventRequiresIntervalLink(AttendanceEventKind.clock_out), true);
    // Compare scalar values.
    assert.equal(
      // Invoke eventRequiresIntervalLink.
      eventRequiresIntervalLink(AttendanceEventKind.break_start),
      false,
    );
  });

  // Test case: does not flag skew just under 1800s.
  it("does not flag skew just under 1800s", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
          // Set clockSkewSeconds.
          clockSkewSeconds: 1799,
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out1",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.closed);
    // Require truthy condition.
    assert.ok(!drafts[0]!.anomalyFlags.includes("large_clock_skew"));
  });

  // Test case: flags large_clock_skew at exactly 1800s.
  it("flags large_clock_skew at exactly 1800s", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
          // Set clockSkewSeconds.
          clockSkewSeconds: 1800,
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out1",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Require truthy condition.
    assert.ok(drafts[0]!.anomalyFlags.includes("large_clock_skew"));
    // Compare scalar values.
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
  });

  // Test case: flags large_clock_skew for negative skew at -1800.
  it("flags large_clock_skew for negative skew at -1800", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
          // Set clockSkewSeconds.
          clockSkewSeconds: -1800,
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out1",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Require truthy condition.
    assert.ok(drafts[0]!.anomalyFlags.includes("large_clock_skew"));
    // Compare scalar values.
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
  });

  // Test case: propagates skew from break events while open.
  it("propagates skew from break events while open", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "bs",
          // Set kind.
          kind: AttendanceEventKind.break_start,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T12:00:00.000Z"),
          // Set clockSkewSeconds.
          clockSkewSeconds: 1800,
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "be",
          // Set kind.
          kind: AttendanceEventKind.break_end,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T12:30:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out1",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Require truthy condition.
    assert.ok(drafts[0]!.anomalyFlags.includes("large_clock_skew"));
    // Compare scalar values.
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
  });

  // Test case: merges skew from duplicate clock_in into closed interval.
  it("merges skew from duplicate clock_in into closed interval", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "in2",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T09:00:00.000Z"),
          // Set clockSkewSeconds.
          clockSkewSeconds: 1800,
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out1",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Require truthy condition.
    assert.ok(drafts[0]!.anomalyFlags.includes("duplicate_kind"));
    // Require truthy condition.
    assert.ok(drafts[0]!.anomalyFlags.includes("large_clock_skew"));
    // Compare scalar values.
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
  });

  // Test case: does not flag absurd_duration at exactly 16 hours.
  it("does not flag absurd_duration at exactly 16 hours", () => {
    // Date start for window math.
    const start = new Date("2026-10-06T08:00:00.000Z");
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Set normalizedTime.
          normalizedTime: start,
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out1",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date(start.getTime() + 16 * 3600_000),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Require truthy condition.
    assert.ok(!drafts[0]!.anomalyFlags.includes("absurd_duration"));
    // Compare scalar values.
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.closed);
  });

  // Test case: flags absurd_duration just over 16 hours.
  it("flags absurd_duration just over 16 hours", () => {
    // Date start for window math.
    const start = new Date("2026-10-06T08:00:00.000Z");
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Set normalizedTime.
          normalizedTime: start,
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out1",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date(start.getTime() + 16 * 3600_000 + 1),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Require truthy condition.
    assert.ok(drafts[0]!.anomalyFlags.includes("absurd_duration"));
    // Compare scalar values.
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
  });

  // Test case: flags absurd_duration when clock_out precedes clock_in.
  it("flags absurd_duration when clock_out precedes clock_in", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out1",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Require truthy condition.
    assert.ok(drafts[0]!.anomalyFlags.includes("absurd_duration"));
    // Compare scalar values.
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
  });

  // Test case: open interval has null workedMinutes.
  it("open interval has null workedMinutes", () => {
    // Date startedAt for window math.
    const startedAt = new Date("2026-10-06T08:00:00.000Z");
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Set normalizedTime.
          normalizedTime: startedAt,
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
      // Compute now for the payload.
      now: new Date(startedAt.getTime() + 3600_000),
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.endedAt, null);
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, null);
  });

  // Test case: sums multiple break pairs in the window.
  it("sums multiple break pairs in the window", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "bs1",
          // Set kind.
          kind: AttendanceEventKind.break_start,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T10:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "be1",
          // Set kind.
          kind: AttendanceEventKind.break_end,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T10:15:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "bs2",
          // Set kind.
          kind: AttendanceEventKind.break_start,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T13:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "be2",
          // Set kind.
          kind: AttendanceEventKind.break_end,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T13:15:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out1",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.breakMinutes, 30);
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, 450);
  });

  // Test case: ignores break_end without break_start.
  it("ignores break_end without break_start", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "be",
          // Set kind.
          kind: AttendanceEventKind.break_end,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T12:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out1",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.breakMinutes, 0);
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, 480);
  });

  // Test case: ignores unfinished break_start.
  it("ignores unfinished break_start", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "in1",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "bs",
          // Set kind.
          kind: AttendanceEventKind.break_start,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T12:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "out1",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.breakMinutes, 0);
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, 480);
  });
});

// Test suite: computeWorkedMinutes.
describe("computeWorkedMinutes", () => {
  // Date start for window math.
  const start = new Date("2026-10-08T08:00:00.000Z");

  // Test case: returns null when endedAt is null.
  it("returns null when endedAt is null", () => {
    // Compare scalar values.
    assert.equal(computeWorkedMinutes(start, null, 999), null);
  });

  // Test case: subtracts break from rounded span.
  it("subtracts break from rounded span", () => {
    // Date end for window math.
    const end = new Date("2026-10-08T16:00:00.000Z");
    // Compare scalar values.
    assert.equal(computeWorkedMinutes(start, end, 30), 450);
  });

  // Test case: clamps to zero when break exceeds span.
  it("clamps to zero when break exceeds span", () => {
    // Date end for window math.
    const end = new Date("2026-10-08T09:00:00.000Z");
    // Compare scalar values.
    assert.equal(computeWorkedMinutes(start, end, 90), 0);
  });

  // Test case: rounds fractional minutes via Math.round.
  it("rounds fractional minutes via Math.round", () => {
    // Date end for window math.
    const end = new Date(start.getTime() + 90_000);
    // Compare scalar values.
    assert.equal(computeWorkedMinutes(start, end, 0), 2);
  });

  // Test case: allows zero-length span to yield zero.
  it("allows zero-length span to yield zero", () => {
    // Compare scalar values.
    assert.equal(computeWorkedMinutes(start, start, 0), 0);
  });
});

// Test suite: uniqueFlags.
describe("uniqueFlags", () => {
  // Test case: dedupes while preserving first-seen order.
  it("dedupes while preserving first-seen order", () => {
    // Deep-compare structures.
    assert.deepEqual(uniqueFlags(["overlap", "missing_end", "overlap"]), [
      "overlap",
      "missing_end",
    ]);
  });

  // Test case: returns empty array for empty input.
  it("returns empty array for empty input", () => {
    // Deep-compare structures.
    assert.deepEqual(uniqueFlags([]), []);
  });

  // Test case: leaves already-unique flags unchanged.
  it("leaves already-unique flags unchanged", () => {
    // Deep-compare structures.
    assert.deepEqual(uniqueFlags(["absurd_duration", "large_clock_skew"]), [
      "absurd_duration",
      "large_clock_skew",
    ]);
  });
});

// Test suite: attendance pairing DST windows.
describe("attendance pairing DST windows", () => {
  // Test case: spring-forward Sofia DST window yields workedMinutes 420.
  it("spring-forward Sofia DST window yields workedMinutes 420", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "spr-in",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-03-28T20:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "spr-out",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-03-29T03:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "Europe/Sofia",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, 420);
    // Compare scalar values.
    assert.equal(
      // Support the surrounding control flow.
      drafts[0]!.hotelDate.toISOString().slice(0, 10),
      "2026-03-28",
    );
  });

  // Test case: fall-back Sofia DST window yields workedMinutes 540.
  it("fall-back Sofia DST window yields workedMinutes 540", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({
          // Set id.
          id: "fall-in",
          // Set kind.
          kind: AttendanceEventKind.clock_in,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-24T19:00:00.000Z"),
        }),
        // Invoke ev.
        ev({
          // Set id.
          id: "fall-out",
          // Set kind.
          kind: AttendanceEventKind.clock_out,
          // Compute normalizedTime for the payload.
          normalizedTime: new Date("2026-10-25T04:00:00.000Z"),
        }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "Europe/Sofia",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, 540);
    // Compare scalar values.
    assert.equal(
      // Support the surrounding control flow.
      drafts[0]!.hotelDate.toISOString().slice(0, 10),
      "2026-10-24",
    );
  });
});

// Test suite: attendance date-only helpers.
describe("attendance date-only helpers", () => {
  // Test case: adds and subtracts calendar days across month and leap-day boundaries.
  it("adds and subtracts calendar days across month and leap-day boundaries", () => {
    // Compare scalar values.
    assert.equal(addDaysYmd("2024-02-28", 1), "2024-02-29");
    // Compare scalar values.
    assert.equal(addDaysYmd("2024-02-29", 1), "2024-03-01");
    // Compare scalar values.
    assert.equal(addDaysYmd("2026-03-01", -1), "2026-02-28");
  });

  // Test case: stores a hotel date key at UTC midnight.
  it("stores a hotel date key at UTC midnight", () => {
    // Compare scalar values.
    assert.equal(hotelDateKey("2026-10-08").getTime(), Date.UTC(2026, 9, 8));
  });
});

// Test suite: attendance event and window boundaries.
describe("attendance event and window boundaries", () => {
  // Test case: sorts break events by time before pairing regardless of input order.
  it("sorts break events by time before pairing regardless of input order", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({ id: "in", kind: AttendanceEventKind.clock_in, normalizedTime: new Date("2026-10-06T08:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "break-end", kind: AttendanceEventKind.break_end, normalizedTime: new Date("2026-10-06T12:30:00.000Z") }),
        // Invoke ev.
        ev({ id: "break-start", kind: AttendanceEventKind.break_start, normalizedTime: new Date("2026-10-06T12:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "out", kind: AttendanceEventKind.clock_out, normalizedTime: new Date("2026-10-06T16:00:00.000Z") }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.breakMinutes, 30);
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, 450);
  });

  // Test case: does not count breaks that begin before and end after a closed interval.
  it("does not count breaks that begin before and end after a closed interval", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({ id: "break-start", kind: AttendanceEventKind.break_start, normalizedTime: new Date("2026-10-06T07:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "in", kind: AttendanceEventKind.clock_in, normalizedTime: new Date("2026-10-06T08:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "out", kind: AttendanceEventKind.clock_out, normalizedTime: new Date("2026-10-06T16:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "break-end", kind: AttendanceEventKind.break_end, normalizedTime: new Date("2026-10-06T17:00:00.000Z") }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts[0]!.breakMinutes, 0);
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, 480);
  });

  // Test case: does not treat a clock-out at the exact clock-in instant as out-before-in.
  it("does not treat a clock-out at the exact clock-in instant as out-before-in", () => {
    // Date at for window math.
    const at = new Date("2026-10-06T08:00:00.000Z");
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({ id: "in", kind: AttendanceEventKind.clock_in, normalizedTime: at }),
        // Invoke ev.
        ev({ id: "out", kind: AttendanceEventKind.clock_out, normalizedTime: at }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.closed);
    // Require truthy condition.
    assert.ok(!drafts[0]!.anomalyFlags.includes("absurd_duration"));
  });

  // Test case: keeps events before a frozen adjustment window eligible for rebuild.
  it("keeps events before a frozen adjustment window eligible for rebuild", () => {
    // Date frozenStart for window math.
    const frozenStart = new Date("2026-10-06T10:00:00.000Z").getTime();
    // Date frozenEnd for window math.
    const frozenEnd = new Date("2026-10-06T12:00:00.000Z").getTime();
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({ id: "in", kind: AttendanceEventKind.clock_in, normalizedTime: new Date("2026-10-06T08:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "out", kind: AttendanceEventKind.clock_out, normalizedTime: new Date("2026-10-06T09:00:00.000Z") }),
      ],
      // Set frozen.
      frozen: [{ startMs: frozenStart, endMs: frozenEnd }],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.startEventId, "in");
    // Compare scalar values.
    assert.equal(drafts[0]!.endEventId, "out");
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, 60);
  });
});

// Test suite: attendance break interval boundaries.
describe("attendance break interval boundaries", () => {
  // Test case: excludes break pairs that straddle either closed shift boundary.
  it("excludes break pairs that straddle either closed shift boundary", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({ id: "early-break-start", kind: AttendanceEventKind.break_start, normalizedTime: new Date("2026-10-06T07:30:00.000Z") }),
        // Invoke ev.
        ev({ id: "in", kind: AttendanceEventKind.clock_in, normalizedTime: new Date("2026-10-06T08:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "early-break-end", kind: AttendanceEventKind.break_end, normalizedTime: new Date("2026-10-06T08:30:00.000Z") }),
        // Invoke ev.
        ev({ id: "late-break-start", kind: AttendanceEventKind.break_start, normalizedTime: new Date("2026-10-06T15:30:00.000Z") }),
        // Invoke ev.
        ev({ id: "out", kind: AttendanceEventKind.clock_out, normalizedTime: new Date("2026-10-06T16:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "late-break-end", kind: AttendanceEventKind.break_end, normalizedTime: new Date("2026-10-06T17:00:00.000Z") }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.breakMinutes, 0);
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, 480);
  });

  // Test case: does not include a break that started before an open shift.
  it("does not include a break that started before an open shift", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({ id: "break-start", kind: AttendanceEventKind.break_start, normalizedTime: new Date("2026-10-06T07:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "in", kind: AttendanceEventKind.clock_in, normalizedTime: new Date("2026-10-06T08:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "break-end", kind: AttendanceEventKind.break_end, normalizedTime: new Date("2026-10-06T09:00:00.000Z") }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
      // Compute now for the payload.
      now: new Date("2026-10-06T10:00:00.000Z"),
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.endedAt, null);
    // Compare scalar values.
    assert.equal(drafts[0]!.breakMinutes, 0);
  });
});

// Test suite: attendance window inclusivity.
describe("attendance window inclusivity", () => {
  // Test case: counts breaks that start at clock-in and end at clock-out boundaries.
  it("counts breaks that start at clock-in and end at clock-out boundaries", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({ id: "in", kind: AttendanceEventKind.clock_in, normalizedTime: new Date("2026-10-06T08:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "start-at-in", kind: AttendanceEventKind.break_start, normalizedTime: new Date("2026-10-06T08:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "end-inside", kind: AttendanceEventKind.break_end, normalizedTime: new Date("2026-10-06T08:30:00.000Z") }),
        // Invoke ev.
        ev({ id: "start-inside", kind: AttendanceEventKind.break_start, normalizedTime: new Date("2026-10-06T15:30:00.000Z") }),
        // Invoke ev.
        ev({ id: "out", kind: AttendanceEventKind.clock_out, normalizedTime: new Date("2026-10-06T16:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "end-at-out", kind: AttendanceEventKind.break_end, normalizedTime: new Date("2026-10-06T16:00:00.000Z") }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.breakMinutes, 60);
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, 420);
  });

  // Test case: counts an open-shift break beginning at clock-in.
  it("counts an open-shift break beginning at clock-in", () => {
    // Local drafts used below.
    const drafts = pairEventsToIntervalDrafts({
      // Set events.
      events: [
        // Invoke ev.
        ev({ id: "in", kind: AttendanceEventKind.clock_in, normalizedTime: new Date("2026-10-06T08:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "start-at-in", kind: AttendanceEventKind.break_start, normalizedTime: new Date("2026-10-06T08:00:00.000Z") }),
        // Invoke ev.
        ev({ id: "break-end", kind: AttendanceEventKind.break_end, normalizedTime: new Date("2026-10-06T08:30:00.000Z") }),
      ],
      // Set frozen.
      frozen: [],
      // Set timeZone.
      timeZone: "UTC",
      // Compute now for the payload.
      now: new Date("2026-10-06T10:00:00.000Z"),
    });
    // Compare scalar values.
    assert.equal(drafts.length, 1);
    // Compare scalar values.
    assert.equal(drafts[0]!.endedAt, null);
    // Compare scalar values.
    assert.equal(drafts[0]!.breakMinutes, 30);
    // Compare scalar values.
    assert.equal(drafts[0]!.workedMinutes, null);
  });
});
