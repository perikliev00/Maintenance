import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ACTIVE_LOCATION_LIMIT,
  MAX_ACTIVE_LOCATION_LIMIT,
  resolveActiveLocationLimit,
} from "./crud";

describe("resolveActiveLocationLimit", () => {
  it("defaults when omitted or non-finite", () => {
    assert.equal(resolveActiveLocationLimit(), DEFAULT_ACTIVE_LOCATION_LIMIT);
    assert.equal(resolveActiveLocationLimit(Number.NaN), DEFAULT_ACTIVE_LOCATION_LIMIT);
    assert.equal(
      resolveActiveLocationLimit(Number.POSITIVE_INFINITY),
      DEFAULT_ACTIVE_LOCATION_LIMIT,
    );
  });

  it("clamps to [1, MAX]", () => {
    assert.equal(resolveActiveLocationLimit(0), 1);
    assert.equal(resolveActiveLocationLimit(-5), 1);
    assert.equal(resolveActiveLocationLimit(1.9), 1);
    assert.equal(resolveActiveLocationLimit(250), 250);
    assert.equal(
      resolveActiveLocationLimit(MAX_ACTIVE_LOCATION_LIMIT + 100),
      MAX_ACTIVE_LOCATION_LIMIT,
    );
  });
});
