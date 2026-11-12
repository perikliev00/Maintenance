/**
 * Child-process entry for T-03 grant bootstrap scenarios.
 * Requires DATABASE_URL (ephemeral DB) and T03_SCENARIO=bootstrap|restart.
 * Uses production ensureDefaultRoleGrants / applyCatalogGrantSeed.
 */
import assert from "node:assert/strict";
// Prisma client types/runtime for DB setup and assertions.
import { GrantKind, Role } from "@prisma/client";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  DEFAULT_ACTION_GRANTS,
  // Execute the next setup or assertion step for this scenario.
  DEFAULT_PANEL_GRANTS,
  // Execute the next setup or assertion step for this scenario.
  MATRIX_ROLES,
// Execute the next setup or assertion step for this scenario.
} from "../src/permissions";
// Import bindings from ../src/db.
import { prisma } from "../src/db";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  applyCatalogGrantSeed,
  // Execute the next setup or assertion step for this scenario.
  ensureDefaultRoleGrants,
// Execute the next setup or assertion step for this scenario.
} from "../src/services/roleGrants";

// CATALOG_SEED_ID: unique stamp so parallel runs do not collide.
const CATALOG_SEED_ID = "grants.t03.catalog.v1";
// CONTROL_SEED_ID: unique stamp so parallel runs do not collide.
const CONTROL_SEED_ID = "grants.t03.control";
// Bind REVOKED_DEFAULT for later setup or assertions in this scope.
const REVOKED_DEFAULT = {
  // Fixture field role for the seeded actor/entity.
  role: Role.supervisor,
  // Execute the next setup or assertion step for this scenario.
  kind: GrantKind.action,
  // Execute the next setup or assertion step for this scenario.
  key: "analytics.view",
// Execute the next setup or assertion step for this scenario.
} as const;

// Bind CATALOG_DELTAS for later setup or assertions in this scope.
const CATALOG_DELTAS = [
  {
    // Fixture field role for the seeded actor/entity.
    role: Role.manager,
    // Execute the next setup or assertion step for this scenario.
    kind: GrantKind.action,
    // Execute the next setup or assertion step for this scenario.
    key: "sectors.transfer_cross",
  },
  {
    // Fixture field role for the seeded actor/entity.
    role: Role.admin,
    // Execute the next setup or assertion step for this scenario.
    kind: GrantKind.action,
    // Execute the next setup or assertion step for this scenario.
    key: "sectors.transfer_cross",
  },
// Execute the next setup or assertion step for this scenario.
] as const;

// Helper expectedDefaultCount: assert expected post-condition.
function expectedDefaultCount(): number {
  // Bind n for later setup or assertions in this scope.
  let n = 0;
  // Iterate to cover variants or wait until a condition holds.
  for (const role of MATRIX_ROLES) {
    // Execute the next setup or assertion step for this scenario.
    n += DEFAULT_PANEL_GRANTS[role].length;
    // Execute the next setup or assertion step for this scenario.
    n += DEFAULT_ACTION_GRANTS[role].length;
  }
  // Return the arranged value/result to the caller.
  return n;
}

// Local helper grantExists used by cases in this file.
async function grantExists(row: {
  // Fixture field role for the seeded actor/entity.
  role: Role;
  // Execute the next setup or assertion step for this scenario.
  kind: GrantKind;
  // Execute the next setup or assertion step for this scenario.
  key: string;
// Execute the next setup or assertion step for this scenario.
}): Promise<boolean> {
  // found: synchronize actors so the race window is observable.
  const found = await prisma.roleGrant.findUnique({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      role_kind_key: { role: row.role, kind: row.kind, key: row.key },
    },
  });
  // Return the arranged value/result to the caller.
  return Boolean(found);
}

