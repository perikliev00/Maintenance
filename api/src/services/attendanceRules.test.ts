import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AttendanceEventKind, AttendanceIntervalStatus } from "@prisma/client";
import { AppError } from "../errors";
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
} from "./attendanceRules";

describe("assertValidAdjustmentTimes", () => {
  const start = new Date("2026-10-08T08:00:00.000Z");

  it("allows end after start with break within span", () => {
    const end = new Date("2026-10-08T16:00:00.000Z");
    assert.doesNotThrow(() => assertValidAdjustmentTimes(start, end, 30));
    assert.doesNotThrow(() => assertValidAdjustmentTimes(start, end, 480));
  });

  it("skips checks when endedAt is null (open interval)", () => {
    assert.doesNotThrow(() => assertValidAdjustmentTimes(start, null, 999));
  });

  it("rejects end before start", () => {
    const end = new Date("2026-10-08T07:00:00.000Z");
    assert.throws(
      () => assertValidAdjustmentTimes(start, end, 0),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 400 &&
        err.code === "validation" &&
        // Assign err.message.
        err.message === "End must be after start",
    );
  });

  it("rejects end equal to start", () => {
    assert.throws(
      () => assertValidAdjustmentTimes(start, start, 0),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 400 &&
        err.code === "validation" &&
        // Assign err.message.
        err.message === "End must be after start",
    );
  });

  it("rejects break minutes that exceed interval duration", () => {
    const end = new Date("2026-10-08T09:00:00.000Z"); // 60 minutes
    assert.throws(
      () => assertValidAdjustmentTimes(start, end, 61),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 400 &&
        err.code === "validation" &&
        // Assign err.message.
        err.message === "Break minutes exceed interval duration",
    );
  });
});

function ev(
  partial: Partial<RebuildEvent> &
    Pick<RebuildEvent, "id" | "kind" | "normalizedTime">,
): RebuildEvent {
  return {
    // Set clockSkewSeconds.
    clockSkewSeconds: null,
    // Spread additional fields/filters.
    ...partial,
  };
}

