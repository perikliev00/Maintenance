// Strict assert helpers for precise test failures.
import assert from "node:assert/strict";
// Node test runner (describe/it/hooks).
import { describe, it } from "node:test";
// Prisma client enums and input types.
import { AttendanceIntervalStatus } from "@prisma/client";
// Module import required below.
import {
  claimStaleOpenInterval,
  OPEN_MISSING_END_HOURS,
  // Type alias StaleOpenClaimDb.
  type StaleOpenClaimDb,
// Support the surrounding control flow.
} from "./index";

// Type alias Row.
type Row = {
  // Field status on this type/payload.
  status: AttendanceIntervalStatus;
  // Time field endedAt.
  endedAt: Date | null;
  // Time field startedAt.
  startedAt: Date;
  // Field anomalyFlags on this type/payload.
  anomalyFlags: string[];
};

// Internal helper makeFakeDb.
function makeFakeDb(initial: Row | null) {
  // Local row used below.
  let row = initial ? { ...initial, anomalyFlags: [...initial.anomalyFlags] } : null;
  // Counter updateCalls starts at 0.
  let updateCalls = 0;
  // Local lastUpdateData used below.
  let lastUpdateData: {
    // Param status required by this function.
    status: AttendanceIntervalStatus;
    // Param anomalyFlags required by this function.
    anomalyFlags: string[];
  // Support the surrounding control flow.
  } | null = null;

  // Local db used below.
  const db: StaleOpenClaimDb = {
    // Param attendanceInterval required by this function.
    attendanceInterval: {
      // Support the surrounding control flow.
      async findUnique() {
        // Guard missing required data.
        if (!row) return null;
        // Return response object.
        return {
          // Param status required by this function.
          status: row.status,
          // Param endedAt required by this function.
          endedAt: row.endedAt,
          // Param startedAt required by this function.
          startedAt: row.startedAt,
          // Param anomalyFlags required by this function.
          anomalyFlags: [...row.anomalyFlags],
        };
      },
      // Support the surrounding control flow.
      async updateMany({ where, data }) {
        // Assign updateCalls +.
        updateCalls += 1;
        // Conditional path for this guard.
        if (
          // Additional clause in this boolean decision.
          !row ||
          // Additional clause in this boolean decision.
          row.status !== where.status ||
          // Additional clause in this boolean decision.
          row.endedAt !== where.endedAt ||
          // Support the surrounding control flow.
          row.startedAt.getTime() > where.startedAt.lte.getTime()
        ) {
          // Return response object.
          return { count: 0 };
        }
        // Assign row.
        row = {
          // Spread additional fields/filters.
          ...row,
          // Field status on this type/payload.
          status: data.status,
          // Field anomalyFlags on this type/payload.
          anomalyFlags: [...data.anomalyFlags],
        };
        // Assign lastUpdateData.
        lastUpdateData = {
          // Field status on this type/payload.
          status: data.status,
          // Field anomalyFlags on this type/payload.
          anomalyFlags: [...data.anomalyFlags],
        };
        // Return response object.
        return { count: 1 };
      },
    },
  };

  // Return response object.
  return {
    db,
    // Support the surrounding control flow.
    get row() {
      // Return computed result.
      return row;
    },
    // Support the surrounding control flow.
    get updateCalls() {
      // Return computed result.
      return updateCalls;
    },
    // Support the surrounding control flow.
    get lastUpdateData() {
      // Return computed result.
      return lastUpdateData;
    },
    /** Simulate concurrent approval closing the interval after findUnique. */
    becomeAdjustedAfterRead() {
      // Local originalFind used below.
      const originalFind = db.attendanceInterval.findUnique;
      // Assign db.attendanceInterval.findUnique.
      db.attendanceInterval.findUnique = async (args) => {
        // Await current before dependent work.
        const current = await originalFind(args);
        // Assign row.
        row = {
          // Field status on this type/payload.
          status: AttendanceIntervalStatus.adjusted,
          // Time field endedAt.
          endedAt: new Date("2026-10-08T16:00:00.000Z"),
          // Time field startedAt.
          startedAt: new Date("2026-10-08T08:00:00.000Z"),
          // Field anomalyFlags on this type/payload.
          anomalyFlags: [],
        };
        // Return computed result.
        return current;
      };
    },
  };
}

