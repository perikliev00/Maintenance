// Strict assert helpers for precise test failures.
import assert from "node:assert/strict";
// Node test runner (describe/it/hooks).
import { describe, it } from "node:test";
// Runtime import from ./stats.
import { compareMetric, MIN_PERCENTILE_SAMPLES, percentile } from "./stats";

// Test suite: percentile.
describe("percentile", () => {
  // Test case: returns null when below minimum sample count.
  it("returns null when below minimum sample count", () => {
    // Compare scalar values.
    assert.equal(percentile([1, 2, 3, 4], 0.5), null);
    // Compare scalar values.
    assert.equal(MIN_PERCENTILE_SAMPLES, 5);
  });

  // Test case: allows exactly MIN_PERCENTILE_SAMPLES values.
  it("allows exactly MIN_PERCENTILE_SAMPLES values", () => {
    // Compare scalar values.
    assert.equal(percentile([10, 20, 30, 40, 50], 0), 10);
    // Compare scalar values.
    assert.equal(percentile([10, 20, 30, 40, 50], 1), 50);
    // Compare scalar values.
    assert.equal(percentile([10, 20, 30, 40, 50], 0.5), 30);
  });

  // Test case: returns exact index values at boundaries.
  it("returns exact index values at boundaries", () => {
    // Local values used below.
    const values = [10, 20, 30, 40, 50, 60];
    // Compare scalar values.
    assert.equal(percentile(values, 0), 10);
    // Compare scalar values.
    assert.equal(percentile(values, 1), 60);
  });

  // Test case: interpolates between neighbors for fractional indices.
  it("interpolates between neighbors for fractional indices", () => {
    // Local values used below.
    const values = [10, 20, 30, 40, 50, 60];
    // idx = 5 * 0.5 = 2.5 → between 30 and 40
    assert.equal(percentile(values, 0.5), 35);
    // idx = 5 * 0.9 = 4.5 → between 50 and 60
    assert.equal(percentile(values, 0.9), 55);
  });
});

// Test suite: compareMetric.
describe("compareMetric", () => {
  // Test case: returns null delta when current is missing.
  it("returns null delta when current is missing", () => {
    // Deep-compare structures.
    assert.deepEqual(compareMetric(null, 10), {
      // Set current.
      current: null,
      // Set previous.
      previous: 10,
      // Set deltaPct.
      deltaPct: null,
    });
  });

  // Test case: returns null delta when previous is missing.
  it("returns null delta when previous is missing", () => {
    // Deep-compare structures.
    assert.deepEqual(compareMetric(10, null), {
      // Set current.
      current: 10,
      // Set previous.
      previous: null,
      // Set deltaPct.
      deltaPct: null,
    });
  });

  // Test case: returns null delta when both are missing.
  it("returns null delta when both are missing", () => {
    // Deep-compare structures.
    assert.deepEqual(compareMetric(null, null), {
      // Set current.
      current: null,
      // Set previous.
      previous: null,
      // Set deltaPct.
      deltaPct: null,
    });
  });

  // Test case: handles division by zero.
  it("handles division by zero", () => {
    // Deep-compare structures.
    assert.deepEqual(compareMetric(5, 0), {
      // Set current.
      current: 5,
      // Set previous.
      previous: 0,
      // Set deltaPct.
      deltaPct: null,
    });
    // Deep-compare structures.
    assert.deepEqual(compareMetric(0, 0), {
      // Set current.
      current: 0,
      // Set previous.
      previous: 0,
      // Set deltaPct.
      deltaPct: 0,
    });
  });

  // Test case: computes negative and positive percent changes.
  it("computes negative and positive percent changes", () => {
    // Deep-compare structures.
    assert.deepEqual(compareMetric(50, 100), {
      // Set current.
      current: 50,
      // Set previous.
      previous: 100,
      // Set deltaPct.
      deltaPct: -50,
    });
    // Deep-compare structures.
    assert.deepEqual(compareMetric(150, 100), {
      // Set current.
      current: 150,
      // Set previous.
      previous: 100,
      // Set deltaPct.
      deltaPct: 50,
    });
  });

  // Test case: rounds fractional deltas to one decimal.
  it("rounds fractional deltas to one decimal", () => {
    // (110 - 100) / 100 * 100 = 10 exactly
    assert.equal(compareMetric(110, 100).deltaPct, 10);
    // (1 - 3) / 3 * 100 ≈ -66.666 → -66.7
    assert.equal(compareMetric(1, 3).deltaPct, -66.7);
  });
});
