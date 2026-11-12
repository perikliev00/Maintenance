// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency from ./repairsPanelActions.
import { shouldReloadRepairsAfterDone } from "./repairsPanelActions";

// Group related tests under a shared suite name.
describe("shouldReloadRepairsAfterDone", () => {
  // Define a single test case and its expectation.
  it("reloads after a confirmed server apply", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(shouldReloadRepairsAfterDone({ queued: false }), true);
  });

  // Define a single test case and its expectation.
  it("does not reload when the action was only queued offline", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(shouldReloadRepairsAfterDone({ queued: true }), false);
  });
});