describe("attendance ingest rebuild pairing", () => {
  it("pairs clock_in then clock_out into a closed interval", () => {
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.startEventId, "in1");
    assert.equal(drafts[0]!.endEventId, "out1");
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.closed);
    assert.equal(drafts[0]!.workedMinutes, 480);
  });

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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.startEventId, "orphan-in");
    assert.equal(drafts[0]!.endEventId, "out");
    assert.equal(drafts[0]!.workedMinutes, 510);
  });

  it("leaves adjusted (frozen) ranges untouched and skips overlapping events", () => {
    const frozenStart = new Date("2026-10-06T08:00:00.000Z").getTime();
    const frozenEnd = new Date("2026-10-06T12:00:00.000Z").getTime();
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.startEventId, "in2");
    assert.equal(drafts[0]!.endEventId, "out2");
  });

  it("flags duplicate clock_in while open and orphan clock_out", () => {
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
    assert.equal(drafts.length, 2);
    assert.ok(drafts[0]!.anomalyFlags.includes("duplicate_kind"));
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
    assert.ok(drafts[1]!.anomalyFlags.includes("missing_end"));
    assert.equal(drafts[1]!.endEventId, "orphan-out");
  });

  it("keeps open clock_in as open just under OPEN_MISSING_END_HOURS", () => {
    const startedAt = new Date("2026-10-06T08:00:00.000Z");
    const now = new Date(
      startedAt.getTime() + (OPEN_MISSING_END_HOURS * 3600_000 - 1),
    );
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.open);
    assert.ok(!drafts[0]!.anomalyFlags.includes("missing_end"));
  });

  it("flags open clock_in as needs_review at OPEN_MISSING_END_HOURS", () => {
    const startedAt = new Date("2026-10-06T08:00:00.000Z");
    const now = new Date(
      startedAt.getTime() + OPEN_MISSING_END_HOURS * 3600_000,
    );
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
    assert.ok(drafts[0]!.anomalyFlags.includes("missing_end"));
  });

  it("flags open clock_in as needs_review past OPEN_MISSING_END_HOURS", () => {
    const startedAt = new Date("2026-10-06T08:00:00.000Z");
    const now = new Date(
      startedAt.getTime() + (OPEN_MISSING_END_HOURS + 6.5) * 3600_000,
    );
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
    assert.ok(drafts[0]!.anomalyFlags.includes("missing_end"));
  });

  it("counts breaks inside an interval window", () => {
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.breakMinutes, 30);
    assert.equal(drafts[0]!.workedMinutes, 450);
  });

  it("marks clock kinds as start/end links (breaks attach by time window)", () => {
    // Heal-on-retry rebuilds whenever findIntervalForEvent returns null for
    // any kind; this helper only documents pairing roles.
    assert.equal(eventRequiresIntervalLink(AttendanceEventKind.clock_in), true);
    assert.equal(eventRequiresIntervalLink(AttendanceEventKind.clock_out), true);
    assert.equal(
      // Invoke eventRequiresIntervalLink.
      eventRequiresIntervalLink(AttendanceEventKind.break_start),
      false,
    );
  });

  it("does not flag skew just under 1800s", () => {
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.closed);
    assert.ok(!drafts[0]!.anomalyFlags.includes("large_clock_skew"));
  });

  it("flags large_clock_skew at exactly 1800s", () => {
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
    assert.equal(drafts.length, 1);
    assert.ok(drafts[0]!.anomalyFlags.includes("large_clock_skew"));
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
  });

  it("flags large_clock_skew for negative skew at -1800", () => {
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
    assert.equal(drafts.length, 1);
    assert.ok(drafts[0]!.anomalyFlags.includes("large_clock_skew"));
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
  });

  it("propagates skew from break events while open", () => {
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
    assert.equal(drafts.length, 1);
    assert.ok(drafts[0]!.anomalyFlags.includes("large_clock_skew"));
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
  });

  it("merges skew from duplicate clock_in into closed interval", () => {
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
    assert.equal(drafts.length, 1);
    assert.ok(drafts[0]!.anomalyFlags.includes("duplicate_kind"));
    assert.ok(drafts[0]!.anomalyFlags.includes("large_clock_skew"));
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
  });

  it("does not flag absurd_duration at exactly 16 hours", () => {
    const start = new Date("2026-10-06T08:00:00.000Z");
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
    assert.equal(drafts.length, 1);
    assert.ok(!drafts[0]!.anomalyFlags.includes("absurd_duration"));
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.closed);
  });

  it("flags absurd_duration just over 16 hours", () => {
    const start = new Date("2026-10-06T08:00:00.000Z");
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
    assert.equal(drafts.length, 1);
    assert.ok(drafts[0]!.anomalyFlags.includes("absurd_duration"));
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
  });

  it("flags absurd_duration when clock_out precedes clock_in", () => {
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
    assert.equal(drafts.length, 1);
    assert.ok(drafts[0]!.anomalyFlags.includes("absurd_duration"));
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
  });

  it("open interval has null workedMinutes", () => {
    const startedAt = new Date("2026-10-06T08:00:00.000Z");
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.endedAt, null);
    assert.equal(drafts[0]!.workedMinutes, null);
  });

  it("sums multiple break pairs in the window", () => {
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.breakMinutes, 30);
    assert.equal(drafts[0]!.workedMinutes, 450);
  });

  it("ignores break_end without break_start", () => {
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.breakMinutes, 0);
    assert.equal(drafts[0]!.workedMinutes, 480);
  });

  it("ignores unfinished break_start", () => {
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.breakMinutes, 0);
    assert.equal(drafts[0]!.workedMinutes, 480);
  });
});

