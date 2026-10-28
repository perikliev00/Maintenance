import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldReloadRepairsAfterDone } from "./repairsPanelActions";

describe("shouldReloadRepairsAfterDone", () => {
  it("reloads after a confirmed server apply", () => {
    assert.equal(shouldReloadRepairsAfterDone({ queued: false }), true);
  });

  it("does not reload when the action was only queued offline", () => {
    assert.equal(shouldReloadRepairsAfterDone({ queued: true }), false);
  });
});
