/**
 * Child-process entry for T-03 grant bootstrap scenarios.
 * Requires DATABASE_URL (ephemeral DB) and T03_SCENARIO=bootstrap|restart.
 * Uses production ensureDefaultRoleGrants / applyCatalogGrantSeed.
 */
import assert from "node:assert/strict";
import { GrantKind, Role } from "@prisma/client";
import {
  DEFAULT_ACTION_GRANTS,
  DEFAULT_PANEL_GRANTS,
  MATRIX_ROLES,
} from "../src/permissions";
import { prisma } from "../src/db";
import {
  applyCatalogGrantSeed,
  ensureDefaultRoleGrants,
} from "../src/services/roleGrants";

const CATALOG_SEED_ID = "grants.t03.catalog.v1";
const CONTROL_SEED_ID = "grants.t03.control";
const REVOKED_DEFAULT = {
  role: Role.supervisor,
  kind: GrantKind.action,
  key: "analytics.view",
} as const;

const CATALOG_DELTAS = [
  {
    role: Role.manager,
    kind: GrantKind.action,
    key: "sectors.transfer_cross",
  },
  {
    role: Role.admin,
    kind: GrantKind.action,
    key: "sectors.transfer_cross",
  },
] as const;

// Helper expectedDefaultCount: assert expected post-condition.
function expectedDefaultCount(): number {
  let n = 0;
  for (const role of MATRIX_ROLES) {
    n += DEFAULT_PANEL_GRANTS[role].length;
    n += DEFAULT_ACTION_GRANTS[role].length;
  }
  return n;
}

// Local helper grantExists used by cases in this file.
async function grantExists(row: {
  role: Role;
  kind: GrantKind;
  key: string;
}): Promise<boolean> {
  const found = await prisma.roleGrant.findUnique({
    where: {
      role_kind_key: { role: row.role, kind: row.kind, key: row.key },
    },
  });
  return Boolean(found);
}

// Local helper runBootstrap used by cases in this file.
async function runBootstrap(): Promise<void> {
  const expected = expectedDefaultCount();
  assert.equal(await prisma.roleGrant.count(), 0, "G1: RoleGrant must start empty");

  await ensureDefaultRoleGrants();
  const afterEnsure = await prisma.roleGrant.count();
  assert.equal(afterEnsure, expected, "G1: ensure fills full default matrix");

  await ensureDefaultRoleGrants();
  assert.equal(
    await prisma.roleGrant.count(),
    afterEnsure,
    "G2: second ensure must not change count",
  );

  await prisma.roleGrant.delete({
    where: {
      role_kind_key: {
        role: REVOKED_DEFAULT.role,
        kind: REVOKED_DEFAULT.kind,
        key: REVOKED_DEFAULT.key,
      },
    },
  });
  assert.equal(await grantExists(REVOKED_DEFAULT), false);
  const afterRevoke = await prisma.roleGrant.count();
  assert.ok(afterRevoke > 0, "G3: table still populated after revoke");

  await ensureDefaultRoleGrants();
  assert.equal(
    await grantExists(REVOKED_DEFAULT),
    false,
    "G3: revoked default must stay absent after ensure",
  );
  assert.equal(
    await prisma.roleGrant.count(),
    afterRevoke,
    "G3: ensure must not re-insert revoked default",
  );

  // Remove catalog keys so createMany reports real inserts (they are also defaults).
  for (const d of CATALOG_DELTAS) {
    await prisma.roleGrant.deleteMany({
      where: { role: d.role, kind: d.kind, key: d.key },
    });
  }

  // first: seeded entity required before the mutation under test.
  const first = await applyCatalogGrantSeed(CATALOG_SEED_ID, [...CATALOG_DELTAS]);
  assert.equal(first.alreadyApplied, false, "G4: first apply is not alreadyApplied");
  assert.equal(first.inserted, 2, "G4: first apply inserts both deltas");
  // ledger: seeded entity required before the mutation under test.
  const ledger = await prisma.appliedDataSeed.findUnique({
    where: { id: CATALOG_SEED_ID },
  });
  assert.ok(ledger, "G4: ledger records seed id");

  // second: seeded entity required before the mutation under test.
  const second = await applyCatalogGrantSeed(CATALOG_SEED_ID, [...CATALOG_DELTAS]);
  assert.equal(second.alreadyApplied, true, "G4: second apply alreadyApplied");
  assert.equal(second.inserted, 0, "G4: second apply inserts nothing");

  await prisma.roleGrant.delete({
    where: {
      role_kind_key: {
        role: CATALOG_DELTAS[0].role,
        kind: CATALOG_DELTAS[0].kind,
        key: CATALOG_DELTAS[0].key,
      },
    },
  });
  // afterDeltaRevoke: seeded entity required before the mutation under test.
  const afterDeltaRevoke = await applyCatalogGrantSeed(CATALOG_SEED_ID, [
    ...CATALOG_DELTAS,
  ]);
  assert.equal(afterDeltaRevoke.inserted, 0, "G5: ledger blocks re-insert");
  assert.equal(
    await grantExists(CATALOG_DELTAS[0]),
    false,
    "G5: revoked catalog delta must stay absent",
  );
  assert.equal(
    await grantExists(CATALOG_DELTAS[1]),
    true,
    "G5: non-revoked catalog delta remains",
  );
}

// Local helper runRestart used by cases in this file.
async function runRestart(): Promise<void> {
  // control: seeded entity required before the mutation under test.
  const control = await prisma.appliedDataSeed.findUnique({
    where: { id: CONTROL_SEED_ID },
  });
  assert.ok(control, "G6: unrelated control ledger row must exist");

  await ensureDefaultRoleGrants();
  assert.equal(
    await grantExists(REVOKED_DEFAULT),
    false,
    "G6: revoked default still absent after new-process ensure",
  );

  // apply: in-process HTTP server handle for this suite.
  const apply = await applyCatalogGrantSeed(CATALOG_SEED_ID, [...CATALOG_DELTAS]);
  assert.equal(apply.alreadyApplied, true);
  assert.equal(apply.inserted, 0);
  assert.equal(
    await grantExists(CATALOG_DELTAS[0]),
    false,
    "G6: revoked catalog delta still absent after new-process apply",
  );
  assert.equal(await grantExists(CATALOG_DELTAS[1]), true);
}

// Local helper main used by cases in this file.
async function main(): Promise<void> {
  const scenario = process.env.T03_SCENARIO;
  assert.ok(
    scenario === "bootstrap" || scenario === "restart",
    `T03_SCENARIO must be bootstrap|restart, got ${String(scenario)}`,
  );
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");

  try {
    if (scenario === "bootstrap") {
      await runBootstrap();
    } else {
      await runRestart();
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
