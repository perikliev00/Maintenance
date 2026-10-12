import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXPORT_BATCH, EXPORT_CEILING, LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT } from "./map";
import {
  decodeIntervalCursor,
  drainExportPages,
  encodeIntervalCursor,
  listPageFromRows,
  resolveListLimit,
  type IntervalCursor,
} from "./pagination";

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
