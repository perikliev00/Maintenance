// Strict assert helpers for precise test failures.
import assert from "node:assert/strict";
// Node test runner (describe/it/hooks).
import { describe, it } from "node:test";
// Module import required below.
import {
  DAY_MS,
  endOfDay,
  previousPeriod,
  startOfDay,
// Support the surrounding control flow.
} from "./period";

// Test suite: previousPeriod.
describe("previousPeriod", () => {
  // Test case: preserves a one-day window ending the day before from.
  it("preserves a one-day window ending the day before from", () => {
    // Date from for window math.
    const from = startOfDay(new Date("2026-03-15T12:00:00.000Z"));
    // Date to for window math.
    const to = endOfDay(new Date("2026-03-15T12:00:00.000Z"));
    // Local prev used below.
    const prev = previousPeriod({ from, to });

    // Deep-compare structures.
    assert.deepEqual(prev.to, endOfDay(new Date("2026-03-14T00:00:00.000Z")));
    // Deep-compare structures.
    assert.deepEqual(prev.from, startOfDay(new Date("2026-03-14T00:00:00.000Z")));
    // Require truthy condition.
    assert.ok(prev.to.getTime() - prev.from.getTime() >= DAY_MS - 1);
  });

  // Test case: crosses month boundary (March → February).
  it("crosses month boundary (March → February)", () => {
    // Date from for window math.
    const from = startOfDay(new Date("2026-03-01T00:00:00.000Z"));
    // Date to for window math.
    const to = endOfDay(new Date("2026-03-31T00:00:00.000Z"));
    // Local prev used below.
    const prev = previousPeriod({ from, to });

    // Deep-compare structures.
    assert.deepEqual(prev.to, endOfDay(new Date("2026-02-28T00:00:00.000Z")));
    // Deep-compare structures.
    assert.deepEqual(prev.from, startOfDay(new Date("2026-01-29T00:00:00.000Z")));
    // Compare scalar values.
    assert.equal(prev.from.getUTCHours(), 0);
    // Compare scalar values.
    assert.equal(prev.to.getUTCHours(), 23);
    // Compare scalar values.
    assert.equal(prev.to.getUTCMinutes(), 59);
  });

  // Test case: crosses year boundary (January → prior December).
  it("crosses year boundary (January → prior December)", () => {
    // Date from for window math.
    const from = startOfDay(new Date("2026-01-01T00:00:00.000Z"));
    // Date to for window math.
    const to = endOfDay(new Date("2026-01-31T00:00:00.000Z"));
    // Local prev used below.
    const prev = previousPeriod({ from, to });

    // Deep-compare structures.
    assert.deepEqual(prev.to, endOfDay(new Date("2025-12-31T00:00:00.000Z")));
    // Deep-compare structures.
    assert.deepEqual(prev.from, startOfDay(new Date("2025-12-01T00:00:00.000Z")));
    // Compare scalar values.
    assert.equal(prev.from.getUTCFullYear(), 2025);
    // Compare scalar values.
    assert.equal(prev.to.getUTCFullYear(), 2025);
  });

  // Test case: preserves multi-day length via max DAY_MS.
  it("preserves multi-day length via max DAY_MS", () => {
    // Date from for window math.
    const from = startOfDay(new Date("2026-06-10T00:00:00.000Z"));
    // Date to for window math.
    const to = endOfDay(new Date("2026-06-16T00:00:00.000Z"));
    // Derived metric lengthMs.
    const lengthMs = Math.max(DAY_MS, to.getTime() - from.getTime());
    // Local prev used below.
    const prev = previousPeriod({ from, to });

    // Deep-compare structures.
    assert.deepEqual(prev.to, endOfDay(new Date("2026-06-09T00:00:00.000Z")));
    // Deep-compare structures.
    assert.deepEqual(
      // Support the surrounding control flow.
      prev.from,
      // Invoke startOfDay.
      startOfDay(new Date(prev.to.getTime() - lengthMs + 1)),
    );
  });
});
