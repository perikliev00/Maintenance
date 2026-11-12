// Strict assert helpers for precise test failures.
import assert from "node:assert/strict";
// Node test runner (describe/it/hooks).
import { describe, it } from "node:test";
// Runtime import from ./map.
import { EXPORT_BATCH, EXPORT_CEILING, LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT } from "./map";
// Module import required below.
import {
  decodeIntervalCursor,
  drainExportPages,
  encodeIntervalCursor,
  listPageFromRows,
  resolveListLimit,
  // Type alias IntervalCursor.
  type IntervalCursor,
// Support the surrounding control flow.
} from "./pagination";

// Test suite: attendance list cursor.
describe("attendance list cursor", () => {
  // Test case: round-trips cursor payload.
  it("round-trips cursor payload", () => {
    // Local raw used below.
    const raw = encodeIntervalCursor({
      // Compute hotelDate for the payload.
      hotelDate: "2026-10-06",
      // Set startedAt.
      startedAt: "2026-10-06T08:00:00.000Z",
      // Set id.
      id: "abc",
    });
    // Deep-compare structures.
    assert.deepEqual(decodeIntervalCursor(raw), {
      // Compute hotelDate for the payload.
      hotelDate: "2026-10-06",
      // Set startedAt.
      startedAt: "2026-10-06T08:00:00.000Z",
      // Set id.
      id: "abc",
    });
  });
});

// Type alias FakeRow.
type FakeRow = { id: string; hotelDate: string; startedAt: string };

// Internal helper fakeRows.
function fakeRows(n: number): FakeRow[] {
  // Sorted desc by hotelDate, startedAt, id — same order as listIntervals.
  const rows: FakeRow[] = [];
  // Indexed/looped processing.
  for (let i = 0; i < n; i++) {
    // Derived metric day.
    const day = 30 - Math.floor(i / 24);
    // Local hour used below.
    const hour = 23 - (i % 24);
    // Derived metric hotelDate.
    const hotelDate = `2026-10-${String(Math.max(1, day)).padStart(2, "0")}`;
    // Support the surrounding control flow.
    rows.push({
      // Param id required by this function.
      id: `id-${String(n - i).padStart(4, "0")}`,
      hotelDate,
      // Param startedAt required by this function.
      startedAt: `${hotelDate}T${String(hour).padStart(2, "0")}:00:00.000Z`,
    });
  }
  // Return computed result.
  return rows;
}

// Internal helper toCursor.
function toCursor(row: FakeRow): IntervalCursor {
  // Return response object.
  return {
    // Param hotelDate required by this function.
    hotelDate: row.hotelDate,
    // Param startedAt required by this function.
    startedAt: row.startedAt,
    // Param id required by this function.
    id: row.id,
  };
}

/** Rows strictly after `cursor` in desc (hotelDate, startedAt, id) order. */
function afterCursor(rows: FakeRow[], cursor: IntervalCursor | null): FakeRow[] {
  // Conditional path for this guard.
  if (!cursor) return rows;
  // Return computed result.
  return rows.filter((r) => {
    // Conditional path for this guard.
    if (r.hotelDate < cursor.hotelDate) return true;
    // Conditional path for this guard.
    if (r.hotelDate > cursor.hotelDate) return false;
    // Conditional path for this guard.
    if (r.startedAt < cursor.startedAt) return true;
    // Conditional path for this guard.
    if (r.startedAt > cursor.startedAt) return false;
    // Return computed result.
    return r.id < cursor.id;
  });
}

