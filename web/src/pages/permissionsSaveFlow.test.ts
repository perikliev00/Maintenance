/**
 * Mocked PermissionsPage save flow: PUT/GET splits, conflict, parallel busy.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiRequestError } from "../api/http";
import {
  applySavedRoleToDraft,
  mergeMatrixIntoDraft,
} from "./permissionsPageState";
import {
  beginPermissionsSave,
  endPermissionsSave,
  runOverlappingRoleSaves,
  runPermissionsSave,
  type PermissionsPutResult,
} from "./permissionsSaveFlow";

function conflictErr() {
  return new ApiRequestError("stale", {
    kind: "http",
    status: 409,
    code: "stale_state",
  });
}

describe("runPermissionsSave", () => {
  it("BUG-06: PUT success + failed refresh → saved_refresh_failed without re-put", async () => {
    let puts = 0;
    const outcome = await runPermissionsSave(
      {
        role: "housekeeper",
        roleLabel: "ХК",
        draft: { panels: ["home"], actions: ["rooms.view"] },
        expectedVersion: 3,
        savingRoles: new Set(),
      },
      {
        put: async () => {
          puts += 1;
          return {
            panels: ["home"],
            actions: ["rooms.view"],
            version: 4,
          } satisfies PermissionsPutResult;
        },
        refreshAfterSave: async () => {
          throw new Error("GET /auth/me failed");
        },
        isConflictError: (err) =>
          err instanceof ApiRequestError && err.status === 409,
      },
    );
    assert.equal(puts, 1);
    assert.equal(outcome.putSucceeded, true);
    assert.equal(outcome.feedback.kind, "saved_refresh_failed");
    assert.equal(outcome.saved?.version, 4);
  });

  it("BUG-06: PUT success + refresh ok → ok feedback", async () => {
    const outcome = await runPermissionsSave(
      {
        role: "technician",
        roleLabel: "Техник",
        draft: { panels: ["repairs"], actions: ["tickets.report"] },
        expectedVersion: 1,
        savingRoles: new Set(),
      },
      {
        put: async () => ({
          panels: ["repairs"],
          actions: ["tickets.report"],
          version: 2,
        }),
        refreshAfterSave: async () => undefined,
        isConflictError: () => false,
      },
    );
    assert.equal(outcome.feedback.kind, "ok");
    assert.equal(outcome.putSucceeded, true);
  });

  it("BUG-01 UI: 409 → conflict feedback and reloadOnConflict", async () => {
    let reloaded = 0;
    const outcome = await runPermissionsSave(
      {
        role: "housekeeper",
        roleLabel: "ХК",
        draft: { panels: ["home"], actions: [] },
        expectedVersion: 1,
        savingRoles: new Set(),
      },
      {
        put: async () => {
          throw conflictErr();
        },
        refreshAfterSave: async () => {
          throw new Error("should not run");
        },
        reloadOnConflict: async () => {
          reloaded += 1;
        },
        isConflictError: (err) =>
          err instanceof ApiRequestError && err.status === 409,
      },
    );
    assert.equal(outcome.putSucceeded, false);
    assert.equal(outcome.feedback.kind, "conflict");
    assert.equal(reloaded, 1);
  });

  it("rejects missing expectedVersion without calling put", async () => {
    let puts = 0;
    const outcome = await runPermissionsSave(
      {
        role: "housekeeper",
        roleLabel: "ХК",
        draft: { panels: ["home"], actions: [] },
        expectedVersion: undefined,
        savingRoles: new Set(),
      },
      {
        put: async () => {
          puts += 1;
          return { panels: [], actions: [], version: 1 };
        },
        refreshAfterSave: async () => undefined,
        isConflictError: () => false,
      },
    );
    assert.equal(puts, 0);
    assert.equal(outcome.feedback.kind, "error");
  });

  it("skips when role already saving (double-submit)", async () => {
    let puts = 0;
    const outcome = await runPermissionsSave(
      {
        role: "housekeeper",
        roleLabel: "ХК",
        draft: { panels: ["home"], actions: [] },
        expectedVersion: 1,
        savingRoles: new Set(["housekeeper"]),
      },
      {
        put: async () => {
          puts += 1;
          return { panels: [], actions: [], version: 1 };
        },
        refreshAfterSave: async () => undefined,
        isConflictError: () => false,
      },
    );
    assert.equal(puts, 0);
    assert.equal(outcome.skipped, true);
  });
});

describe("BUG-03 draft merge after single-role save", () => {
  it("keeps dirty sibling draft while applying saved role", () => {
    const afterPut = applySavedRoleToDraft(
      {
        housekeeper: { panels: ["home"], actions: ["rooms.view"] },
        technician: { panels: ["home", "repairs"], actions: ["tickets.report"] },
      },
      "housekeeper",
      { panels: ["home", "rooms"], actions: ["rooms.view"] },
    );
    const matrixByRole = {
      housekeeper: { panels: ["home", "rooms"], actions: ["rooms.view"] },
      technician: { panels: ["home"], actions: ["tickets.report"] },
    };
    const merged = mergeMatrixIntoDraft(
      afterPut,
      matrixByRole,
      ["housekeeper", "technician"],
      "housekeeper",
    );
    assert.deepEqual(merged.technician.panels, ["home", "repairs"]);
    assert.deepEqual(merged.housekeeper.panels, ["home", "rooms"]);
  });
});

describe("BUG-04 overlapping saves", () => {
  it("a-then-b: sibling stays busy until its own finally", async () => {
    const { snapshots, final } = await runOverlappingRoleSaves({
      roleA: "housekeeper",
      roleB: "technician",
      saveA: async () => undefined,
      saveB: async () => undefined,
      finishOrder: "a-then-b",
    });
    assert.equal(final.length, 0);
    assert.ok(
      snapshots.some(
        (s) => s.includes("housekeeper") && s.includes("technician"),
      ),
      `expected both busy in snapshots: ${JSON.stringify(snapshots)}`,
    );
    const afterA = snapshots.find(
      (s) => !s.includes("housekeeper") && s.includes("technician"),
    );
    assert.ok(afterA, "technician must remain busy after A finishes");
  });

  it("b-then-a: reverse completion keeps A busy", async () => {
    const { snapshots } = await runOverlappingRoleSaves({
      roleA: "housekeeper",
      roleB: "technician",
      saveA: async () => undefined,
      saveB: async () => undefined,
      finishOrder: "b-then-a",
    });
    const afterB = snapshots.find(
      (s) => s.includes("housekeeper") && !s.includes("technician"),
    );
    assert.ok(afterB, "housekeeper must remain busy after B finishes");
  });

  it("beginPermissionsSave blocks double-submit for same role", () => {
    let set = beginPermissionsSave(new Set(), "housekeeper");
    assert.ok(set);
    assert.equal(beginPermissionsSave(set, "housekeeper"), null);
    set = endPermissionsSave(set, "housekeeper");
    assert.ok(beginPermissionsSave(set, "housekeeper"));
  });
});
