import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DAY_MS,
  endOfDay,
  previousPeriod,
  startOfDay,
} from "./period";

describe("previousPeriod", () => {
  it("preserves a one-day window ending the day before from", () => {
    const from = startOfDay(new Date("2026-03-15T12:00:00.000Z"));
    const to = endOfDay(new Date("2026-03-15T12:00:00.000Z"));
    const prev = previousPeriod({ from, to });

    assert.deepEqual(prev.to, endOfDay(new Date("2026-03-14T00:00:00.000Z")));
    assert.deepEqual(prev.from, startOfDay(new Date("2026-03-14T00:00:00.000Z")));
    assert.ok(prev.to.getTime() - prev.from.getTime() >= DAY_MS - 1);
  });

  it("crosses month boundary (March → February)", () => {
    const from = startOfDay(new Date("2026-03-01T00:00:00.000Z"));
    const to = endOfDay(new Date("2026-03-31T00:00:00.000Z"));
    const prev = previousPeriod({ from, to });

    assert.deepEqual(prev.to, endOfDay(new Date("2026-02-28T00:00:00.000Z")));
    assert.deepEqual(prev.from, startOfDay(new Date("2026-01-29T00:00:00.000Z")));
    assert.equal(prev.from.getUTCHours(), 0);
    assert.equal(prev.to.getUTCHours(), 23);
    assert.equal(prev.to.getUTCMinutes(), 59);
  });

  it("crosses year boundary (January → prior December)", () => {
    const from = startOfDay(new Date("2026-01-01T00:00:00.000Z"));
    const to = endOfDay(new Date("2026-01-31T00:00:00.000Z"));
    const prev = previousPeriod({ from, to });

    assert.deepEqual(prev.to, endOfDay(new Date("2025-12-31T00:00:00.000Z")));
    assert.deepEqual(prev.from, startOfDay(new Date("2025-12-01T00:00:00.000Z")));
    assert.equal(prev.from.getUTCFullYear(), 2025);
    assert.equal(prev.to.getUTCFullYear(), 2025);
  });

  it("preserves multi-day length via max DAY_MS", () => {
    const from = startOfDay(new Date("2026-06-10T00:00:00.000Z"));
    const to = endOfDay(new Date("2026-06-16T00:00:00.000Z"));
    const lengthMs = Math.max(DAY_MS, to.getTime() - from.getTime());
    const prev = previousPeriod({ from, to });

    assert.deepEqual(prev.to, endOfDay(new Date("2026-06-09T00:00:00.000Z")));
    assert.deepEqual(
      prev.from,
      // Invoke startOfDay.
      startOfDay(new Date(prev.to.getTime() - lengthMs + 1)),
    );
  });
});
