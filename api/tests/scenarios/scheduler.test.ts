// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { it } from "node:test";
// Import bindings from ../../src/services/jobs/scheduler.
import * as scheduler from "../../src/services/jobs/scheduler";

/** Wait until async runOnce / execution-lock work finishes after a mock tick. */
/** Poll real time (Date/setImmediate are not mocked) until async lock + run finish. */
async function settledUntil(done: () => boolean, maxMs = 3000) {
  // Bind start for later setup or assertions in this scope.
  const start = Date.now();
  // Repeat/poll to widen the race window or wait for lock waiters.
  while (!done() && Date.now() - start < maxMs) {
    // Await async work before asserting or releasing locks.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

// Local helper settled used by cases in this file.
async function settled() {
  // setImmediate is not mocked; it runs after promise microtasks from runOnce.
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// Case: stop cancels initial and repeating jobs; double start and restart keep one schedule.
it("stop cancels initial and repeating jobs; double start and restart keep one schedule", async t => {
  // Bind stop for later setup or assertions in this scope.
  const stop = scheduler.stopJobScheduler;
  // Assert the observed value matches the intended post-condition.
  assert.equal(typeof stop, "function", "scheduler needs a stop lifecycle");
  // Execute the next setup or assertion step for this scenario.
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  // Bind calls for later setup or assertions in this scope.
  let calls = 0; const run = async () => { calls++; return {}; };
  // Try path where partial failure must not leak suite state.
  try {
    // Execute the next setup or assertion step for this scenario.
    scheduler.startJobScheduler(60000, run); scheduler.startJobScheduler(60000, run);
    // Assert the observed value matches the intended post-condition.
    await stop(); t.mock.timers.tick(120000); assert.equal(calls, 0, "stop must cancel delayed first run too");
    // Execute the next setup or assertion step for this scenario.
    scheduler.startJobScheduler(60000, run); scheduler.startJobScheduler(60000, run);
    // Initial delay is 15s; interval is 60s from the same start instant.
    t.mock.timers.tick(14999); await settled(); assert.equal(calls, 0);
    // Assert the observed value matches the intended post-condition.
    t.mock.timers.tick(1); await settledUntil(() => calls >= 1); assert.equal(calls, 1, "delayed first run");
    // Let the first cycle release the DB advisory lock + currentRun before the next tick.
    await settledUntil(() => false, 500);
    // Assert the observed value matches the intended post-condition.
    t.mock.timers.tick(60000); await settledUntil(() => calls >= 2); assert.equal(calls, 2, "interval run");
    // Assert the observed value matches the intended post-condition.
    await stop(); t.mock.timers.tick(120000); assert.equal(calls, 2);
  // Await async work before asserting or releasing locks.
  } finally { await stop(); t.mock.timers.reset(); }
});
