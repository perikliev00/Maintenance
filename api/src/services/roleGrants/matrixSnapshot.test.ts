// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module @prisma/client for this service.
import { GrantKind, Role } from "@prisma/client";
// Import module ../../permissions for this service.
import { MATRIX_ROLES } from "../../permissions";
// Import module ./query for this service.
import { foldMatrixSnapshot } from "./query";

// Run next step: describe("foldMatrixSnapshot (TD-04)", () => {
describe("foldMatrixSnapshot (TD-04)", () => {
  // Run next step: it("pairs grants and versions from the rows it is given", ()…
  it("pairs grants and versions from the rows it is given", () => {
    // Destructure value fields needed locally.
    const { byRole, versions } = foldMatrixSnapshot(
      // Run next step: [
      [
        // Run next step: { role: Role.housekeeper, kind: GrantKind.panel, key: "home"…
        { role: Role.housekeeper, kind: GrantKind.panel, key: "home" },
        // Run next step: { role: Role.housekeeper, kind: GrantKind.panel, key: "home"…
        { role: Role.housekeeper, kind: GrantKind.panel, key: "home" },
        // Run next step: { role: Role.housekeeper, kind: GrantKind.action, key: "room…
        { role: Role.housekeeper, kind: GrantKind.action, key: "rooms.view" },
        // Run next step: { role: Role.owner, kind: GrantKind.panel, key: "home" },
        { role: Role.owner, kind: GrantKind.panel, key: "home" },
      ],
      // Run next step: [{ role: Role.housekeeper, version: 7 }],
      [{ role: Role.housekeeper, version: 7 }],
    );
    // Run next step: assert.deepEqual(byRole.housekeeper, {
    assert.deepEqual(byRole.housekeeper, {
      // Set panels on the structure being built.
      panels: ["home"],
      // Set actions on the structure being built.
      actions: ["rooms.view"],
    });
    // Run next step: assert.equal(versions.housekeeper, 7);
    assert.equal(versions.housekeeper, 7);
    // Run next step: assert.equal("owner" in byRole, false);
    assert.equal("owner" in byRole, false);
  });

  // Run next step: it("covers every matrix role; missing revision defaults to 1…
  it("covers every matrix role; missing revision defaults to 1, grants to empty", () => {
    // Destructure value fields needed locally.
    const { byRole, versions } = foldMatrixSnapshot([], []);
    // Iterate items to apply the same logic to each entry.
    for (const role of MATRIX_ROLES) {
      // Run next step: assert.deepEqual(byRole[role], { panels: [], actions: [] });
      assert.deepEqual(byRole[role], { panels: [], actions: [] });
      // Run next step: assert.equal(versions[role], 1);
      assert.equal(versions[role], 1);
    }
  });

  // Run next step: it("ignores revision rows for non-matrix roles", () => {
  it("ignores revision rows for non-matrix roles", () => {
    // Destructure value fields needed locally.
    const { versions } = foldMatrixSnapshot([], [{ role: Role.owner, version: 9 }]);
    // Run next step: assert.equal("owner" in versions, false);
    assert.equal("owner" in versions, false);
  });
});
