// Import node:assert/strict for dailyPlanEffects/hotelDate.test.ts.
import assert from "node:assert/strict";
// Import node:test for dailyPlanEffects/hotelDate.test.ts.
import { describe, it } from "node:test";
// Import ../../errors for dailyPlanEffects/hotelDate.test.ts.
import { AppError } from "../../errors";
// Import ./hotelDate for dailyPlanEffects/hotelDate.test.ts.
import { parseHotelDate } from "./hotelDate";

// Local helper isValidation keeps the main flow readable.
function isValidation(err: unknown, messageIncludes?: string): boolean {
  // Return the computed result to the caller.
  return (
    // Surface a structured AppError for this failure mode.
    err instanceof AppError &&
    // Execute: err.status === 400 &&
    err.status === 400 &&
    // Execute: err.code === "validation" &&
    err.code === "validation" &&
    // Execute: (messageIncludes === undefined || err.message.includes(messageIncludes))
    (messageIncludes === undefined || err.message.includes(messageIncludes))
  );
}

// Begin block/object for the following statements.
describe("parseHotelDate", () => {
  // Begin block/object for the following statements.
  it("parses valid YYYY-MM-DD as UTC midnight", () => {
    // Execute: assert.deepEqual(
    assert.deepEqual(
      // Execute: parseHotelDate("2026-10-12"),
      parseHotelDate("2026-10-12"),
      // Execute: new Date("2026-10-12T00:00:00.000Z"),
      new Date("2026-10-12T00:00:00.000Z"),
    );
  });

  // Begin block/object for the following statements.
  it("rejects bad format", () => {
    // Iterate items to apply the same rule to each.
    for (const bad of ["", "2026-10", "12-10-2026", "2026/10/12", "not-a-date"]) {
      // Execute: assert.throws(
      assert.throws(
        // Execute: () => parseHotelDate(bad),
        () => parseHotelDate(bad),
        // Execute: (err: unknown) => isValidation(err, "YYYY-MM-DD"),
        (err: unknown) => isValidation(err, "YYYY-MM-DD"),
      );
    }
  });

  // Begin block/object for the following statements.
  it("rejects impossible calendar dates", () => {
    // Iterate items to apply the same rule to each.
    for (const bad of ["2026-02-31", "2026-13-01", "2026-00-10", "2026-04-31"]) {
      // Execute: assert.throws(
      assert.throws(
        // Execute: () => parseHotelDate(bad),
        () => parseHotelDate(bad),
        // Execute: (err: unknown) => isValidation(err, "valid calendar date"),
        (err: unknown) => isValidation(err, "valid calendar date"),
      );
    }
  });
});
