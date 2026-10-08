import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../errors";
import { assertValidAdjustmentTimes } from "./attendance";

describe("assertValidAdjustmentTimes", () => {
  const start = new Date("2026-10-08T08:00:00.000Z");

  it("allows end after start with break within span", () => {
    const end = new Date("2026-10-08T16:00:00.000Z");
    assert.doesNotThrow(() => assertValidAdjustmentTimes(start, end, 30));
    assert.doesNotThrow(() => assertValidAdjustmentTimes(start, end, 480));
  });

  it("skips checks when endedAt is null (open interval)", () => {
    assert.doesNotThrow(() => assertValidAdjustmentTimes(start, null, 999));
  });

  it("rejects end before start", () => {
    const end = new Date("2026-10-08T07:00:00.000Z");
    assert.throws(
      () => assertValidAdjustmentTimes(start, end, 0),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 400 &&
        err.code === "validation" &&
        err.message === "End must be after start",
    );
  });

  it("rejects end equal to start", () => {
    assert.throws(
      () => assertValidAdjustmentTimes(start, start, 0),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 400 &&
        err.code === "validation" &&
        err.message === "End must be after start",
    );
  });

  it("rejects break minutes that exceed interval duration", () => {
    const end = new Date("2026-10-08T09:00:00.000Z"); // 60 minutes
    assert.throws(
      () => assertValidAdjustmentTimes(start, end, 61),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 400 &&
        err.code === "validation" &&
        err.message === "Break minutes exceed interval duration",
    );
  });
});
