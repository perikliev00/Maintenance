/**
 * Bootstrap and one-shot catalog grant seeds.
 * Empty table → full defaults; later catalog keys use applyCatalogGrantSeed once.
 */
import { GrantKind } from "@prisma/client";
import { prisma } from "../../db";
import {
  DEFAULT_ACTION_GRANTS,
  DEFAULT_PANEL_GRANTS,
  MATRIX_ROLES,
  isAction,
  isPanel,
} from "../../permissions";
import { invalidateGrantCache } from "./cache";

// Declare type CatalogGrantDelta for callers and internals.
type CatalogGrantDelta = {
  role: (typeof MATRIX_ROLES)[number];
  kind: GrantKind;
  key: string;
};

/** Flatten DEFAULT_*_GRANTS into RoleGrant createMany rows. */
function allDefaultGrantRows(): CatalogGrantDelta[] {
  const data: CatalogGrantDelta[] = [];
  // One row per (role, panel) and (role, action) from the permissions defaults.
  for (const role of MATRIX_ROLES) {
    // Iterate items to apply the same logic to each entry.
    for (const panel of DEFAULT_PANEL_GRANTS[role]) {
      // Append an entry to the accumulating collection.
      data.push({ role, kind: GrantKind.panel, key: panel });
    }
    // Iterate items to apply the same logic to each entry.
    for (const action of DEFAULT_ACTION_GRANTS[role]) {
      // Append an entry to the accumulating collection.
      data.push({ role, kind: GrantKind.action, key: action });
    }
  }
  return data;
}

/**
 * Bootstrap only: seed the full default matrix when RoleGrant is empty.
 * Never re-inserts missing defaults for an already-populated table — revoked
 * defaults must stay revoked (presence = allow; absence = not granted).
 */
/** Ensure RoleGrantRevision rows exist for every matrix role. */
async function ensureRoleGrantRevisions() {
  // Iterate items to apply the same logic to each entry.
  for (const role of MATRIX_ROLES) {
    await prisma.$executeRaw`
      INSERT INTO "RoleGrantRevision" (role, version, "updatedAt")
      VALUES (CAST(${role} AS "Role"), 1, CURRENT_TIMESTAMP)
      ON CONFLICT (role) DO NOTHING
    `;
  }
}

export async function ensureDefaultRoleGrants() {
  // Already seeded — do not re-insert revoked defaults.
  const total = await prisma.roleGrant.count();
  if (total > 0) {
    await ensureRoleGrantRevisions();
    // Exit early; nothing more to do on this path.
    return;
  }

  const data = allDefaultGrantRows();
  if (data.length) {
    await prisma.roleGrant.createMany({ data, skipDuplicates: true });
  }
  await ensureRoleGrantRevisions();
  invalidateGrantCache();
}

/** Drop unknown roles/keys so catalog seeds cannot insert invalid grants. */
function normalizeCatalogDeltas(deltas: CatalogGrantDelta[]): CatalogGrantDelta[] {
  // Keep only matrix roles with known panel/action catalog keys.
  return deltas.filter((d) => {
    if (!MATRIX_ROLES.includes(d.role)) return false;
    if (d.kind === GrantKind.panel) return isPanel(d.key);
    if (d.kind === GrantKind.action) return isAction(d.key);
    return false;
  });
}

/**
 * One-shot catalog migration for newly introduced panel/action keys.
 * Runs at most once per seedId (recorded in AppliedDataSeed). After that,
 * admin revokes stay revoked — absence is not treated as a seed gap.
 */
export async function applyCatalogGrantSeed(
  seedId: string,
  deltas: CatalogGrantDelta[],
) {
  // Empty seedId is a no-op (caller forgot the migration id).
  if (!seedId) return { inserted: 0, alreadyApplied: true };

  // Fast path outside the transaction when already recorded.
  const existing = await prisma.appliedDataSeed.findUnique({
    where: { id: seedId },
  });
  if (existing) {
    return { inserted: 0, alreadyApplied: true };
  }

  const normalized = normalizeCatalogDeltas(deltas);

  const inserted = await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction to avoid double-apply races.
    const again = await tx.appliedDataSeed.findUnique({
      where: { id: seedId },
    });
    if (again) return 0;

    let count = 0;
    if (normalized.length) {
      // skipDuplicates: overlapping keys with existing grants are fine.
      const result = await tx.roleGrant.createMany({
        data: normalized,
        skipDuplicates: true,
      });
      count = result.count;
    }
    // Record seedId so this migration never re-runs.
    await tx.appliedDataSeed.create({ data: { id: seedId } });
    return count;
  });

  invalidateGrantCache();
  return { inserted, alreadyApplied: false };
}