// Test suite: claimStaleOpenInterval.
describe("claimStaleOpenInterval", () => {
  // Date now for window math.
  const now = new Date("2026-10-09T12:00:00.000Z");
  // Date cutoff for window math.
  const cutoff = new Date(
    // Support the surrounding control flow.
    now.getTime() - OPEN_MISSING_END_HOURS * 3600_000,
  );
  // Date staleStart for window math.
  const staleStart = new Date(cutoff.getTime() - 3600_000);

  // Test case: does not overwrite an interval adjusted after the job selected it.
  it("does not overwrite an interval adjusted after the job selected it", async () => {
    // Local fake used below.
    const fake = makeFakeDb({
      // Set status.
      status: AttendanceIntervalStatus.open,
      // Set endedAt.
      endedAt: null,
      // Set startedAt.
      startedAt: staleStart,
      // Set anomalyFlags.
      anomalyFlags: ["large_clock_skew"],
    });
    // Support the surrounding control flow.
    fake.becomeAdjustedAfterRead();

    // Await claimed before dependent work.
    const claimed = await claimStaleOpenInterval(fake.db, "int-1", cutoff);

    // Compare scalar values.
    assert.equal(claimed, false);
    // Compare scalar values.
    assert.equal(fake.updateCalls, 1);
    // Compare scalar values.
    assert.equal(fake.row?.status, AttendanceIntervalStatus.adjusted);
    // Compare scalar values.
    assert.equal(fake.row?.endedAt?.toISOString(), "2026-10-08T16:00:00.000Z");
    // Require truthy condition.
    assert.ok(!fake.row?.anomalyFlags.includes("missing_end"));
    // Deep-compare structures.
    assert.deepEqual(fake.row?.anomalyFlags, []);
  });

  // Test case: flags a truly stale open interval for review and preserves other flags.
  it("flags a truly stale open interval for review and preserves other flags", async () => {
    // Local fake used below.
    const fake = makeFakeDb({
      // Set status.
      status: AttendanceIntervalStatus.open,
      // Set endedAt.
      endedAt: null,
      // Set startedAt.
      startedAt: staleStart,
      // Set anomalyFlags.
      anomalyFlags: ["large_clock_skew"],
    });

    // Await claimed before dependent work.
    const claimed = await claimStaleOpenInterval(fake.db, "int-1", cutoff);

    // Compare scalar values.
    assert.equal(claimed, true);
    // Compare scalar values.
    assert.equal(fake.row?.status, AttendanceIntervalStatus.needs_review);
    // Deep-compare structures.
    assert.deepEqual(fake.row?.anomalyFlags, [
      "large_clock_skew",
      "missing_end",
    ]);
    // Deep-compare structures.
    assert.deepEqual(fake.lastUpdateData?.anomalyFlags, [
      "large_clock_skew",
      "missing_end",
    ]);
  });

  // Test case: leaves a meanwhile-closed interval unchanged.
  it("leaves a meanwhile-closed interval unchanged", async () => {
    // Local fake used below.
    const fake = makeFakeDb({
      // Set status.
      status: AttendanceIntervalStatus.closed,
      // Compute endedAt for the payload.
      endedAt: new Date("2026-10-08T17:00:00.000Z"),
      // Set startedAt.
      startedAt: staleStart,
      // Set anomalyFlags.
      anomalyFlags: ["large_clock_skew"],
    });

    // Await claimed before dependent work.
    const claimed = await claimStaleOpenInterval(fake.db, "int-1", cutoff);

    // Compare scalar values.
    assert.equal(claimed, false);
    // Compare scalar values.
    assert.equal(fake.updateCalls, 0);
    // Compare scalar values.
    assert.equal(fake.row?.status, AttendanceIntervalStatus.closed);
    // Deep-compare structures.
    assert.deepEqual(fake.row?.anomalyFlags, ["large_clock_skew"]);
  });

  // Test case: is idempotent on re-run and concurrent second claim loses.
  it("is idempotent on re-run and concurrent second claim loses", async () => {
    // Local fake used below.
    const fake = makeFakeDb({
      // Set status.
      status: AttendanceIntervalStatus.open,
      // Set endedAt.
      endedAt: null,
      // Set startedAt.
      startedAt: staleStart,
      // Set anomalyFlags.
      anomalyFlags: [],
    });

    // Await first before dependent work.
    const first = await claimStaleOpenInterval(fake.db, "int-1", cutoff);
    // Compare scalar values.
    assert.equal(first, true);
    // Compare scalar values.
    assert.equal(fake.row?.status, AttendanceIntervalStatus.needs_review);

    // Await second before dependent work.
    const second = await claimStaleOpenInterval(fake.db, "int-1", cutoff);
    // Compare scalar values.
    assert.equal(second, false);
    // Compare scalar values.
    assert.equal(fake.row?.status, AttendanceIntervalStatus.needs_review);
    // Deep-compare structures.
    assert.deepEqual(fake.row?.anomalyFlags, ["missing_end"]);

    // Concurrent loser: read still sees open, but updateMany where fails.
    const concurrent = makeFakeDb({
      // Set status.
      status: AttendanceIntervalStatus.open,
      // Set endedAt.
      endedAt: null,
      // Set startedAt.
      startedAt: staleStart,
      // Set anomalyFlags.
      anomalyFlags: ["overlap"],
    });
    // Assign concurrent.db.attendanceInterval.updateMany.
    concurrent.db.attendanceInterval.updateMany = async () => ({ count: 0 });
    // Await lost before dependent work.
    const lost = await claimStaleOpenInterval(concurrent.db, "int-2", cutoff);
    // Compare scalar values.
    assert.equal(lost, false);
    // Deep-compare structures.
    assert.deepEqual(concurrent.row?.anomalyFlags, ["overlap"]);
    // Compare scalar values.
    assert.equal(concurrent.row?.status, AttendanceIntervalStatus.open);
  });

  // Test case: skips open intervals that are still within the threshold.
  it("skips open intervals that are still within the threshold", async () => {
    // Local fake used below.
    const fake = makeFakeDb({
      // Set status.
      status: AttendanceIntervalStatus.open,
      // Set endedAt.
      endedAt: null,
      // Compute startedAt for the payload.
      startedAt: new Date(cutoff.getTime() + 60_000),
      // Set anomalyFlags.
      anomalyFlags: [],
    });

    // Await claimed before dependent work.
    const claimed = await claimStaleOpenInterval(fake.db, "int-1", cutoff);

    // Compare scalar values.
    assert.equal(claimed, false);
    // Compare scalar values.
    assert.equal(fake.updateCalls, 0);
    // Compare scalar values.
    assert.equal(fake.row?.status, AttendanceIntervalStatus.open);
  });
});
