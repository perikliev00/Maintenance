// Import node:assert/strict for cleaning/cycles.test.ts.
import assert from "node:assert/strict";
// Import node:test for cleaning/cycles.test.ts.
import { describe, it } from "node:test";
// Side-effect or default import required by this module.
import {
  UNBOUND_CLEANING_CYCLE,
  formatCleaningHotelDate,
  isFutureHotelDate,
// Execute: } from "./cycles";
} from "./cycles";

describe("cleaning cycle date helpers", () => {
  it("formatCleaningHotelDate uses UTC YMD", () => {
    // Execute: assert.equal(
    assert.equal(
      // Execute: formatCleaningHotelDate(new Date("2026-10-07T00:00:00.000Z")),
      formatCleaningHotelDate(new Date("2026-10-07T00:00:00.000Z")),
      // Execute: "2026-10-07",
      "2026-10-07",
    );
  });

  it("isFutureHotelDate is true only after today", () => {
    const today = "2026-10-07";
    // Execute: assert.equal(
    assert.equal(
      // Execute: isFutureHotelDate(new Date("2026-10-07T00:00:00.000Z"), today),
      isFutureHotelDate(new Date("2026-10-07T00:00:00.000Z"), today),
      false,
    );
    // Execute: assert.equal(
    assert.equal(
      // Execute: isFutureHotelDate(new Date("2026-10-06T00:00:00.000Z"), today),
      isFutureHotelDate(new Date("2026-10-06T00:00:00.000Z"), today),
      false,
    );
    // Execute: assert.equal(
    assert.equal(
      // Execute: isFutureHotelDate(new Date("2026-10-08T00:00:00.000Z"), today),
      isFutureHotelDate(new Date("2026-10-08T00:00:00.000Z"), today),
      true,
    );
  });

  it("unbound cycle sentinel is 0", () => {
    // Execute: assert.equal(UNBOUND_CLEANING_CYCLE, 0);
    assert.equal(UNBOUND_CLEANING_CYCLE, 0);
  });
});
