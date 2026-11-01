import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startJobScheduler, stopJobScheduler } from "./scheduler";

async function waitUntil(done: () => boolean, maxMs = 3000) {
  const start = Date.now();
  while (!done() && Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("job scheduler concurrency", () => {
  it("does not overlap a slow run when interval ticks during execution", async () => {
    let calls = 0;
    try {
      startJobScheduler(5, async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {};
      });
      await waitUntil(() => calls >= 1);
      assert.equal(calls, 1, "first interval tick must start a run");
      // More ticks while the slow run holds the lock — must not overlap.
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(calls, 1, "interval must not start a second overlapping run");
    } finally {
      await stopJobScheduler();
    }
  });

  it("sweeps stale JobRuns once on boot before any interval tick", async () => {
    let abandonCalls = 0;
    const abandon = async () => {
      abandonCalls += 1;
    };
    try {
      // Large interval so a tick cannot satisfy the boot assertion (M-boot).
      startJobScheduler(60_000, async () => ({}), abandon);
      await waitUntil(() => abandonCalls >= 1, 1000);
      assert.equal(
        abandonCalls,
        1,
        "boot must call abandon exactly once before the first interval",
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(
        abandonCalls,
        1,
        "interval must not have swept yet with a large intervalMs",
      );
    } finally {
      await stopJobScheduler();
    }
  });

  it("sweeps stale JobRuns again on each interval tick", async () => {
    let abandonCalls = 0;
    const abandon = async () => {
      abandonCalls += 1;
    };
    try {
      startJobScheduler(40, async () => ({}), abandon);
      await waitUntil(() => abandonCalls >= 1, 1000);
      assert.ok(abandonCalls >= 1, "boot must sweep stale runs");
      const afterBoot = abandonCalls;
      await waitUntil(() => abandonCalls > afterBoot, 2000);
      assert.ok(
        abandonCalls > afterBoot,
        "interval tick must sweep stale runs again",
      );
    } finally {
      await stopJobScheduler();
    }
  });
});
