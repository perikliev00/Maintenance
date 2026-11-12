/**
 * Mocked PermissionsPage save flow: PUT/GET splits, conflict, parallel busy.
 */
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency from ../api/http.
import { ApiRequestError } from "../api/http";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  applySavedRoleToDraft,
  // Support the surrounding logic for this step.
  reconcileMatrixIntoDraft,
// Support the surrounding logic for this step.
} from "./permissionsPageState";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  beginPermissionsSave,
  // Support the surrounding logic for this step.
  endPermissionsSave,
  // Support the surrounding logic for this step.
  runOverlappingRoleSaves,
  // Support the surrounding logic for this step.
  runPermissionsSave,
  // Declare type alias PermissionsPutResult.
  type PermissionsPutResult,
// Support the surrounding logic for this step.
} from "./permissionsSaveFlow";

// Define function conflictErr and its behavior.
function conflictErr() {
  // Return early result or rendered output from this path.
  return new ApiRequestError("stale", {
    // Provide kind field used by this structure.
    kind: "http",
    // Provide status field used by this structure.
    status: 409,
    // Provide code field used by this structure.
    code: "stale_state",
  });
}

// Group related tests under a shared suite name.
describe("runPermissionsSave", () => {
  // Define a single test case and its expectation.
  it("PUT success + failed refresh → saved_refresh_failed without re-put", async () => {
    // Bind puts for use in the following logic.
    let puts = 0;
    // Bind outcome for use in the following logic.
    const outcome = await runPermissionsSave(
      {
        // Provide role field used by this structure.
        role: "housekeeper",
        // Provide roleLabel field used by this structure.
        roleLabel: "ХК",
        // Provide draft field used by this structure.
        draft: { panels: ["home"], actions: ["rooms.view"] },
        // Provide expectedVersion field used by this structure.
        expectedVersion: 3,
        // Provide savingRoles field used by this structure.
        savingRoles: new Set(),
      },
      {
        // Provide put field used by this structure.
        put: async () => {
          // Support the surrounding logic for this step.
          puts += 1;
          // Return early result or rendered output from this path.
          return {
            // Provide panels field used by this structure.
            panels: ["home"],
            // Provide actions field used by this structure.
            actions: ["rooms.view"],
            // Provide version field used by this structure.
            version: 4,
          // Support the surrounding logic for this step.
          } satisfies PermissionsPutResult;
        },
        // Provide refreshAfterSave field used by this structure.
        refreshAfterSave: async () => {
          // Abort this path by throwing an error to callers.
          throw new Error("GET /auth/me failed");
        },
        // Provide isConflictError field used by this structure.
        isConflictError: (err) =>
          // Support the surrounding logic for this step.
          err instanceof ApiRequestError && err.status === 409,
      },
    );
    // Invoke assert.equal to perform this step.
    assert.equal(puts, 1);
    // Invoke assert.equal to perform this step.
    assert.equal(outcome.putSucceeded, true);
    // Invoke assert.equal to perform this step.
    assert.equal(outcome.feedback.kind, "saved_refresh_failed");
    // Invoke assert.equal to perform this step.
    assert.equal(outcome.saved?.version, 4);
  });

  // Define a single test case and its expectation.
  it("PUT success + refresh ok → ok feedback", async () => {
    // Bind outcome for use in the following logic.
    const outcome = await runPermissionsSave(
      {
        // Provide role field used by this structure.
        role: "technician",
        // Provide roleLabel field used by this structure.
        roleLabel: "Техник",
        // Provide draft field used by this structure.
        draft: { panels: ["repairs"], actions: ["tickets.report"] },
        // Provide expectedVersion field used by this structure.
        expectedVersion: 1,
        // Provide savingRoles field used by this structure.
        savingRoles: new Set(),
      },
      {
        // Provide put field used by this structure.
        put: async () => ({
          // Provide panels field used by this structure.
          panels: ["repairs"],
          // Provide actions field used by this structure.
          actions: ["tickets.report"],
          // Provide version field used by this structure.
          version: 2,
        }),
        // Provide refreshAfterSave field used by this structure.
        refreshAfterSave: async () => undefined,
        // Provide isConflictError field used by this structure.
        isConflictError: () => false,
      },
    );
    // Invoke assert.equal to perform this step.
    assert.equal(outcome.feedback.kind, "ok");
    // Invoke assert.equal to perform this step.
    assert.equal(outcome.putSucceeded, true);
  });

  // Define a single test case and its expectation.
  it("UI: 409 → conflict feedback and reloadOnConflict", async () => {
    // Bind reloaded for use in the following logic.
    let reloaded = 0;
    // Bind outcome for use in the following logic.
    const outcome = await runPermissionsSave(
      {
        // Provide role field used by this structure.
        role: "housekeeper",
        // Provide roleLabel field used by this structure.
        roleLabel: "ХК",
        // Provide draft field used by this structure.
        draft: { panels: ["home"], actions: [] },
        // Provide expectedVersion field used by this structure.
        expectedVersion: 1,
        // Provide savingRoles field used by this structure.
        savingRoles: new Set(),
      },
      {
        // Provide put field used by this structure.
        put: async () => {
          // Abort this path by throwing an error to callers.
          throw conflictErr();
        },
        // Provide refreshAfterSave field used by this structure.
        refreshAfterSave: async () => {
          // Abort this path by throwing an error to callers.
          throw new Error("should not run");
        },
        // Provide reloadOnConflict field used by this structure.
        reloadOnConflict: async () => {
          // Support the surrounding logic for this step.
          reloaded += 1;
        },
        // Provide isConflictError field used by this structure.
        isConflictError: (err) =>
          // Support the surrounding logic for this step.
          err instanceof ApiRequestError && err.status === 409,
      },
    );
    // Invoke assert.equal to perform this step.
    assert.equal(outcome.putSucceeded, false);
    // Invoke assert.equal to perform this step.
    assert.equal(outcome.feedback.kind, "conflict");
    // Invoke assert.equal to perform this step.
    assert.equal(reloaded, 1);
  });

  // Define a single test case and its expectation.
  it("rejects missing expectedVersion without calling put", async () => {
    // Bind puts for use in the following logic.
    let puts = 0;
    // Bind outcome for use in the following logic.
    const outcome = await runPermissionsSave(
      {
        // Provide role field used by this structure.
        role: "housekeeper",
        // Provide roleLabel field used by this structure.
        roleLabel: "ХК",
        // Provide draft field used by this structure.
        draft: { panels: ["home"], actions: [] },
        // Provide expectedVersion field used by this structure.
        expectedVersion: undefined,
        // Provide savingRoles field used by this structure.
        savingRoles: new Set(),
      },
      {
        // Provide put field used by this structure.
        put: async () => {
          // Support the surrounding logic for this step.
          puts += 1;
          // Return early result or rendered output from this path.
          return { panels: [], actions: [], version: 1 };
        },
        // Provide refreshAfterSave field used by this structure.
        refreshAfterSave: async () => undefined,
        // Provide isConflictError field used by this structure.
        isConflictError: () => false,
      },
    );
    // Invoke assert.equal to perform this step.
    assert.equal(puts, 0);
    // Invoke assert.equal to perform this step.
    assert.equal(outcome.feedback.kind, "error");
  });

  // Define a single test case and its expectation.
  it("skips when role already saving (double-submit)", async () => {
    // Bind puts for use in the following logic.
    let puts = 0;
    // Bind outcome for use in the following logic.
    const outcome = await runPermissionsSave(
      {
        // Provide role field used by this structure.
        role: "housekeeper",
        // Provide roleLabel field used by this structure.
        roleLabel: "ХК",
        // Provide draft field used by this structure.
        draft: { panels: ["home"], actions: [] },
        // Provide expectedVersion field used by this structure.
        expectedVersion: 1,
        // Provide savingRoles field used by this structure.
        savingRoles: new Set(["housekeeper"]),
      },
      {
        // Provide put field used by this structure.
        put: async () => {
          // Support the surrounding logic for this step.
          puts += 1;
          // Return early result or rendered output from this path.
          return { panels: [], actions: [], version: 1 };
        },
        // Provide refreshAfterSave field used by this structure.
        refreshAfterSave: async () => undefined,
        // Provide isConflictError field used by this structure.
        isConflictError: () => false,
      },
    );
    // Invoke assert.equal to perform this step.
    assert.equal(puts, 0);
    // Invoke assert.equal to perform this step.
    assert.equal(outcome.skipped, true);
  });
});

