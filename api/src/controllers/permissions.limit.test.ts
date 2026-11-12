// Import dependency node:assert/strict.
import assert from "node:assert/strict";
// Import dependency node:test.
import { describe, it } from "node:test";
// Import local module ./permissions.
import { parseHistoryLimit } from "./permissions";

// Test suite grouping related cases.
describe("parseHistoryLimit", () => {
  // Single test case asserting expected behavior.
  it("accepts omitted / empty as undefined", () => {
    // Assert expected outcome for this case.
    assert.deepEqual(parseHistoryLimit(undefined), { ok: true, limit: undefined });
    // Assert expected outcome for this case.
    assert.deepEqual(parseHistoryLimit(""), { ok: true, limit: undefined });
  });

  // Single test case asserting expected behavior.
  it("accepts positive integer strings", () => {
    // Assert expected outcome for this case.
    assert.deepEqual(parseHistoryLimit("1"), { ok: true, limit: 1 });
    // Assert expected outcome for this case.
    assert.deepEqual(parseHistoryLimit("100"), { ok: true, limit: 100 });
  });

  // Single test case asserting expected behavior.
  it("rejects NaN-producing and non-integer values", () => {
    // Assert expected outcome for this case.
    assert.equal(parseHistoryLimit("abc").ok, false);
    // Assert expected outcome for this case.
    assert.equal(parseHistoryLimit("12.5").ok, false);
    // Assert expected outcome for this case.
    assert.equal(parseHistoryLimit("-1").ok, false);
    // Assert expected outcome for this case.
    assert.equal(parseHistoryLimit("0").ok, false);
    // Assert expected outcome for this case.
    assert.equal(parseHistoryLimit("1e2").ok, false);
  });
});
