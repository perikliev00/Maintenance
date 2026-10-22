import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runWithJobExecutionLock } from "./executionLock";

describe("shared scheduled/manual job execution lock", () => {
  it("rejects a concurrent trigger until the active job completes", async () => {
    let finish!: () => void;
    const active = runWithJobExecutionLock(() => new Promise<string>((resolve) => {
      finish = () => resolve("done");
    }));
    await Promise.resolve();
    const concurrent = await runWithJobExecutionLock(async () => "should not run");
    assert.deepEqual(concurrent, { acquired: false });
    finish();
    assert.deepEqual(await active, { acquired: true, value: "done" });
    assert.deepEqual(await runWithJobExecutionLock(async () => "next"), { acquired: true, value: "next" });
  });
});
