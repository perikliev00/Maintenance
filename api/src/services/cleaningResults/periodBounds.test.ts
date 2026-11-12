// Import node:assert/strict for cleaningResults/periodBounds.test.ts.
import assert from "node:assert/strict";
// Import node:test for cleaningResults/periodBounds.test.ts.
import { describe, it } from "node:test";
// Import ./periodBounds for cleaningResults/periodBounds.test.ts.
import { dayEndExclusiveUtc, dayStartUtc } from "./periodBounds";

// Begin block/object for the following statements.
describe("cleaning results periodBounds", () => {
  // Begin block/object for the following statements.
  it("dayStartUtc is UTC midnight of the given date", () => {
    // Execute: assert.equal(
    assert.equal(
      // Execute: dayStartUtc("2026-03-15").toISOString(),
      dayStartUtc("2026-03-15").toISOString(),
      // Execute: "2026-03-15T00:00:00.000Z",
      "2026-03-15T00:00:00.000Z",
    );
  });

  // Begin block/object for the following statements.
  it("dayEndExclusiveUtc is the next UTC midnight (half-open end)", () => {
    // Execute: assert.equal(
    assert.equal(
      // Execute: dayEndExclusiveUtc("2026-03-15").toISOString(),
      dayEndExclusiveUtc("2026-03-15").toISOString(),
      // Execute: "2026-03-16T00:00:00.000Z",
      "2026-03-16T00:00:00.000Z",
    );
  });

  // Begin block/object for the following statements.
  it("handles month and year boundaries", () => {
    // Execute: assert.equal(
    assert.equal(
      // Execute: dayEndExclusiveUtc("2026-01-31").toISOString(),
      dayEndExclusiveUtc("2026-01-31").toISOString(),
      // Execute: "2026-02-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    );
    // Execute: assert.equal(
    assert.equal(
      // Execute: dayEndExclusiveUtc("2026-12-31").toISOString(),
      dayEndExclusiveUtc("2026-12-31").toISOString(),
      // Execute: "2027-01-01T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
    );
  });
});
