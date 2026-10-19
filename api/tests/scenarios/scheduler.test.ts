import assert from "node:assert/strict";
import { it } from "node:test";
import * as scheduler from "../../src/services/jobs/scheduler";
it("P2-55 stop cancels initial and repeating jobs; double start and restart keep one schedule", async t => {
  const stop = (scheduler as any).stopJobScheduler;
  assert.equal(typeof stop, "function", "scheduler needs a stop lifecycle");
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let calls = 0; const run = async () => { calls++; return {}; };
  try {
    (scheduler.startJobScheduler as any)(60000, run); (scheduler.startJobScheduler as any)(60000, run);
    stop(); t.mock.timers.tick(120000); assert.equal(calls, 0, "stop must cancel delayed first run too");
    (scheduler.startJobScheduler as any)(60000, run); (scheduler.startJobScheduler as any)(60000, run);
    t.mock.timers.tick(14999); assert.equal(calls, 0);
    t.mock.timers.tick(1); assert.equal(calls, 1);
    t.mock.timers.tick(45000); assert.equal(calls, 2);
    stop(); t.mock.timers.tick(120000); assert.equal(calls, 2);
  } finally { stop(); t.mock.timers.reset(); }
});
