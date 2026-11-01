import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isJobSchedulerDisabled } from "./schedulerFlag";

describe("isJobSchedulerDisabled", () => {
  it("is true only when DISABLE_JOB_SCHEDULER is exactly 1", () => {
    assert.equal(isJobSchedulerDisabled({ DISABLE_JOB_SCHEDULER: "1" }), true);
  });

  it("is false when unset, empty, or any other value", () => {
    assert.equal(isJobSchedulerDisabled({}), false);
    assert.equal(isJobSchedulerDisabled({ DISABLE_JOB_SCHEDULER: "" }), false);
    assert.equal(isJobSchedulerDisabled({ DISABLE_JOB_SCHEDULER: "0" }), false);
    assert.equal(isJobSchedulerDisabled({ DISABLE_JOB_SCHEDULER: "true" }), false);
  });
});
