import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startJobScheduler, stopJobScheduler } from "./scheduler";

describe("job scheduler concurrency", () => {
  it("does not overlap a slow run when interval ticks during execution", async () => {
    let calls = 0;
    startJobScheduler(5, async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 60));
      return {};
    });
    await new Promise((resolve) => setTimeout(resolve, 35));
    await stopJobScheduler();
    assert.equal(calls, 1);
  });
});
