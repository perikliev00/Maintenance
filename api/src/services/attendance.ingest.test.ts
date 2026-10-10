import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AttendanceEventKind, AttendanceIntervalStatus } from "@prisma/client";
import {
  decodeIntervalCursor,
  drainExportPages,
  encodeIntervalCursor,
  eventRequiresIntervalLink,
  EXPORT_BATCH,
  EXPORT_CEILING,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  listPageFromRows,
  OPEN_MISSING_END_HOURS,
  pairEventsToIntervalDrafts,
  resolveListLimit,
  type IntervalCursor,
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
      timeZone: "UTC",
    });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.startEventId, "in2");
    assert.equal(drafts[0]!.endEventId, "out2");
  });

  it("flags duplicate clock_in while open and orphan clock_out", () => {
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
      events: [
        ev({
          id: "in1",
          kind: AttendanceEventKind.clock_in,
          normalizedTime: startedAt,
        }),
      ],
      frozen: [],
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
      events: [
        ev({
          id: "in1",
          kind: AttendanceEventKind.clock_in,
          normalizedTime: startedAt,
        }),
      ],
      frozen: [],
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
      events: [
        ev({
          id: "in1",
          kind: AttendanceEventKind.clock_in,
          normalizedTime: startedAt,
        }),
      ],
      frozen: [],
      timeZone: "UTC",
      now,
    });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]!.status, AttendanceIntervalStatus.needs_review);
    assert.ok(drafts[0]!.anomalyFlags.includes("missing_end"));
  });

  it("counts breaks inside an interval window", () => {
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

type FakeRow = { id: string; hotelDate: string; startedAt: string };

function fakeRows(n: number): FakeRow[] {
  // Sorted desc by hotelDate, startedAt, id — same order as listIntervals.
  const rows: FakeRow[] = [];
  for (let i = 0; i < n; i++) {
    const day = 30 - Math.floor(i / 24);
    const hour = 23 - (i % 24);
    const hotelDate = `2026-10-${String(Math.max(1, day)).padStart(2, "0")}`;
    rows.push({
      id: `id-${String(n - i).padStart(4, "0")}`,
      hotelDate,
      startedAt: `${hotelDate}T${String(hour).padStart(2, "0")}:00:00.000Z`,
    });
  }
  return rows;
}

function toCursor(row: FakeRow): IntervalCursor {
  return {
    hotelDate: row.hotelDate,
    startedAt: row.startedAt,
    id: row.id,
  };
}

/** Rows strictly after `cursor` in desc (hotelDate, startedAt, id) order. */
function afterCursor(rows: FakeRow[], cursor: IntervalCursor | null): FakeRow[] {
  if (!cursor) return rows;
  return rows.filter((r) => {
    if (r.hotelDate < cursor.hotelDate) return true;
    if (r.hotelDate > cursor.hotelDate) return false;
    if (r.startedAt < cursor.startedAt) return true;
    if (r.startedAt > cursor.startedAt) return false;
    return r.id < cursor.id;
  });
}

describe("attendance list pagination contract", () => {
  it("clamps list limit to LIST_MAX_LIMIT (not a silent total cap)", () => {
    assert.equal(resolveListLimit(undefined), LIST_DEFAULT_LIMIT);
    assert.equal(resolveListLimit(1), 1);
    assert.equal(resolveListLimit(LIST_MAX_LIMIT), LIST_MAX_LIMIT);
    assert.equal(resolveListLimit(LIST_MAX_LIMIT + 100), LIST_MAX_LIMIT);
    assert.equal(LIST_MAX_LIMIT, 500);
  });

  it("pages 601 rows with limit 200: total known, no duplicates, full drain", () => {
    const total = 601;
    const limit = 200;
    const all = fakeRows(total);
    const seen = new Set<string>();
    let cursor: string | null = null;
    let loaded = 0;

    for (let page = 0; page < 10; page++) {
      const decoded: IntervalCursor | null = cursor
        ? decodeIntervalCursor(cursor)
        : null;
      const window: FakeRow[] = afterCursor(all, decoded).slice(0, limit + 1);
      const { pageRows, nextCursor }: {
        pageRows: FakeRow[];
        nextCursor: string | null;
      } = listPageFromRows(window, limit, toCursor);
      assert.equal(pageRows.length, Math.min(limit, total - loaded));
      for (const row of pageRows) {
        assert.equal(seen.has(row.id), false, `duplicate ${row.id}`);
        seen.add(row.id);
      }
      loaded += pageRows.length;
      cursor = nextCursor;
      if (!nextCursor) break;
    }

    assert.equal(loaded, total);
    assert.equal(seen.size, total);
    assert.equal(cursor, null);
  });

  it("first page of 601 with limit 500 exposes nextCursor (no silent drop)", () => {
    const total = 601;
    const limit = LIST_MAX_LIMIT;
    const all = fakeRows(total);
    const window = all.slice(0, limit + 1);
    const { pageRows, nextCursor } = listPageFromRows(window, limit, toCursor);
    assert.equal(pageRows.length, 500);
    assert.ok(nextCursor);
    const rest = afterCursor(all, decodeIntervalCursor(nextCursor!));
    assert.equal(rest.length, 101);
  });
});

describe("attendance export batch drain", () => {
  it("drains all rows across batches (covers former take:500 export bug)", async () => {
    const total = 601;
    const batchSize = 100;
    const all = fakeRows(total);
    let fetchCount = 0;

    const { rows, truncated } = await drainExportPages({
      batchSize,
      ceiling: EXPORT_CEILING,
      toCursor,
      fetchPage: async (cursor) => {
        fetchCount += 1;
        return afterCursor(all, cursor).slice(0, batchSize);
      },
    });

    assert.equal(truncated, false);
    assert.equal(rows.length, total);
    assert.equal(fetchCount, Math.ceil(total / batchSize));
    assert.ok(EXPORT_BATCH >= 1000);
  });

  it("marks truncated when ceiling is hit mid-drain", async () => {
    const all = fakeRows(250);
    const { rows, truncated } = await drainExportPages({
      batchSize: 100,
      ceiling: 150,
      toCursor,
      fetchPage: async (cursor) => afterCursor(all, cursor).slice(0, 100),
    });
    assert.equal(truncated, true);
    assert.equal(rows.length, 150);
  });
});
