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

type CatalogGrantDelta = {
  role: (typeof MATRIX_ROLES)[number];
  kind: GrantKind;
  key: string;
};

function allDefaultGrantRows(): CatalogGrantDelta[] {
  const data: CatalogGrantDelta[] = [];
  for (const role of MATRIX_ROLES) {
    for (const panel of DEFAULT_PANEL_GRANTS[role]) {
      data.push({ role, kind: GrantKind.panel, key: panel });
    }
    for (const action of DEFAULT_ACTION_GRANTS[role]) {
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
export async function ensureDefaultRoleGrants() {
  const total = await prisma.roleGrant.count();
  if (total > 0) {
    return;
  }

  const data = allDefaultGrantRows();
  if (data.length) {
    await prisma.roleGrant.createMany({ data, skipDuplicates: true });
  }
  invalidateGrantCache();
}

function normalizeCatalogDeltas(deltas: CatalogGrantDelta[]): CatalogGrantDelta[] {
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
  if (!seedId) return { inserted: 0, alreadyApplied: true };

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
      const result = await tx.roleGrant.createMany({
        data: normalized,
        skipDuplicates: true,
      });
      count = result.count;
    }
    await tx.appliedDataSeed.create({ data: { id: seedId } });
    return count;
  });

  invalidateGrantCache();
  return { inserted, alreadyApplied: false };
}
