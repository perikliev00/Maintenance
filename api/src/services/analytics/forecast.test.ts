import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMonthlyForecast, forecastWindowStart } from "./forecast";

describe("analytics monthly forecast", () => {
  it("uses a 28-day UTC lookback and rounds display values once", () => {
    const now = new Date("2026-03-15T13:20:00.000Z");

    assert.deepEqual(
      // Invoke forecastWindowStart.
      forecastWindowStart(now),
      // Construct Date for the lookback/window bound.
      new Date("2026-02-15T00:00:00.000Z"),
    );
    assert.deepEqual(buildMonthlyForecast(now, 75, "tickets"), {
      // Set remainingDaysInMonth.
      remainingDaysInMonth: 16,
      // Set dailyRate.
      dailyRate: 2.7,
      // Set predicted.
      predicted: 42.9,
      // Set formula.
      formula: "mean(75 tickets / 28 days) × 16 remaining days in month",
    });
  });

  it("preserves a zero forecast at the end of a month", () => {
    const now = new Date("2026-02-28T23:59:59.000Z");

    assert.deepEqual(buildMonthlyForecast(now, 0, "cleaned tasks"), {
      // Set remainingDaysInMonth.
      remainingDaysInMonth: 0,
      // Set dailyRate.
      dailyRate: 0,
      // Set predicted.
      predicted: 0,
      // Set formula.
      formula: "mean(0 cleaned tasks / 28 days) × 0 remaining days in month",
    });
  });
});
