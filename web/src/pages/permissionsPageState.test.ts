import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addSavingRole,
  applySavedRoleToDraft,
  historyStatusFromResult,
  isRoleDraftDirty,
  isRoleConflict,
  reconcileMatrixIntoDraft,
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

  const G = (panels: string[], actions: string[] = []) => ({ panels, actions });

  it("rebases untouched roles onto the new remote grants and version", () => {
    const prevBases = {
      housekeeper: { version: 1, grants: G(["home"]) },
    };
    const out = reconcileMatrixIntoDraft(
      { housekeeper: G(["home"]) },
      prevBases,
      {
        roles: ["housekeeper"],
        byRole: { housekeeper: G(["home", "rooms"]) },
        versions: { housekeeper: 2 },
      },
    );
    assert.deepEqual(out.draft.housekeeper, G(["home", "rooms"]));
    assert.equal(out.bases.housekeeper.version, 2);
  });

  it("keeps a dirty draft with its OWN baseVersion when remote moves on", () => {
    const prevBases = {
      housekeeper: { version: 1, grants: G(["home"]) },
    };
    const dirty = G(["home", "repairs"]);
    const out = reconcileMatrixIntoDraft(
      { housekeeper: dirty },
      prevBases,
      {
        roles: ["housekeeper"],
        byRole: { housekeeper: G(["home", "rooms"]) },
        versions: { housekeeper: 2 },
      },
    );
    assert.deepEqual(out.draft.housekeeper, dirty);
    assert.equal(out.bases.housekeeper.version, 1);
    assert.equal(isRoleConflict(out.bases.housekeeper, 2), true);
  });

  it("takeRemoteRole discards the draft and adopts the remote version", () => {
    const out = reconcileMatrixIntoDraft(
      { housekeeper: G(["home", "repairs"]) },
      { housekeeper: { version: 1, grants: G(["home"]) } },
      {
        roles: ["housekeeper"],
        byRole: { housekeeper: G(["home", "rooms"]) },
        versions: { housekeeper: 2 },
      },
      "housekeeper",
    );
    assert.deepEqual(out.draft.housekeeper, G(["home", "rooms"]));
    assert.equal(out.bases.housekeeper.version, 2);
    assert.equal(isRoleConflict(out.bases.housekeeper, 2), false);
  });

  it("initial load (no bases) adopts remote for every role", () => {
    const out = reconcileMatrixIntoDraft({}, {}, {
      roles: ["housekeeper"],
      byRole: { housekeeper: G(["home"]) },
      versions: { housekeeper: 5 },
    });
    assert.equal(out.bases.housekeeper.version, 5);
    assert.deepEqual(out.draft.housekeeper, G(["home"]));
  });

  it("isRoleConflict is false without a base or remote version", () => {
    assert.equal(isRoleConflict(undefined, 2), false);
    assert.equal(isRoleConflict({ version: 1, grants: G([]) }, undefined), false);
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