// Group related tests under a shared suite name.
describe("draft merge after single-role save", () => {
  // Define a single test case and its expectation.
  it("keeps dirty sibling draft while applying saved role", () => {
    // Bind afterPut for use in the following logic.
    const afterPut = applySavedRoleToDraft(
      {
        // Provide housekeeper field used by this structure.
        housekeeper: { panels: ["home"], actions: ["rooms.view"] },
        // Provide technician field used by this structure.
        technician: { panels: ["home", "repairs"], actions: ["tickets.report"] },
      },
      // Support the surrounding logic for this step.
      "housekeeper",
      // Support the surrounding logic for this step.
      { panels: ["home", "rooms"], actions: ["rooms.view"] },
    );
    // Bind merged for use in the following logic.
    const merged = reconcileMatrixIntoDraft(
      // Support the surrounding logic for this step.
      afterPut,
      {
        // Provide housekeeper field used by this structure.
        housekeeper: { version: 2, grants: { panels: ["home", "rooms"], actions: ["rooms.view"] } },
        // Provide technician field used by this structure.
        technician: { version: 1, grants: { panels: ["home"], actions: ["tickets.report"] } },
      },
      {
        // Provide roles field used by this structure.
        roles: ["housekeeper", "technician"],
        // Provide byRole field used by this structure.
        byRole: {
          // Provide housekeeper field used by this structure.
          housekeeper: { panels: ["home", "rooms"], actions: ["rooms.view"] },
          // Provide technician field used by this structure.
          technician: { panels: ["home"], actions: ["tickets.report"] },
        },
        // Provide versions field used by this structure.
        versions: { housekeeper: 2, technician: 2 },
      },
    // Support the surrounding logic for this step.
    ).draft;
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(merged.housekeeper.panels, ["home", "rooms"]);
  });
});

