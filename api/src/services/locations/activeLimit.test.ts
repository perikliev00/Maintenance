// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module dependency for this service.
import {
  // Run next step: DEFAULT_ACTIVE_LOCATION_LIMIT,
  DEFAULT_ACTIVE_LOCATION_LIMIT,
  // Run next step: MAX_ACTIVE_LOCATION_LIMIT,
  MAX_ACTIVE_LOCATION_LIMIT,
  // Run next step: resolveActiveLocationLimit,
  resolveActiveLocationLimit,
// Run next step: } from "./crud";
} from "./crud";

// Run next step: describe("resolveActiveLocationLimit", () => {
describe("resolveActiveLocationLimit", () => {
  // Run next step: it("defaults when omitted or non-finite", () => {
  it("defaults when omitted or non-finite", () => {
    // Run next step: assert.equal(resolveActiveLocationLimit(), DEFAULT_ACTIVE_LO…
    assert.equal(resolveActiveLocationLimit(), DEFAULT_ACTIVE_LOCATION_LIMIT);
    // Run next step: assert.equal(resolveActiveLocationLimit(Number.NaN), DEFAULT…
    assert.equal(resolveActiveLocationLimit(Number.NaN), DEFAULT_ACTIVE_LOCATION_LIMIT);
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: resolveActiveLocationLimit(Number.POSITIVE_INFINITY),
      resolveActiveLocationLimit(Number.POSITIVE_INFINITY),
      // Run next step: DEFAULT_ACTIVE_LOCATION_LIMIT,
      DEFAULT_ACTIVE_LOCATION_LIMIT,
    );
  });

  // Run next step: it("clamps to [1, MAX]", () => {
  it("clamps to [1, MAX]", () => {
    // Run next step: assert.equal(resolveActiveLocationLimit(0), 1);
    assert.equal(resolveActiveLocationLimit(0), 1);
    // Run next step: assert.equal(resolveActiveLocationLimit(-5), 1);
    assert.equal(resolveActiveLocationLimit(-5), 1);
    // Run next step: assert.equal(resolveActiveLocationLimit(1.9), 1);
    assert.equal(resolveActiveLocationLimit(1.9), 1);
    // Run next step: assert.equal(resolveActiveLocationLimit(250), 250);
    assert.equal(resolveActiveLocationLimit(250), 250);
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: resolveActiveLocationLimit(MAX_ACTIVE_LOCATION_LIMIT + 100),
      resolveActiveLocationLimit(MAX_ACTIVE_LOCATION_LIMIT + 100),
      // Run next step: MAX_ACTIVE_LOCATION_LIMIT,
      MAX_ACTIVE_LOCATION_LIMIT,
    );
  });
});
