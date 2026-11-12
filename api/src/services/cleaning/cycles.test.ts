// Import node:assert/strict for cleaning/cycles.test.ts.
import assert from "node:assert/strict";
// Import node:test for cleaning/cycles.test.ts.
import { describe, it } from "node:test";
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  UNBOUND_CLEANING_CYCLE,
  // Carry this field through the payload or query.
  formatCleaningHotelDate,
  // Carry this field through the payload or query.
  isFutureHotelDate,
// Execute: } from "./cycles";
} from "./cycles";

// Begin block/object for the following statements.
describe("cleaning cycle date helpers", () => {
  // Begin block/object for the following statements.
  it("formatCleaningHotelDate uses UTC YMD", () => {
    // Execute: assert.equal(
    assert.equal(
      // Execute: formatCleaningHotelDate(new Date("2026-10-07T00:00:00.000Z")),
      formatCleaningHotelDate(new Date("2026-10-07T00:00:00.000Z")),
      // Execute: "2026-10-07",
      "2026-10-07",
    );
  });

  // Begin block/object for the following statements.
  it("isFutureHotelDate is true only after today", () => {
    // Capture today for subsequent checks or writes.
    const today = "2026-10-07";
    // Execute: assert.equal(
    assert.equal(
      // Execute: isFutureHotelDate(new Date("2026-10-07T00:00:00.000Z"), today),
      isFutureHotelDate(new Date("2026-10-07T00:00:00.000Z"), today),
      // Field value required by this payload or query.
      false,
    );
    // Execute: assert.equal(
    assert.equal(
      // Execute: isFutureHotelDate(new Date("2026-10-06T00:00:00.000Z"), today),
      isFutureHotelDate(new Date("2026-10-06T00:00:00.000Z"), today),
      // Field value required by this payload or query.
      false,
    );
    // Execute: assert.equal(
    assert.equal(
      // Execute: isFutureHotelDate(new Date("2026-10-08T00:00:00.000Z"), today),
      isFutureHotelDate(new Date("2026-10-08T00:00:00.000Z"), today),
      // Field value required by this payload or query.
      true,
    );
  });

  // Begin block/object for the following statements.
  it("unbound cycle sentinel is 0", () => {
    // Execute: assert.equal(UNBOUND_CLEANING_CYCLE, 0);
    assert.equal(UNBOUND_CLEANING_CYCLE, 0);
  });
});
