import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayEndExclusiveUtc, dayStartUtc } from "./periodBounds";

describe("cleaning results periodBounds", () => {
  it("dayStartUtc is UTC midnight of the given date", () => {
    assert.equal(
      dayStartUtc("2026-03-15").toISOString(),
      "2026-03-15T00:00:00.000Z",
    );
  });

  it("dayEndExclusiveUtc is the next UTC midnight (half-open end)", () => {
    assert.equal(
      dayEndExclusiveUtc("2026-03-15").toISOString(),
      "2026-03-16T00:00:00.000Z",
    );
  });

  it("handles month and year boundaries", () => {
    assert.equal(
      dayEndExclusiveUtc("2026-01-31").toISOString(),
      "2026-02-01T00:00:00.000Z",
    );
    assert.equal(
      dayEndExclusiveUtc("2026-12-31").toISOString(),
      "2027-01-01T00:00:00.000Z",
    );
  });
});
