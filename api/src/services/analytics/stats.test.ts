import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareMetric, MIN_PERCENTILE_SAMPLES, percentile } from "./stats";

describe("percentile", () => {
  it("returns null when below minimum sample count", () => {
    assert.equal(percentile([1, 2, 3, 4], 0.5), null);
    assert.equal(MIN_PERCENTILE_SAMPLES, 5);
  });

  it("allows exactly MIN_PERCENTILE_SAMPLES values", () => {
    assert.equal(percentile([10, 20, 30, 40, 50], 0), 10);
    assert.equal(percentile([10, 20, 30, 40, 50], 1), 50);
    assert.equal(percentile([10, 20, 30, 40, 50], 0.5), 30);
  });

  it("returns exact index values at boundaries", () => {
    const values = [10, 20, 30, 40, 50, 60];
    assert.equal(percentile(values, 0), 10);
    assert.equal(percentile(values, 1), 60);
  });

  it("interpolates between neighbors for fractional indices", () => {
    const values = [10, 20, 30, 40, 50, 60];
    // idx = 5 * 0.5 = 2.5 → between 30 and 40
    assert.equal(percentile(values, 0.5), 35);
    // idx = 5 * 0.9 = 4.5 → between 50 and 60
    assert.equal(percentile(values, 0.9), 55);
  });
});

describe("compareMetric", () => {
  it("returns null delta when current is missing", () => {
    assert.deepEqual(compareMetric(null, 10), {
      current: null,
      previous: 10,
      deltaPct: null,
    });
  });

  it("returns null delta when previous is missing", () => {
    assert.deepEqual(compareMetric(10, null), {
      current: 10,
      previous: null,
      deltaPct: null,
    });
  });

  it("returns null delta when both are missing", () => {
    assert.deepEqual(compareMetric(null, null), {
      current: null,
      previous: null,
      deltaPct: null,
    });
  });

  it("handles division by zero", () => {
    assert.deepEqual(compareMetric(5, 0), {
      current: 5,
      previous: 0,
      deltaPct: null,
    });
    assert.deepEqual(compareMetric(0, 0), {
      current: 0,
      previous: 0,
      deltaPct: 0,
    });
  });

  it("computes negative and positive percent changes", () => {
    assert.deepEqual(compareMetric(50, 100), {
      current: 50,
      previous: 100,
      deltaPct: -50,
    });
    assert.deepEqual(compareMetric(150, 100), {
      current: 150,
      previous: 100,
      deltaPct: 50,
    });
  });

  it("rounds fractional deltas to one decimal", () => {
    // (110 - 100) / 100 * 100 = 10 exactly
    assert.equal(compareMetric(110, 100).deltaPct, 10);
    // (1 - 3) / 3 * 100 ≈ -66.666 → -66.7
    assert.equal(compareMetric(1, 3).deltaPct, -66.7);
  });
});
