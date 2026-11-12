// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module ./scheduler for this service.
import { startJobScheduler, stopJobScheduler } from "./scheduler";

// Define waitUntil — core behavior for this module.
async function waitUntil(done: () => boolean, maxMs = 3000) {
  // Capture start for use in this scope.
  const start = Date.now();
  // Loop while the condition remains true.
  while (!done() && Date.now() - start < maxMs) {
    // Wait for the async step before continuing.
    await new Promise((r) => setTimeout(r, 10));
  }
}

// Run next step: describe("job scheduler concurrency", () => {
describe("job scheduler concurrency", () => {
  // Run next step: it("does not overlap a slow run when interval ticks during e…
  it("does not overlap a slow run when interval ticks during execution", async () => {
    // Capture calls for use in this scope.
    let calls = 0;
    // Attempt the fallible work so errors can be handled below.
    try {
      // Run next step: startJobScheduler(5, async () => {
      startJobScheduler(5, async () => {
        // Run next step: calls += 1;
        calls += 1;
        // Wait for the async step before continuing.
        await new Promise((resolve) => setTimeout(resolve, 80));
        // Return the computed result to the caller.
        return {};
      });
      // Wait for the async step before continuing.
      await waitUntil(() => calls >= 1);
      // Run next step: assert.equal(calls, 1, "first interval tick must start a run…
      assert.equal(calls, 1, "first interval tick must start a run");
      // More ticks while the slow run holds the lock — must not overlap.
      await new Promise((resolve) => setTimeout(resolve, 40));
      // Run next step: assert.equal(calls, 1, "interval must not start a second ove…
      assert.equal(calls, 1, "interval must not start a second overlapping run");
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await stopJobScheduler();
    }
  });

  // Run next step: it("sweeps stale JobRuns once on boot before any interval ti…
  it("sweeps stale JobRuns once on boot before any interval tick", async () => {
    // Capture abandon calls for use in this scope.
    let abandonCalls = 0;
    // Define abandon as a callable used by this flow.
    const abandon = async () => {
      // Run next step: abandonCalls += 1;
      abandonCalls += 1;
    };
    // Attempt the fallible work so errors can be handled below.
    try {
      // Large interval so a tick cannot satisfy the boot assertion (M-boot).
      startJobScheduler(60_000, async () => ({}), abandon);
      // Wait for the async step before continuing.
      await waitUntil(() => abandonCalls >= 1, 1000);
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: abandonCalls,
        abandonCalls,
        // Run next step: 1,
        1,
        // Run next step: "boot must call abandon exactly once before the first interv…
        "boot must call abandon exactly once before the first interval",
      );
      // Wait for the async step before continuing.
      await new Promise((resolve) => setTimeout(resolve, 80));
      // Run next step: assert.equal(
      assert.equal(
        // Run next step: abandonCalls,
        abandonCalls,
        // Run next step: 1,
        1,
        // Run next step: "interval must not have swept yet with a large intervalMs",
        "interval must not have swept yet with a large intervalMs",
      );
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await stopJobScheduler();
    }
  });

  // Run next step: it("sweeps stale JobRuns again on each interval tick", async…
  it("sweeps stale JobRuns again on each interval tick", async () => {
    // Capture abandon calls for use in this scope.
    let abandonCalls = 0;
    // Define abandon as a callable used by this flow.
    const abandon = async () => {
      // Run next step: abandonCalls += 1;
      abandonCalls += 1;
    };
    // Attempt the fallible work so errors can be handled below.
    try {
      // Run next step: startJobScheduler(40, async () => ({}), abandon);
      startJobScheduler(40, async () => ({}), abandon);
      // Wait for the async step before continuing.
      await waitUntil(() => abandonCalls >= 1, 1000);
      // Run next step: assert.ok(abandonCalls >= 1, "boot must sweep stale runs");
      assert.ok(abandonCalls >= 1, "boot must sweep stale runs");
      // Capture after boot for use in this scope.
      const afterBoot = abandonCalls;
      // Wait for the async step before continuing.
      await waitUntil(() => abandonCalls > afterBoot, 2000);
      // Run next step: assert.ok(
      assert.ok(
        // Run next step: abandonCalls > afterBoot,
        abandonCalls > afterBoot,
        // Run next step: "interval tick must sweep stale runs again",
        "interval tick must sweep stale runs again",
      );
    // Run next step: } finally {
    } finally {
      // Wait for the async step before continuing.
      await stopJobScheduler();
    }
  });
});
