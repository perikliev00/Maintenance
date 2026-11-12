// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module ./schedulerFlag for this service.
import { isJobSchedulerDisabled } from "./schedulerFlag";

// Run next step: describe("isJobSchedulerDisabled", () => {
describe("isJobSchedulerDisabled", () => {
  // Run next step: it("is true only when DISABLE_JOB_SCHEDULER is exactly 1", (…
  it("is true only when DISABLE_JOB_SCHEDULER is exactly 1", () => {
    // Run next step: assert.equal(isJobSchedulerDisabled({ DISABLE_JOB_SCHEDULER:…
    assert.equal(isJobSchedulerDisabled({ DISABLE_JOB_SCHEDULER: "1" }), true);
  });

  // Run next step: it("is false when unset, empty, or any other value", () => {
  it("is false when unset, empty, or any other value", () => {
    // Run next step: assert.equal(isJobSchedulerDisabled({}), false);
    assert.equal(isJobSchedulerDisabled({}), false);
    // Run next step: assert.equal(isJobSchedulerDisabled({ DISABLE_JOB_SCHEDULER:…
    assert.equal(isJobSchedulerDisabled({ DISABLE_JOB_SCHEDULER: "" }), false);
    // Run next step: assert.equal(isJobSchedulerDisabled({ DISABLE_JOB_SCHEDULER:…
    assert.equal(isJobSchedulerDisabled({ DISABLE_JOB_SCHEDULER: "0" }), false);
    // Run next step: assert.equal(isJobSchedulerDisabled({ DISABLE_JOB_SCHEDULER:…
    assert.equal(isJobSchedulerDisabled({ DISABLE_JOB_SCHEDULER: "true" }), false);
  });
});
