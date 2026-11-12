/**
 * Unit coverage for shared save-then-refresh helpers.
 */
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  classifySaveRefreshOutcome,
  // Support the surrounding logic for this step.
  executeMutationWithRefresh,
  // Support the surrounding logic for this step.
  mergeSavedWithRefreshFailure,
// Support the surrounding logic for this step.
} from "./saveRefresh";

// Group related tests under a shared suite name.
describe("saveRefresh", () => {
  // Define a single test case and its expectation.
  it("classifySaveRefreshOutcome separates save vs refresh failures", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke classifySaveRefreshOutcome to perform this step.
      classifySaveRefreshOutcome({ saveOk: true, refreshOk: true }),
      // Support the surrounding logic for this step.
      "saved",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke classifySaveRefreshOutcome to perform this step.
      classifySaveRefreshOutcome({ saveOk: true, refreshOk: false }),
      // Support the surrounding logic for this step.
      "saved_refresh_failed",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke classifySaveRefreshOutcome to perform this step.
      classifySaveRefreshOutcome({ saveOk: false, refreshOk: true }),
      // Support the surrounding logic for this step.
      "save_failed",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke classifySaveRefreshOutcome to perform this step.
      classifySaveRefreshOutcome({ saveOk: false, refreshOk: false }),
      // Support the surrounding logic for this step.
      "save_failed",
    );
  });

  // Define a single test case and its expectation.
  it("mergeSavedWithRefreshFailure keeps success message and refresh warning", () => {
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke mergeSavedWithRefreshFailure to perform this step.
      mergeSavedWithRefreshFailure({
        // Provide successMessage field used by this structure.
        successMessage: "Updated role for Ada",
        // Provide refreshError field used by this structure.
        refreshError: "Failed to reload",
      }),
      {
        // Provide message field used by this structure.
        message: "Updated role for Ada",
        // Provide refreshWarning field used by this structure.
        refreshWarning: "Failed to reload",
      },
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke mergeSavedWithRefreshFailure to perform this step.
      mergeSavedWithRefreshFailure({ successMessage: "saved" }),
      // Support the surrounding logic for this step.
      { message: "saved", refreshWarning: null },
    );
  });

  // Define a single test case and its expectation.
  it("executeMutationWithRefresh keeps save success when refresh fails", async () => {
    // Bind ok for use in the following logic.
    const ok = await executeMutationWithRefresh(
      // Support the surrounding logic for this step.
      async () => "saved-value",
      // Support the surrounding logic for this step.
      async () => {
        // Abort this path by throwing an error to callers.
        throw new Error("history failed");
      },
    );
    // Invoke assert.equal to perform this step.
    assert.equal(ok.ok, true);
    // Conditional branch for the case described by this guard.
    if (ok.ok) {
      // Invoke assert.equal to perform this step.
      assert.equal(ok.value, "saved-value");
      // Invoke assert.equal to perform this step.
      assert.equal(ok.outcome, "saved_refresh_failed");
      // Invoke assert.equal to perform this step.
      assert.equal(ok.refreshOk, false);
      // Invoke assert.match to perform this step.
      assert.match(ok.refreshError ?? "", /history failed/);
    }

    // Bind failed for use in the following logic.
    const failed = await executeMutationWithRefresh(async () => {
      // Abort this path by throwing an error to callers.
      throw Object.assign(new Error("conflict"), { status: 409 });
    });
    // Invoke assert.equal to perform this step.
    assert.equal(failed.ok, false);
    // Conditional branch for the case described by this guard.
    if (!failed.ok) {
      // Invoke assert.equal to perform this step.
      assert.equal(failed.outcome, "save_failed");
      // Invoke assert.equal to perform this step.
      assert.equal(
        // Support the surrounding logic for this step.
        failed.cause &&
          // Support the surrounding logic for this step.
          typeof failed.cause === "object" &&
          // Support the surrounding logic for this step.
          "status" in failed.cause &&
          // Support the surrounding logic for this step.
          (failed.cause as { status: number }).status,
        // Support the surrounding logic for this step.
        409,
      );
    }
  });
});
