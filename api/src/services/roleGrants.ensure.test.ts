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

/**
 * Mirrors applyCatalogGrantSeed ledger gate: deltas run at most once per seedId.
 * After the seed is recorded, missing grant rows are intentional absences.
 */
function simulateApplyCatalogGrantSeed(input: {
  appliedSeedIds: Set<string>;
  grants: Set<string>;
  seedId: string;
  deltas: string[];
}): { grants: Set<string>; appliedSeedIds: Set<string>; inserted: number } {
  if (input.appliedSeedIds.has(input.seedId)) {
    return {
      grants: new Set(input.grants),
      appliedSeedIds: new Set(input.appliedSeedIds),
      inserted: 0,
    };
  }
  const grants = new Set(input.grants);
  let inserted = 0;
  for (const key of input.deltas) {
    if (!grants.has(key)) {
      grants.add(key);
      inserted += 1;
    }
  }
  const appliedSeedIds = new Set(input.appliedSeedIds);
  appliedSeedIds.add(input.seedId);
  return { grants, appliedSeedIds, inserted };
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

describe("applyCatalogGrantSeed contract", () => {
  const seedId = "grants.sectors.transfer_cross.v1";
  const managerKey = `${Role.manager}|${GrantKind.action}|sectors.transfer_cross`;
  const adminKey = `${Role.admin}|${GrantKind.action}|sectors.transfer_cross`;
  const deltas = [managerKey, adminKey];

  it("applies deltas once and records the seed id", () => {
    const first = simulateApplyCatalogGrantSeed({
      appliedSeedIds: new Set(),
      grants: new Set(),
      seedId,
      deltas,
    });
    assert.equal(first.inserted, 2);
    assert.ok(first.appliedSeedIds.has(seedId));
    assert.ok(first.grants.has(managerKey));
    assert.ok(first.grants.has(adminKey));

    const second = simulateApplyCatalogGrantSeed({
      appliedSeedIds: first.appliedSeedIds,
      grants: first.grants,
      seedId,
      deltas,
    });
    assert.equal(second.inserted, 0);
    assert.deepEqual([...second.grants].sort(), [...first.grants].sort());
  });

  it("does not restore a revoked grant after the seed is already applied", () => {
    const afterFirst = simulateApplyCatalogGrantSeed({
      appliedSeedIds: new Set(),
      grants: new Set(),
      seedId,
      deltas,
    });
    // Admin revoke: delete the row (presence = allow).
    const afterRevoke = new Set(afterFirst.grants);
    afterRevoke.delete(managerKey);

    // Restart / re-call with ledger already marked applied.
    const afterRestart = simulateApplyCatalogGrantSeed({
      appliedSeedIds: afterFirst.appliedSeedIds,
      grants: afterRevoke,
      seedId,
      deltas,
    });
    assert.equal(afterRestart.inserted, 0);
    assert.equal(afterRestart.grants.has(managerKey), false);
    assert.ok(afterRestart.grants.has(adminKey));
  });
});
