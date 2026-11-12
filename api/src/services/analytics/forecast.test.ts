// Strict assert helpers for precise test failures.
import assert from "node:assert/strict";
// Node test runner (describe/it/hooks).
import { describe, it } from "node:test";
// Runtime import from ./forecast.
import { buildMonthlyForecast, forecastWindowStart } from "./forecast";

// Test suite: analytics monthly forecast.
describe("analytics monthly forecast", () => {
  // Test case: uses a 28-day UTC lookback and rounds display values once.
  it("uses a 28-day UTC lookback and rounds display values once", () => {
    // Date now for window math.
    const now = new Date("2026-03-15T13:20:00.000Z");

    // Deep-compare structures.
    assert.deepEqual(
      // Invoke forecastWindowStart.
      forecastWindowStart(now),
      // Construct Date for the lookback/window bound.
      new Date("2026-02-15T00:00:00.000Z"),
    );
    // Deep-compare structures.
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

  // Test case: preserves a zero forecast at the end of a month.
  it("preserves a zero forecast at the end of a month", () => {
    // Date now for window math.
    const now = new Date("2026-02-28T23:59:59.000Z");

    // Deep-compare structures.
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