// Test suite: attendance list pagination contract.
describe("attendance list pagination contract", () => {
  // Test case: clamps list limit to LIST_MAX_LIMIT (not a silent total cap).
  it("clamps list limit to LIST_MAX_LIMIT (not a silent total cap)", () => {
    // Compare scalar values.
    assert.equal(resolveListLimit(undefined), LIST_DEFAULT_LIMIT);
    // Compare scalar values.
    assert.equal(resolveListLimit(1), 1);
    // Compare scalar values.
    assert.equal(resolveListLimit(LIST_MAX_LIMIT), LIST_MAX_LIMIT);
    // Compare scalar values.
    assert.equal(resolveListLimit(LIST_MAX_LIMIT + 100), LIST_MAX_LIMIT);
    // Compare scalar values.
    assert.equal(LIST_MAX_LIMIT, 500);
  });

  // Test case: pages 601 rows with limit 200: total known, no duplicates, full drain.
  it("pages 601 rows with limit 200: total known, no duplicates, full drain", () => {
    // Local total used below.
    const total = 601;
    // Local limit used below.
    const limit = 200;
    // Local all used below.
    const all = fakeRows(total);
    // Set seen for dedupe/membership.
    const seen = new Set<string>();
    // Nullable cursor until resolved.
    let cursor: string | null = null;
    // Counter loaded starts at 0.
    let loaded = 0;

    // Indexed/looped processing.
    for (let page = 0; page < 10; page++) {
      // Local decoded used below.
      const decoded: IntervalCursor | null = cursor
        // Support the surrounding control flow.
        ? decodeIntervalCursor(cursor)
        // Support the surrounding control flow.
        : null;
      // Local window used below.
      const window: FakeRow[] = afterCursor(all, decoded).slice(0, limit + 1);
      // Destructure needed fields only.
      const { pageRows, nextCursor }: {
        // Param pageRows required by this function.
        pageRows: FakeRow[];
        // Param nextCursor required by this function.
        nextCursor: string | null;
      // Support the surrounding control flow.
      } = listPageFromRows(window, limit, toCursor);
      // Compare scalar values.
      assert.equal(pageRows.length, Math.min(limit, total - loaded));
      // Iterate items for aggregation or writes.
      for (const row of pageRows) {
        // Compare scalar values.
        assert.equal(seen.has(row.id), false, `duplicate ${row.id}`);
        // Support the surrounding control flow.
        seen.add(row.id);
      }
      // Assign loaded +.
      loaded += pageRows.length;
      // Assign cursor.
      cursor = nextCursor;
      // Conditional path for this guard.
      if (!nextCursor) break;
    }

    // Compare scalar values.
    assert.equal(loaded, total);
    // Compare scalar values.
    assert.equal(seen.size, total);
    // Compare scalar values.
    assert.equal(cursor, null);
  });

  // Test case: first page of 601 with limit 500 exposes nextCursor (no silent drop).
  it("first page of 601 with limit 500 exposes nextCursor (no silent drop)", () => {
    // Local total used below.
    const total = 601;
    // Local limit used below.
    const limit = LIST_MAX_LIMIT;
    // Local all used below.
    const all = fakeRows(total);
    // Local window used below.
    const window = all.slice(0, limit + 1);
    // Destructure needed fields only.
    const { pageRows, nextCursor } = listPageFromRows(window, limit, toCursor);
    // Compare scalar values.
    assert.equal(pageRows.length, 500);
    // Require truthy condition.
    assert.ok(nextCursor);
    // Local rest used below.
    const rest = afterCursor(all, decodeIntervalCursor(nextCursor!));
    // Compare scalar values.
    assert.equal(rest.length, 101);
  });
});

// Test suite: attendance export batch drain.
describe("attendance export batch drain", () => {
  // Test case: drains all rows across batches (covers former take:500 export bug).
  it("drains all rows across batches (covers former take:500 export bug)", async () => {
    // Local total used below.
    const total = 601;
    // Local batchSize used below.
    const batchSize = 100;
    // Local all used below.
    const all = fakeRows(total);
    // Counter fetchCount starts at 0.
    let fetchCount = 0;

    // Destructure needed fields only.
    const { rows, truncated } = await drainExportPages({
      batchSize,
      // Param ceiling required by this function.
      ceiling: EXPORT_CEILING,
      toCursor,
      // Param fetchPage required by this function.
      fetchPage: async (cursor) => {
        // Assign fetchCount +.
        fetchCount += 1;
        // Return computed result.
        return afterCursor(all, cursor).slice(0, batchSize);
      },
    });

    // Compare scalar values.
    assert.equal(truncated, false);
    // Compare scalar values.
    assert.equal(rows.length, total);
    // Compare scalar values.
    assert.equal(fetchCount, Math.ceil(total / batchSize));
    // Require truthy condition.
    assert.ok(EXPORT_BATCH >= 1000);
  });

  // Test case: marks truncated when ceiling is hit mid-drain.
  it("marks truncated when ceiling is hit mid-drain", async () => {
    // Local all used below.
    const all = fakeRows(250);
    // Destructure needed fields only.
    const { rows, truncated } = await drainExportPages({
      // Param batchSize required by this function.
      batchSize: 100,
      // Param ceiling required by this function.
      ceiling: 150,
      toCursor,
      // Param fetchPage required by this function.
      fetchPage: async (cursor) => afterCursor(all, cursor).slice(0, 100),
    });
    // Compare scalar values.
    assert.equal(truncated, true);
    // Compare scalar values.
    assert.equal(rows.length, 150);
  });
});