// Local helper runBootstrap used by cases in this file.
async function runBootstrap(): Promise<void> {
  // Bind expected for later setup or assertions in this scope.
  const expected = expectedDefaultCount();
  // Assert collection size matches the expected post-condition.
  assert.equal(await prisma.roleGrant.count(), 0, "G1: RoleGrant must start empty");

  // Await async work before asserting or releasing locks.
  await ensureDefaultRoleGrants();
  // afterEnsure: synchronize actors so the race window is observable.
  const afterEnsure = await prisma.roleGrant.count();
  // Assert we are on the isolated test DB, not a seed/prod database.
  assert.equal(afterEnsure, expected, "G1: ensure fills full default matrix");

  // Await async work before asserting or releasing locks.
  await ensureDefaultRoleGrants();
  // Assert the observed value matches the intended post-condition.
  assert.equal(
    // Await async work before asserting or releasing locks.
    await prisma.roleGrant.count(),
    // Execute the next setup or assertion step for this scenario.
    afterEnsure,
    // Execute the next setup or assertion step for this scenario.
    "G2: second ensure must not change count",
  );

  // Await async work before asserting or releasing locks.
  await prisma.roleGrant.delete({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      role_kind_key: {
        // Fixture field role for the seeded actor/entity.
        role: REVOKED_DEFAULT.role,
        // Execute the next setup or assertion step for this scenario.
        kind: REVOKED_DEFAULT.kind,
        // Execute the next setup or assertion step for this scenario.
        key: REVOKED_DEFAULT.key,
      },
    },
  });
  // Assert the observed value matches the intended post-condition.
  assert.equal(await grantExists(REVOKED_DEFAULT), false);
  // afterRevoke: synchronize actors so the race window is observable.
  const afterRevoke = await prisma.roleGrant.count();
  // Assert the observed value matches the intended post-condition.
  assert.ok(afterRevoke > 0, "G3: table still populated after revoke");

  // Await async work before asserting or releasing locks.
  await ensureDefaultRoleGrants();
  // Assert the observed value matches the intended post-condition.
  assert.equal(
    // Await async work before asserting or releasing locks.
    await grantExists(REVOKED_DEFAULT),
    // Execute the next setup or assertion step for this scenario.
    false,
    // Execute the next setup or assertion step for this scenario.
    "G3: revoked default must stay absent after ensure",
  );
  // Assert the observed value matches the intended post-condition.
  assert.equal(
    // Await async work before asserting or releasing locks.
    await prisma.roleGrant.count(),
    // Execute the next setup or assertion step for this scenario.
    afterRevoke,
    // Execute the next setup or assertion step for this scenario.
    "G3: ensure must not re-insert revoked default",
  );

  // Remove catalog keys so createMany reports real inserts (they are also defaults).
  for (const d of CATALOG_DELTAS) {
    // Await async work before asserting or releasing locks.
    await prisma.roleGrant.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { role: d.role, kind: d.kind, key: d.key },
    });
  }

  // first: seeded entity required before the mutation under test.
  const first = await applyCatalogGrantSeed(CATALOG_SEED_ID, [...CATALOG_DELTAS]);
  // Assert the observed value matches the intended post-condition.
  assert.equal(first.alreadyApplied, false, "G4: first apply is not alreadyApplied");
  // Assert the observed value matches the intended post-condition.
  assert.equal(first.inserted, 2, "G4: first apply inserts both deltas");
  // ledger: seeded entity required before the mutation under test.
  const ledger = await prisma.appliedDataSeed.findUnique({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: CATALOG_SEED_ID },
  });
  // Assert the observed value matches the intended post-condition.
  assert.ok(ledger, "G4: ledger records seed id");

  // second: seeded entity required before the mutation under test.
  const second = await applyCatalogGrantSeed(CATALOG_SEED_ID, [...CATALOG_DELTAS]);
  // Assert the observed value matches the intended post-condition.
  assert.equal(second.alreadyApplied, true, "G4: second apply alreadyApplied");
  // Assert the observed value matches the intended post-condition.
  assert.equal(second.inserted, 0, "G4: second apply inserts nothing");

  // Await async work before asserting or releasing locks.
  await prisma.roleGrant.delete({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      role_kind_key: {
        // Fixture field role for the seeded actor/entity.
        role: CATALOG_DELTAS[0].role,
        // Execute the next setup or assertion step for this scenario.
        kind: CATALOG_DELTAS[0].kind,
        // Execute the next setup or assertion step for this scenario.
        key: CATALOG_DELTAS[0].key,
      },
    },
  });
  // afterDeltaRevoke: seeded entity required before the mutation under test.
  const afterDeltaRevoke = await applyCatalogGrantSeed(CATALOG_SEED_ID, [
    // Continue the call chain for setup or assertion detail.
    ...CATALOG_DELTAS,
  ]);
  // Assert the observed value matches the intended post-condition.
  assert.equal(afterDeltaRevoke.inserted, 0, "G5: ledger blocks re-insert");
  // Assert the observed value matches the intended post-condition.
  assert.equal(
    // Await async work before asserting or releasing locks.
    await grantExists(CATALOG_DELTAS[0]),
    // Execute the next setup or assertion step for this scenario.
    false,
    // Execute the next setup or assertion step for this scenario.
    "G5: revoked catalog delta must stay absent",
  );
  // Assert the observed value matches the intended post-condition.
  assert.equal(
    // Await async work before asserting or releasing locks.
    await grantExists(CATALOG_DELTAS[1]),
    // Execute the next setup or assertion step for this scenario.
    true,
    // Execute the next setup or assertion step for this scenario.
    "G5: non-revoked catalog delta remains",
  );
}

