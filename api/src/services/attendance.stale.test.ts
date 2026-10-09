import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AttendanceIntervalStatus } from "@prisma/client";
import {
  claimStaleOpenInterval,
  OPEN_MISSING_END_HOURS,
  type StaleOpenClaimDb,
} from "./attendance";

type Row = {
  status: AttendanceIntervalStatus;
  endedAt: Date | null;
  startedAt: Date;
  anomalyFlags: string[];
};

function makeFakeDb(initial: Row | null) {
  let row = initial ? { ...initial, anomalyFlags: [...initial.anomalyFlags] } : null;
  let updateCalls = 0;
  let lastUpdateData: {
    status: AttendanceIntervalStatus;
    anomalyFlags: string[];
  } | null = null;

  const db: StaleOpenClaimDb = {
    attendanceInterval: {
      async findUnique() {
        if (!row) return null;
        return {
          status: row.status,
          endedAt: row.endedAt,
          startedAt: row.startedAt,
          anomalyFlags: [...row.anomalyFlags],
        };
      },
      async updateMany({ where, data }) {
        updateCalls += 1;
        if (
          !row ||
          row.status !== where.status ||
          row.endedAt !== where.endedAt ||
          row.startedAt.getTime() > where.startedAt.lte.getTime()
        ) {
          return { count: 0 };
        }
        row = {
          ...row,
          status: data.status,
          anomalyFlags: [...data.anomalyFlags],
        };
        lastUpdateData = {
          status: data.status,
          anomalyFlags: [...data.anomalyFlags],
        };
        return { count: 1 };
      },
    },
  };

  return {
    db,
    get row() {
      return row;
    },
    get updateCalls() {
      return updateCalls;
    },
    get lastUpdateData() {
      return lastUpdateData;
    },
    /** Simulate concurrent approval closing the interval after findUnique. */
    becomeAdjustedAfterRead() {
      const originalFind = db.attendanceInterval.findUnique;
      db.attendanceInterval.findUnique = async (args) => {
        const current = await originalFind(args);
        row = {
          status: AttendanceIntervalStatus.adjusted,
          endedAt: new Date("2026-10-08T16:00:00.000Z"),
          startedAt: new Date("2026-10-08T08:00:00.000Z"),
          anomalyFlags: [],
        };
        return current;
      };
    },
  };
}

describe("claimStaleOpenInterval", () => {
  const now = new Date("2026-10-09T12:00:00.000Z");
  const cutoff = new Date(
    now.getTime() - OPEN_MISSING_END_HOURS * 3600_000,
  );
  const staleStart = new Date(cutoff.getTime() - 3600_000);

  it("does not overwrite an interval adjusted after the job selected it", async () => {
    const fake = makeFakeDb({
      status: AttendanceIntervalStatus.open,
      endedAt: null,
      startedAt: staleStart,
      anomalyFlags: ["large_clock_skew"],
    });
    fake.becomeAdjustedAfterRead();

    const claimed = await claimStaleOpenInterval(fake.db, "int-1", cutoff);

    assert.equal(claimed, false);
    assert.equal(fake.updateCalls, 1);
    assert.equal(fake.row?.status, AttendanceIntervalStatus.adjusted);
    assert.equal(fake.row?.endedAt?.toISOString(), "2026-10-08T16:00:00.000Z");
    assert.deepEqual(fake.row?.anomalyFlags, []);
    assert.ok(!fake.row?.anomalyFlags.includes("missing_end"));
  });

  it("flags a truly stale open interval for review and preserves other flags", async () => {
    const fake = makeFakeDb({
      status: AttendanceIntervalStatus.open,
      endedAt: null,
      startedAt: staleStart,
      anomalyFlags: ["large_clock_skew"],
    });

    const claimed = await claimStaleOpenInterval(fake.db, "int-1", cutoff);

    assert.equal(claimed, true);
    assert.equal(fake.row?.status, AttendanceIntervalStatus.needs_review);
    assert.deepEqual(fake.row?.anomalyFlags, [
      "large_clock_skew",
      "missing_end",
    ]);
    assert.deepEqual(fake.lastUpdateData?.anomalyFlags, [
      "large_clock_skew",
      "missing_end",
    ]);
  });

  it("leaves a meanwhile-closed interval unchanged", async () => {
    const fake = makeFakeDb({
      status: AttendanceIntervalStatus.closed,
      endedAt: new Date("2026-10-08T17:00:00.000Z"),
      startedAt: staleStart,
      anomalyFlags: ["large_clock_skew"],
    });

    const claimed = await claimStaleOpenInterval(fake.db, "int-1", cutoff);

    assert.equal(claimed, false);
    assert.equal(fake.updateCalls, 0);
    assert.equal(fake.row?.status, AttendanceIntervalStatus.closed);
    assert.deepEqual(fake.row?.anomalyFlags, ["large_clock_skew"]);
  });

  it("is idempotent on re-run and concurrent second claim loses", async () => {
    const fake = makeFakeDb({
      status: AttendanceIntervalStatus.open,
      endedAt: null,
      startedAt: staleStart,
      anomalyFlags: [],
    });

    const first = await claimStaleOpenInterval(fake.db, "int-1", cutoff);
    assert.equal(first, true);
    assert.equal(fake.row?.status, AttendanceIntervalStatus.needs_review);

    const second = await claimStaleOpenInterval(fake.db, "int-1", cutoff);
    assert.equal(second, false);
    assert.equal(fake.row?.status, AttendanceIntervalStatus.needs_review);
    assert.deepEqual(fake.row?.anomalyFlags, ["missing_end"]);

    // Concurrent loser: read still sees open, but updateMany where fails.
    const concurrent = makeFakeDb({
      status: AttendanceIntervalStatus.open,
      endedAt: null,
      startedAt: staleStart,
      anomalyFlags: ["overlap"],
    });
    concurrent.db.attendanceInterval.updateMany = async () => ({ count: 0 });
    const lost = await claimStaleOpenInterval(concurrent.db, "int-2", cutoff);
    assert.equal(lost, false);
    assert.deepEqual(concurrent.row?.anomalyFlags, ["overlap"]);
    assert.equal(concurrent.row?.status, AttendanceIntervalStatus.open);
  });

  it("skips open intervals that are still within the threshold", async () => {
    const fake = makeFakeDb({
      status: AttendanceIntervalStatus.open,
      endedAt: null,
      startedAt: new Date(cutoff.getTime() + 60_000),
      anomalyFlags: [],
    });

    const claimed = await claimStaleOpenInterval(fake.db, "int-1", cutoff);

    assert.equal(claimed, false);
    assert.equal(fake.updateCalls, 0);
    assert.equal(fake.row?.status, AttendanceIntervalStatus.open);
  });
});
