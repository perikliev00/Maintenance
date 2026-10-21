import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMonthlyForecast, forecastWindowStart } from "./forecast";

describe("analytics monthly forecast", () => {
  it("uses a 28-day UTC lookback and rounds display values once", () => {
    const now = new Date("2026-03-15T13:20:00.000Z");

    assert.deepEqual(
      forecastWindowStart(now),
      new Date("2026-02-15T00:00:00.000Z"),
    );
    assert.deepEqual(buildMonthlyForecast(now, 75, "tickets"), {
      remainingDaysInMonth: 16,
      dailyRate: 2.7,
      predicted: 42.9,
      formula: "mean(75 tickets / 28 days) × 16 remaining days in month",
    });
  });

  it("preserves a zero forecast at the end of a month", () => {
    const now = new Date("2026-02-28T23:59:59.000Z");

    assert.deepEqual(buildMonthlyForecast(now, 0, "cleaned tasks"), {
      remainingDaysInMonth: 0,
      dailyRate: 0,
      predicted: 0,
      formula: "mean(0 cleaned tasks / 28 days) × 0 remaining days in month",
    });
  });
});
