import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../../errors";
import { parseHotelDate } from "./hotelDate";

function isValidation(err: unknown, messageIncludes?: string): boolean {
  return (
    err instanceof AppError &&
    err.status === 400 &&
    err.code === "validation" &&
    (messageIncludes === undefined || err.message.includes(messageIncludes))
  );
}

describe("parseHotelDate", () => {
  it("parses valid YYYY-MM-DD as UTC midnight", () => {
    assert.deepEqual(
      parseHotelDate("2026-10-12"),
      new Date("2026-10-12T00:00:00.000Z"),
    );
  });

  it("rejects bad format", () => {
    for (const bad of ["", "2026-10", "12-10-2026", "2026/10/12", "not-a-date"]) {
      assert.throws(
        () => parseHotelDate(bad),
        (err: unknown) => isValidation(err, "YYYY-MM-DD"),
      );
    }
  });

  it("rejects impossible calendar dates", () => {
    for (const bad of ["2026-02-31", "2026-13-01", "2026-00-10", "2026-04-31"]) {
      assert.throws(
        () => parseHotelDate(bad),
        (err: unknown) => isValidation(err, "valid calendar date"),
      );
    }
  });
});
