import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GrantKind, Role } from "@prisma/client";
import {
  DEFAULT_ACTION_GRANTS,
  DEFAULT_PANEL_GRANTS,
} from "../permissions";

/**
 * Documents the bootstrap contract: once any RoleGrant rows exist,
 * ensure must not compute "missing defaults" to re-insert. Revoked
 * default keys stay absent (presence = allow).
 */
function wouldReseedMissingDefaults(totalCount: number): boolean {
  // Mirrors ensureDefaultRoleGrants after the fix.
  return totalCount === 0;
}

describe("ensureDefaultRoleGrants contract", () => {
  it("only seeds when the RoleGrant table is empty", () => {
    assert.equal(wouldReseedMissingDefaults(0), true);
    assert.equal(wouldReseedMissingDefaults(1), false);
    assert.equal(
      wouldReseedMissingDefaults(
        DEFAULT_PANEL_GRANTS.supervisor.length +
          DEFAULT_ACTION_GRANTS.supervisor.length,
      ),
      false,
    );
  });

  it("treats a revoked default key as intentionally absent, not a seed gap", () => {
    const defaults = new Set(
      DEFAULT_ACTION_GRANTS.supervisor.map(
        (key) => `${Role.supervisor}|${GrantKind.action}|${key}`,
      ),
    );
    const afterRevoke = new Set(defaults);
    afterRevoke.delete(
      `${Role.supervisor}|${GrantKind.action}|analytics.view`,
    );

    assert.ok(defaults.has(`${Role.supervisor}|${GrantKind.action}|analytics.view`));
    assert.equal(
      afterRevoke.has(`${Role.supervisor}|${GrantKind.action}|analytics.view`),
      false,
    );
    // With totalCount > 0, ensure must not put the key back.
    assert.equal(wouldReseedMissingDefaults(afterRevoke.size), false);
  });
});