// Group related tests under a shared suite name.
describe("overlapping saves", () => {
  // Define a single test case and its expectation.
  it("a-then-b: sibling stays busy until its own finally", async () => {
    // Bind a local value for the following logic.
    const { snapshots, final } = await runOverlappingRoleSaves({
      // Provide roleA field used by this structure.
      roleA: "housekeeper",
      // Provide roleB field used by this structure.
      roleB: "technician",
      // Provide saveA field used by this structure.
      saveA: async () => undefined,
      // Provide saveB field used by this structure.
      saveB: async () => undefined,
      // Provide finishOrder field used by this structure.
      finishOrder: "a-then-b",
    });
    // Invoke assert.equal to perform this step.
    assert.equal(final.length, 0);
    // Invoke assert.ok to perform this step.
    assert.ok(
      // Invoke snapshots.some to perform this step.
      snapshots.some(
        // Support the surrounding logic for this step.
        (s) => s.includes("housekeeper") && s.includes("technician"),
      ),
      // Support the surrounding logic for this step.
      `expected both busy in snapshots: ${JSON.stringify(snapshots)}`,
    );
    // Find the first matching item for this lookup.
    const afterA = snapshots.find(
      // Support the surrounding logic for this step.
      (s) => !s.includes("housekeeper") && s.includes("technician"),
    );
    // Invoke assert.ok to perform this step.
    assert.ok(afterA, "technician must remain busy after A finishes");
  });

  // Define a single test case and its expectation.
  it("b-then-a: reverse completion keeps A busy", async () => {
    // Bind a local value for the following logic.
    const { snapshots } = await runOverlappingRoleSaves({
      // Provide roleA field used by this structure.
      roleA: "housekeeper",
      // Provide roleB field used by this structure.
      roleB: "technician",
      // Provide saveA field used by this structure.
      saveA: async () => undefined,
      // Provide saveB field used by this structure.
      saveB: async () => undefined,
      // Provide finishOrder field used by this structure.
      finishOrder: "b-then-a",
    });
    // Find the first matching item for this lookup.
    const afterB = snapshots.find(
      // Support the surrounding logic for this step.
      (s) => s.includes("housekeeper") && !s.includes("technician"),
    );
    // Invoke assert.ok to perform this step.
    assert.ok(afterB, "housekeeper must remain busy after B finishes");
  });

  // Define a single test case and its expectation.
  it("beginPermissionsSave blocks double-submit for same role", () => {
    // Create a Set/Map for efficient membership or keyed lookup.
    let set = beginPermissionsSave(new Set(), "housekeeper");
    // Invoke assert.ok to perform this step.
    assert.ok(set);
    // Invoke assert.equal to perform this step.
    assert.equal(beginPermissionsSave(set, "housekeeper"), null);
    // Support the surrounding logic for this step.
    set = endPermissionsSave(set, "housekeeper");
    // Invoke assert.ok to perform this step.
    assert.ok(beginPermissionsSave(set, "housekeeper"));
  });
});
