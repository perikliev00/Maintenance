import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GrantKind, Role } from "@prisma/client";
import { MATRIX_ROLES } from "../../permissions";
import { foldMatrixSnapshot } from "./query";

describe("foldMatrixSnapshot (TD-04)", () => {
  it("pairs grants and versions from the rows it is given", () => {
    const { byRole, versions } = foldMatrixSnapshot(
      [
        { role: Role.housekeeper, kind: GrantKind.panel, key: "home" },
        { role: Role.housekeeper, kind: GrantKind.panel, key: "home" },
        { role: Role.housekeeper, kind: GrantKind.action, key: "rooms.view" },
        { role: Role.owner, kind: GrantKind.panel, key: "home" },
      ],
      [{ role: Role.housekeeper, version: 7 }],
    );
    assert.deepEqual(byRole.housekeeper, {
      panels: ["home"],
      actions: ["rooms.view"],
    });
    assert.equal(versions.housekeeper, 7);
    assert.equal("owner" in byRole, false);
  });

  it("covers every matrix role; missing revision defaults to 1, grants to empty", () => {
    const { byRole, versions } = foldMatrixSnapshot([], []);
    // Iterate items to apply the same logic to each entry.
    for (const role of MATRIX_ROLES) {
      assert.deepEqual(byRole[role], { panels: [], actions: [] });
      assert.equal(versions[role], 1);
    }
  });

  it("ignores revision rows for non-matrix roles", () => {
    const { versions } = foldMatrixSnapshot([], [{ role: Role.owner, version: 9 }]);
    assert.equal("owner" in versions, false);
  });
});