describe("computeWorkedMinutes", () => {
  const start = new Date("2026-10-08T08:00:00.000Z");

  it("returns null when endedAt is null", () => {
    assert.equal(computeWorkedMinutes(start, null, 999), null);
  });

  it("subtracts break from rounded span", () => {
    const end = new Date("2026-10-08T16:00:00.000Z");
    assert.equal(computeWorkedMinutes(start, end, 30), 450);
  });

  it("clamps to zero when break exceeds span", () => {
    const end = new Date("2026-10-08T09:00:00.000Z");
    assert.equal(computeWorkedMinutes(start, end, 90), 0);
  });

  it("rounds fractional minutes via Math.round", () => {
    const end = new Date(start.getTime() + 90_000);
    assert.equal(computeWorkedMinutes(start, end, 0), 2);
  });

  it("allows zero-length span to yield zero", () => {
    assert.equal(computeWorkedMinutes(start, start, 0), 0);
  });
});

describe("uniqueFlags", () => {
  it("dedupes while preserving first-seen order", () => {
    assert.deepEqual(uniqueFlags(["overlap", "missing_end", "overlap"]), [
      "overlap",
      "missing_end",
    ]);
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(uniqueFlags([]), []);
  });

  it("leaves already-unique flags unchanged", () => {
    assert.deepEqual(uniqueFlags(["absurd_duration", "large_clock_skew"]), [
      "absurd_duration",
      "large_clock_skew",
    ]);
  });
});

describe("attendance pairing DST windows", () => {
  it("spring-forward Sofia DST window yields workedMinutes 420", () => {
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.workedMinutes, 420);
    assert.equal(
      drafts[0]!.hotelDate.toISOString().slice(0, 10),
      "2026-03-28",
    );
  });

  it("fall-back Sofia DST window yields workedMinutes 540", () => {
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.workedMinutes, 540);
    assert.equal(
      drafts[0]!.hotelDate.toISOString().slice(0, 10),
      "2026-10-24",
    );
  });
});

describe("attendance date-only helpers", () => {
  it("adds and subtracts calendar days across month and leap-day boundaries", () => {
    assert.equal(addDaysYmd("2024-02-28", 1), "2024-02-29");
    assert.equal(addDaysYmd("2024-02-29", 1), "2024-03-01");
    assert.equal(addDaysYmd("2026-03-01", -1), "2026-02-28");
  });

  it("stores a hotel date key at UTC midnight", () => {
    assert.equal(hotelDateKey("2026-10-08").getTime(), Date.UTC(2026, 9, 8));
  });
});

describe("attendance event and window boundaries", () => {
  it("sorts break events by time before pairing regardless of input order", () => {
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.breakMinutes, 30);
    assert.equal(drafts[0]!.workedMinutes, 450);
  });

  it("does not count breaks that begin before and end after a closed interval", () => {
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
    assert.equal(drafts[0]!.breakMinutes, 0);
    assert.equal(drafts[0]!.workedMinutes, 480);
  });

  it("does not treat a clock-out at the exact clock-in instant as out-before-in", () => {
    const at = new Date("2026-10-06T08:00:00.000Z");
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.closed);
    assert.ok(!drafts[0]!.anomalyFlags.includes("absurd_duration"));
  });

  it("keeps events before a frozen adjustment window eligible for rebuild", () => {
    const frozenStart = new Date("2026-10-06T10:00:00.000Z").getTime();
    const frozenEnd = new Date("2026-10-06T12:00:00.000Z").getTime();
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.startEventId, "in");
    assert.equal(drafts[0]!.endEventId, "out");
    assert.equal(drafts[0]!.workedMinutes, 60);
  });
});

describe("attendance break interval boundaries", () => {
  it("excludes break pairs that straddle either closed shift boundary", () => {
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.breakMinutes, 0);
    assert.equal(drafts[0]!.workedMinutes, 480);
  });

  it("does not include a break that started before an open shift", () => {
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.endedAt, null);
    assert.equal(drafts[0]!.breakMinutes, 0);
  });
});

describe("attendance window inclusivity", () => {
  it("counts breaks that start at clock-in and end at clock-out boundaries", () => {
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.breakMinutes, 60);
    assert.equal(drafts[0]!.workedMinutes, 420);
  });

  it("counts an open-shift break beginning at clock-in", () => {
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
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.endedAt, null);
    assert.equal(drafts[0]!.breakMinutes, 30);
    assert.equal(drafts[0]!.workedMinutes, null);
  });
});
