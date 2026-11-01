import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addSavingRole,
  applySavedRoleToDraft,
  historyStatusFromResult,
  isRoleDraftDirty,
  mergeMatrixIntoDraft,
  removeSavingRole,
  saveFeedbackForPutSuccess,
  saveFeedbackForRefreshFailure,
} from "./permissionsPageState";

describe("permissionsPageState", () => {
  it("detects dirty drafts", () => {
    assert.equal(
      isRoleDraftDirty(
        { panels: ["home"], actions: ["rooms.view"] },
        { panels: ["home"], actions: ["rooms.view"] },
      ),
      false,
    );
    assert.equal(
      isRoleDraftDirty(
        { panels: ["home", "rooms"], actions: ["rooms.view"] },
        { panels: ["home"], actions: ["rooms.view"] },
      ),
      true,
    );
  });

  it("preserves dirty drafts for other roles after one role is replaced", () => {
    const prev = {
      housekeeper: { panels: ["home"], actions: ["rooms.view"] },
      technician: { panels: ["home", "repairs"], actions: ["tickets.report"] },
    };
    const byRole = {
      housekeeper: { panels: ["home", "rooms"], actions: ["rooms.view"] },
      technician: { panels: ["home"], actions: ["tickets.report"] },
    };
    const merged = mergeMatrixIntoDraft(
      prev,
      byRole,
      ["housekeeper", "technician"],
      "housekeeper",
    );
    assert.deepEqual(merged.housekeeper, {
      panels: ["home", "rooms"],
      actions: ["rooms.view"],
    });
    assert.deepEqual(merged.technician, prev.technician);
  });

  it("applySavedRoleToDraft updates only the saved role", () => {
    const next = applySavedRoleToDraft(
      {
        housekeeper: { panels: ["home"], actions: [] },
        technician: { panels: ["repairs"], actions: ["tickets.report"] },
      },
      "housekeeper",
      { panels: ["home", "rooms"], actions: ["rooms.view"] },
    );
    assert.deepEqual(next.housekeeper.panels, ["home", "rooms"]);
    assert.deepEqual(next.technician.panels, ["repairs"]);
  });

  it("tracks concurrent saving roles without clobbering siblings", () => {
    let set = addSavingRole(new Set(), "housekeeper");
    set = addSavingRole(set, "technician");
    assert.equal(set.has("housekeeper"), true);
    assert.equal(set.has("technician"), true);
    set = removeSavingRole(set, "housekeeper");
    assert.equal(set.has("housekeeper"), false);
    assert.equal(set.has("technician"), true);
  });

  it("maps history result to UI status", () => {
    assert.equal(historyStatusFromResult(true, 0), "empty");
    assert.equal(historyStatusFromResult(true, 2), "success");
    assert.equal(historyStatusFromResult(false, 0), "error");
  });

  it("separates put-success from refresh-failure messaging", () => {
    assert.equal(saveFeedbackForPutSuccess("ХК").kind, "ok");
    assert.equal(saveFeedbackForRefreshFailure("ХК").kind, "saved_refresh_failed");
  });
});
