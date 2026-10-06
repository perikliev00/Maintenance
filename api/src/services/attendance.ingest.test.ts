import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AttendanceEventKind, AttendanceIntervalStatus } from "@prisma/client";
import {
  decodeIntervalCursor,
  encodeIntervalCursor,
  eventRequiresIntervalLink,
  pairEventsToIntervalDrafts,
  type RebuildEvent,
} from "./attendance";

function ev(
  partial: Partial<RebuildEvent> &
    Pick<RebuildEvent, "id" | "kind" | "normalizedTime">,
): RebuildEvent {
  return {
    clockSkewSeconds: null,
    ...partial,
  };
}

describe("attendance ingest rebuild pairing", () => {
  it("pairs clock_in then clock_out into a closed interval", () => {
    const hotelDate = new Date("2026-10-06T00:00:00.000Z");
    const drafts = pairEventsToIntervalDrafts({
      events: [
        ev({
          id: "in1",
          kind: AttendanceEventKind.clock_in,
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
        }),
        ev({
          id: "out1",
          kind: AttendanceEventKind.clock_out,
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
      ],
      frozen: [],
      hotelDate,
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
    const hotelDate = new Date("2026-10-06T00:00:00.000Z");
    const drafts = pairEventsToIntervalDrafts({
      events: [
        ev({
          id: "orphan-in",
          kind: AttendanceEventKind.clock_in,
          normalizedTime: new Date("2026-10-06T09:00:00.000Z"),
        }),
        ev({
          id: "out",
          kind: AttendanceEventKind.clock_out,
          normalizedTime: new Date("2026-10-06T17:30:00.000Z"),
        }),
      ],
      frozen: [],
      hotelDate,
    });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.startEventId, "orphan-in");
    assert.equal(drafts[0]!.endEventId, "out");
    assert.equal(drafts[0]!.workedMinutes, 510);
  });

  it("leaves adjusted (frozen) ranges untouched and skips overlapping events", () => {
    const hotelDate = new Date("2026-10-06T00:00:00.000Z");
    const frozenStart = new Date("2026-10-06T08:00:00.000Z").getTime();
    const frozenEnd = new Date("2026-10-06T12:00:00.000Z").getTime();
    const drafts = pairEventsToIntervalDrafts({
      events: [
        ev({
          id: "in-frozen",
          kind: AttendanceEventKind.clock_in,
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
        }),
        ev({
          id: "out-frozen",
          kind: AttendanceEventKind.clock_out,
          normalizedTime: new Date("2026-10-06T12:00:00.000Z"),
        }),
        ev({
          id: "in2",
          kind: AttendanceEventKind.clock_in,
          normalizedTime: new Date("2026-10-06T13:00:00.000Z"),
        }),
        ev({
          id: "out2",
          kind: AttendanceEventKind.clock_out,
          normalizedTime: new Date("2026-10-06T17:00:00.000Z"),
        }),
      ],
      frozen: [{ startMs: frozenStart, endMs: frozenEnd }],
      hotelDate,
    });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.startEventId, "in2");
    assert.equal(drafts[0]!.endEventId, "out2");
  });

  it("flags duplicate clock_in while open and orphan clock_out", () => {
    const hotelDate = new Date("2026-10-06T00:00:00.000Z");
    const drafts = pairEventsToIntervalDrafts({
      events: [
        ev({
          id: "in1",
          kind: AttendanceEventKind.clock_in,
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
        }),
        ev({
          id: "in2",
          kind: AttendanceEventKind.clock_in,
          normalizedTime: new Date("2026-10-06T09:00:00.000Z"),
        }),
        ev({
          id: "out1",
          kind: AttendanceEventKind.clock_out,
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
        ev({
          id: "orphan-out",
          kind: AttendanceEventKind.clock_out,
          normalizedTime: new Date("2026-10-06T18:00:00.000Z"),
        }),
      ],
      frozen: [],
      hotelDate,
    });
    assert.equal(drafts.length, 2);
    assert.ok(drafts[0]!.anomalyFlags.includes("duplicate_kind"));
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
    assert.ok(drafts[1]!.anomalyFlags.includes("missing_end"));
    assert.equal(drafts[1]!.endEventId, "orphan-out");
  });

  it("counts breaks inside an interval window", () => {
    const hotelDate = new Date("2026-10-06T00:00:00.000Z");
    const drafts = pairEventsToIntervalDrafts({
      events: [
        ev({
          id: "in1",
          kind: AttendanceEventKind.clock_in,
          normalizedTime: new Date("2026-10-06T08:00:00.000Z"),
        }),
        ev({
          id: "bs",
          kind: AttendanceEventKind.break_start,
          normalizedTime: new Date("2026-10-06T12:00:00.000Z"),
        }),
        ev({
          id: "be",
          kind: AttendanceEventKind.break_end,
          normalizedTime: new Date("2026-10-06T12:30:00.000Z"),
        }),
        ev({
          id: "out1",
          kind: AttendanceEventKind.clock_out,
          normalizedTime: new Date("2026-10-06T16:00:00.000Z"),
        }),
      ],
      frozen: [],
      hotelDate,
    });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.breakMinutes, 30);
    assert.equal(drafts[0]!.workedMinutes, 450);
  });

  it("treats idempotent clock events as needing an interval link", () => {
    assert.equal(eventRequiresIntervalLink(AttendanceEventKind.clock_in), true);
    assert.equal(eventRequiresIntervalLink(AttendanceEventKind.clock_out), true);
    assert.equal(
      eventRequiresIntervalLink(AttendanceEventKind.break_start),
      false,
    );
  });
});

describe("attendance list cursor", () => {
  it("round-trips cursor payload", () => {
    const raw = encodeIntervalCursor({
      hotelDate: "2026-10-06",
      startedAt: "2026-10-06T08:00:00.000Z",
      id: "abc",
    });
    assert.deepEqual(decodeIntervalCursor(raw), {
      hotelDate: "2026-10-06",
      startedAt: "2026-10-06T08:00:00.000Z",
      id: "abc",
    });
  });
});