// Local helper runRestart used by cases in this file.
async function runRestart(): Promise<void> {
  // control: seeded entity required before the mutation under test.
  const control = await prisma.appliedDataSeed.findUnique({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: CONTROL_SEED_ID },
  });
  // Assert the observed value matches the intended post-condition.
  assert.ok(control, "G6: unrelated control ledger row must exist");

  // Await async work before asserting or releasing locks.
  await ensureDefaultRoleGrants();
  // Assert the observed value matches the intended post-condition.
  assert.equal(
    // Await async work before asserting or releasing locks.
    await grantExists(REVOKED_DEFAULT),
    // Execute the next setup or assertion step for this scenario.
    false,
    // Execute the next setup or assertion step for this scenario.
    "G6: revoked default still absent after new-process ensure",
  );

  // apply: in-process HTTP server handle for this suite.
  const apply = await applyCatalogGrantSeed(CATALOG_SEED_ID, [...CATALOG_DELTAS]);
  // Assert the observed value matches the intended post-condition.
  assert.equal(apply.alreadyApplied, true);
  // Assert the observed value matches the intended post-condition.
  assert.equal(apply.inserted, 0);
  // Assert the observed value matches the intended post-condition.
  assert.equal(
    // Await async work before asserting or releasing locks.
    await grantExists(CATALOG_DELTAS[0]),
    // Execute the next setup or assertion step for this scenario.
    false,
    // Execute the next setup or assertion step for this scenario.
    "G6: revoked catalog delta still absent after new-process apply",
  );
  // Assert the observed value matches the intended post-condition.
  assert.equal(await grantExists(CATALOG_DELTAS[1]), true);
}

// Local helper main used by cases in this file.
async function main(): Promise<void> {
  // Bind scenario for later setup or assertions in this scope.
  const scenario = process.env.T03_SCENARIO;
  // Assert the observed value matches the intended post-condition.
  assert.ok(
    // Execute the next setup or assertion step for this scenario.
    scenario === "bootstrap" || scenario === "restart",
    // Execute the next setup or assertion step for this scenario.
    `T03_SCENARIO must be bootstrap|restart, got ${String(scenario)}`,
  );
  // Assert the observed value matches the intended post-condition.
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");

  // Try path where partial failure must not leak suite state.
  try {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (scenario === "bootstrap") {
      // Await async work before asserting or releasing locks.
      await runBootstrap();
    // Execute the next setup or assertion step for this scenario.
    } else {
      // Await async work before asserting or releasing locks.
      await runRestart();
    }
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  }
}

// Execute the next setup or assertion step for this scenario.
main().catch((err) => {
  // Execute the next setup or assertion step for this scenario.
  console.error(err);
  // Execute the next setup or assertion step for this scenario.
  process.exitCode = 1;
});
