/**
 * Bootstrap and one-shot catalog grant seeds.
 * Empty table → full defaults; later catalog keys use applyCatalogGrantSeed once.
 */
import { GrantKind } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module dependency for this service.
import {
  // Run next step: DEFAULT_ACTION_GRANTS,
  DEFAULT_ACTION_GRANTS,
  // Run next step: DEFAULT_PANEL_GRANTS,
  DEFAULT_PANEL_GRANTS,
  // Run next step: MATRIX_ROLES,
  MATRIX_ROLES,
  // Run next step: isAction,
  isAction,
  // Run next step: isPanel,
  isPanel,
// Run next step: } from "../../permissions";
} from "../../permissions";
// Import module ./cache for this service.
import { invalidateGrantCache } from "./cache";

// Declare type CatalogGrantDelta for callers and internals.
type CatalogGrantDelta = {
  // Set role on the structure being built.
  role: (typeof MATRIX_ROLES)[number];
  // Set kind on the structure being built.
  kind: GrantKind;
  // Set key on the structure being built.
  key: string;
};

/** Flatten DEFAULT_*_GRANTS into RoleGrant createMany rows. */
function allDefaultGrantRows(): CatalogGrantDelta[] {
  // Capture data for use in this scope.
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
  // Return the computed result to the caller.
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
    // Wait for the async step before continuing.
    await prisma.$executeRaw`
      INSERT INTO "RoleGrantRevision" (role, version, "updatedAt")
      VALUES (CAST(${role} AS "Role"), 1, CURRENT_TIMESTAMP)
      ON CONFLICT (role) DO NOTHING
    `;
  }
}

// Define ensureDefaultRoleGrants — core behavior for this module.
export async function ensureDefaultRoleGrants() {
  // Already seeded — do not re-insert revoked defaults.
  const total = await prisma.roleGrant.count();
  // Branch when this condition holds so the right path runs.
  if (total > 0) {
    // Wait for the async step before continuing.
    await ensureRoleGrantRevisions();
    // Exit early; nothing more to do on this path.
    return;
  }

  // Capture data for use in this scope.
  const data = allDefaultGrantRows();
  // Branch when this condition holds so the right path runs.
  if (data.length) {
    // Wait for the async step before continuing.
    await prisma.roleGrant.createMany({ data, skipDuplicates: true });
  }
  // Wait for the async step before continuing.
  await ensureRoleGrantRevisions();
  // Run next step: invalidateGrantCache();
  invalidateGrantCache();
}

/** Drop unknown roles/keys so catalog seeds cannot insert invalid grants. */
function normalizeCatalogDeltas(deltas: CatalogGrantDelta[]): CatalogGrantDelta[] {
  // Keep only matrix roles with known panel/action catalog keys.
  return deltas.filter((d) => {
    // Branch when this condition holds so the right path runs.
    if (!MATRIX_ROLES.includes(d.role)) return false;
    // Branch when this condition holds so the right path runs.
    if (d.kind === GrantKind.panel) return isPanel(d.key);
    // Branch when this condition holds so the right path runs.
    if (d.kind === GrantKind.action) return isAction(d.key);
    // Return the computed result to the caller.
    return false;
  });
}

/**
 * One-shot catalog migration for newly introduced panel/action keys.
 * Runs at most once per seedId (recorded in AppliedDataSeed). After that,
 * admin revokes stay revoked — absence is not treated as a seed gap.
 */
export async function applyCatalogGrantSeed(
  // Set seedId on the structure being built.
  seedId: string,
  // Set deltas on the structure being built.
  deltas: CatalogGrantDelta[],
// Run next step: ) {
) {
  // Empty seedId is a no-op (caller forgot the migration id).
  if (!seedId) return { inserted: 0, alreadyApplied: true };

  // Fast path outside the transaction when already recorded.
  const existing = await prisma.appliedDataSeed.findUnique({
    // Set where on the structure being built.
    where: { id: seedId },
  });
  // Branch when this condition holds so the right path runs.
  if (existing) {
    // Return the computed result to the caller.
    return { inserted: 0, alreadyApplied: true };
  }

  // Capture normalized for use in this scope.
  const normalized = normalizeCatalogDeltas(deltas);

  // Load inserted asynchronously for the next steps.
  const inserted = await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction to avoid double-apply races.
    const again = await tx.appliedDataSeed.findUnique({
      // Set where on the structure being built.
      where: { id: seedId },
    });
    // Branch when this condition holds so the right path runs.
    if (again) return 0;

    // Capture count for use in this scope.
    let count = 0;
    // Branch when this condition holds so the right path runs.
    if (normalized.length) {
      // skipDuplicates: overlapping keys with existing grants are fine.
      const result = await tx.roleGrant.createMany({
        // Set data on the structure being built.
        data: normalized,
        // Set skipDuplicates on the structure being built.
        skipDuplicates: true,
      });
      // Update count as control flow progresses.
      count = result.count;
    }
    // Record seedId so this migration never re-runs.
    await tx.appliedDataSeed.create({ data: { id: seedId } });
    // Return the computed result to the caller.
    return count;
  });

  // Run next step: invalidateGrantCache();
  invalidateGrantCache();
  // Return the computed result to the caller.
  return { inserted, alreadyApplied: false };
}
