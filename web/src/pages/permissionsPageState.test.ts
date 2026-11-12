// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  addSavingRole,
  // Support the surrounding logic for this step.
  applySavedRoleToDraft,
  // Support the surrounding logic for this step.
  historyStatusFromResult,
  // Support the surrounding logic for this step.
  isRoleDraftDirty,
  // Support the surrounding logic for this step.
  isRoleConflict,
  // Support the surrounding logic for this step.
  reconcileMatrixIntoDraft,
  // Support the surrounding logic for this step.
  removeSavingRole,
  // Support the surrounding logic for this step.
  saveFeedbackForPutSuccess,
  // Support the surrounding logic for this step.
  saveFeedbackForRefreshFailure,
// Support the surrounding logic for this step.
} from "./permissionsPageState";

// Group related tests under a shared suite name.
describe("permissionsPageState", () => {
  // Define a single test case and its expectation.
  it("detects dirty drafts", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke isRoleDraftDirty to perform this step.
      isRoleDraftDirty(
        // Support the surrounding logic for this step.
        { panels: ["home"], actions: ["rooms.view"] },
        // Support the surrounding logic for this step.
        { panels: ["home"], actions: ["rooms.view"] },
      ),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke isRoleDraftDirty to perform this step.
      isRoleDraftDirty(
        // Support the surrounding logic for this step.
        { panels: ["home", "rooms"], actions: ["rooms.view"] },
        // Support the surrounding logic for this step.
        { panels: ["home"], actions: ["rooms.view"] },
      ),
      // Support the surrounding logic for this step.
      true,
    );
  });

  // Initialize an array used by subsequent logic.
  const G = (panels: string[], actions: string[] = []) => ({ panels, actions });

  // Define a single test case and its expectation.
  it("rebases untouched roles onto the new remote grants and version", () => {
    // Initialize an object holding related fields.
    const prevBases = {
      // Provide housekeeper field used by this structure.
      housekeeper: { version: 1, grants: G(["home"]) },
    };
    // Bind out for use in the following logic.
    const out = reconcileMatrixIntoDraft(
      // Support the surrounding logic for this step.
      { housekeeper: G(["home"]) },
      // Support the surrounding logic for this step.
      prevBases,
      {
        // Provide roles field used by this structure.
        roles: ["housekeeper"],
        // Provide byRole field used by this structure.
        byRole: { housekeeper: G(["home", "rooms"]) },
        // Provide versions field used by this structure.
        versions: { housekeeper: 2 },
      },
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(out.draft.housekeeper, G(["home", "rooms"]));
    // Invoke assert.equal to perform this step.
    assert.equal(out.bases.housekeeper.version, 2);
  });

  // Define a single test case and its expectation.
  it("keeps a dirty draft with its OWN baseVersion when remote moves on", () => {
    // Initialize an object holding related fields.
    const prevBases = {
      // Provide housekeeper field used by this structure.
      housekeeper: { version: 1, grants: G(["home"]) },
    };
    // Bind dirty for use in the following logic.
    const dirty = G(["home", "repairs"]);
    // Bind out for use in the following logic.
    const out = reconcileMatrixIntoDraft(
      // Support the surrounding logic for this step.
      { housekeeper: dirty },
      // Support the surrounding logic for this step.
      prevBases,
      {
        // Provide roles field used by this structure.
        roles: ["housekeeper"],
        // Provide byRole field used by this structure.
        byRole: { housekeeper: G(["home", "rooms"]) },
        // Provide versions field used by this structure.
        versions: { housekeeper: 2 },
      },
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(out.draft.housekeeper, dirty);
    // Invoke assert.equal to perform this step.
    assert.equal(out.bases.housekeeper.version, 1);
    // Invoke assert.equal to perform this step.
    assert.equal(isRoleConflict(out.bases.housekeeper, 2), true);
  });

  // Define a single test case and its expectation.
  it("takeRemoteRole discards the draft and adopts the remote version", () => {
    // Bind out for use in the following logic.
    const out = reconcileMatrixIntoDraft(
      // Support the surrounding logic for this step.
      { housekeeper: G(["home", "repairs"]) },
      // Support the surrounding logic for this step.
      { housekeeper: { version: 1, grants: G(["home"]) } },
      {
        // Provide roles field used by this structure.
        roles: ["housekeeper"],
        // Provide byRole field used by this structure.
        byRole: { housekeeper: G(["home", "rooms"]) },
        // Provide versions field used by this structure.
        versions: { housekeeper: 2 },
      },
      // Support the surrounding logic for this step.
      "housekeeper",
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(out.draft.housekeeper, G(["home", "rooms"]));
    // Invoke assert.equal to perform this step.
    assert.equal(out.bases.housekeeper.version, 2);
    // Invoke assert.equal to perform this step.
    assert.equal(isRoleConflict(out.bases.housekeeper, 2), false);
  });

  // Define a single test case and its expectation.
  it("initial load (no bases) adopts remote for every role", () => {
    // Bind out for use in the following logic.
    const out = reconcileMatrixIntoDraft({}, {}, {
      // Provide roles field used by this structure.
      roles: ["housekeeper"],
      // Provide byRole field used by this structure.
      byRole: { housekeeper: G(["home"]) },
      // Provide versions field used by this structure.
      versions: { housekeeper: 5 },
    });
    // Invoke assert.equal to perform this step.
    assert.equal(out.bases.housekeeper.version, 5);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(out.draft.housekeeper, G(["home"]));
  });

  // Define a single test case and its expectation.
  it("isRoleConflict is false without a base or remote version", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(isRoleConflict(undefined, 2), false);
    // Invoke assert.equal to perform this step.
    assert.equal(isRoleConflict({ version: 1, grants: G([]) }, undefined), false);
  });
  // Define a single test case and its expectation.
  it("applySavedRoleToDraft updates only the saved role", () => {
    // Bind next for use in the following logic.
    const next = applySavedRoleToDraft(
      {
        // Provide housekeeper field used by this structure.
        housekeeper: { panels: ["home"], actions: [] },
        // Provide technician field used by this structure.
        technician: { panels: ["repairs"], actions: ["tickets.report"] },
      },
      // Support the surrounding logic for this step.
      "housekeeper",
      // Support the surrounding logic for this step.
      { panels: ["home", "rooms"], actions: ["rooms.view"] },
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(next.housekeeper.panels, ["home", "rooms"]);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(next.technician.panels, ["repairs"]);
  });

  // Define a single test case and its expectation.
  it("tracks concurrent saving roles without clobbering siblings", () => {
    // Create a Set/Map for efficient membership or keyed lookup.
    let set = addSavingRole(new Set(), "housekeeper");
    // Support the surrounding logic for this step.
    set = addSavingRole(set, "technician");
    // Invoke assert.equal to perform this step.
    assert.equal(set.has("housekeeper"), true);
    // Invoke assert.equal to perform this step.
    assert.equal(set.has("technician"), true);
    // Support the surrounding logic for this step.
    set = removeSavingRole(set, "housekeeper");
    // Invoke assert.equal to perform this step.
    assert.equal(set.has("housekeeper"), false);
    // Invoke assert.equal to perform this step.
    assert.equal(set.has("technician"), true);
  });

  // Define a single test case and its expectation.
  it("maps history result to UI status", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(historyStatusFromResult(true, 0), "empty");
    // Invoke assert.equal to perform this step.
    assert.equal(historyStatusFromResult(true, 2), "success");
    // Invoke assert.equal to perform this step.
    assert.equal(historyStatusFromResult(false, 0), "error");
  });

  // Define a single test case and its expectation.
  it("separates put-success from refresh-failure messaging", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(saveFeedbackForPutSuccess("ХК").kind, "ok");
    // Invoke assert.equal to perform this step.
    assert.equal(saveFeedbackForRefreshFailure("ХК").kind, "saved_refresh_failed");
  });
});
