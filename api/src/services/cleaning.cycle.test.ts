import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UNBOUND_CLEANING_CYCLE,
  formatCleaningHotelDate,
  isFutureHotelDate,
} from "./cleaning";

describe("cleaning cycle date helpers", () => {
  it("formatCleaningHotelDate uses UTC YMD", () => {
    assert.equal(
      formatCleaningHotelDate(new Date("2026-10-07T00:00:00.000Z")),
      "2026-10-07",
    );
  });

  it("isFutureHotelDate is true only after today", () => {
    const today = "2026-10-07";
    assert.equal(
      isFutureHotelDate(new Date("2026-10-07T00:00:00.000Z"), today),
      false,
    );
    assert.equal(
      isFutureHotelDate(new Date("2026-10-06T00:00:00.000Z"), today),
      false,
    );
    assert.equal(
      isFutureHotelDate(new Date("2026-10-08T00:00:00.000Z"), today),
      true,
    );
  });

  it("unbound cycle sentinel is 0", () => {
    assert.equal(UNBOUND_CLEANING_CYCLE, 0);
  });
});
