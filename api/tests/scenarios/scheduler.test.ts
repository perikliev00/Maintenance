import assert from "node:assert/strict";
import { it } from "node:test";
import * as scheduler from "../../src/services/jobs/scheduler";

/** Wait until async runOnce / execution-lock work finishes after a mock tick. */
/** Poll real time (Date/setImmediate are not mocked) until async lock + run finish. */
async function settledUntil(done: () => boolean, maxMs = 3000) {
  const start = Date.now();
  while (!done() && Date.now() - start < maxMs) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function settled() {
  // setImmediate is not mocked; it runs after promise microtasks from runOnce.
  await new Promise<void>((resolve) => setImmediate(resolve));
}

it("stop cancels initial and repeating jobs; double start and restart keep one schedule", async t => {
  const stop = scheduler.stopJobScheduler;
  assert.equal(typeof stop, "function", "scheduler needs a stop lifecycle");
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let calls = 0; const run = async () => { calls++; return {}; };
  try {
    scheduler.startJobScheduler(60000, run); scheduler.startJobScheduler(60000, run);
    await stop(); t.mock.timers.tick(120000); assert.equal(calls, 0, "stop must cancel delayed first run too");
    scheduler.startJobScheduler(60000, run); scheduler.startJobScheduler(60000, run);
    // Initial delay is 15s; interval is 60s from the same start instant.
    t.mock.timers.tick(14999); await settled(); assert.equal(calls, 0);
    t.mock.timers.tick(1); await settledUntil(() => calls >= 1); assert.equal(calls, 1, "delayed first run");
    // Let the first cycle release the DB advisory lock + currentRun before the next tick.
    await settledUntil(() => false, 500);
    t.mock.timers.tick(60000); await settledUntil(() => calls >= 2); assert.equal(calls, 2, "interval run");
    await stop(); t.mock.timers.tick(120000); assert.equal(calls, 2);
  } finally { await stop(); t.mock.timers.reset(); }
});
