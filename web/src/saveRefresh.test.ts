/**
 * Unit coverage for shared save-then-refresh helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySaveRefreshOutcome,
  executeMutationWithRefresh,
  mergeSavedWithRefreshFailure,
} from "./saveRefresh";

describe("saveRefresh", () => {
  it("classifySaveRefreshOutcome separates save vs refresh failures", () => {
    assert.equal(
      classifySaveRefreshOutcome({ saveOk: true, refreshOk: true }),
      "saved",
    );
    assert.equal(
      classifySaveRefreshOutcome({ saveOk: true, refreshOk: false }),
      "saved_refresh_failed",
    );
    assert.equal(
      classifySaveRefreshOutcome({ saveOk: false, refreshOk: true }),
      "save_failed",
    );
    assert.equal(
      classifySaveRefreshOutcome({ saveOk: false, refreshOk: false }),
      "save_failed",
    );
  });

  it("mergeSavedWithRefreshFailure keeps success message and refresh warning", () => {
    assert.deepEqual(
      mergeSavedWithRefreshFailure({
        successMessage: "Updated role for Ada",
        refreshError: "Failed to reload",
      }),
      {
        message: "Updated role for Ada",
        refreshWarning: "Failed to reload",
      },
    );
    assert.deepEqual(
      mergeSavedWithRefreshFailure({ successMessage: "saved" }),
      { message: "saved", refreshWarning: null },
    );
  });

  it("executeMutationWithRefresh keeps save success when refresh fails", async () => {
    const ok = await executeMutationWithRefresh(
      async () => "saved-value",
      async () => {
        // Abort this path by throwing an error to callers.
        throw new Error("history failed");
      },
    );
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.value, "saved-value");
      assert.equal(ok.outcome, "saved_refresh_failed");
      assert.equal(ok.refreshOk, false);
      assert.match(ok.refreshError ?? "", /history failed/);
    }

    const failed = await executeMutationWithRefresh(async () => {
      // Abort this path by throwing an error to callers.
      throw Object.assign(new Error("conflict"), { status: 409 });
    });
    assert.equal(failed.ok, false);
    if (!failed.ok) {
      assert.equal(failed.outcome, "save_failed");
      assert.equal(
        failed.cause &&
          typeof failed.cause === "object" &&
          "status" in failed.cause &&
          (failed.cause as { status: number }).status,
        409,
      );
    }
  });
});
