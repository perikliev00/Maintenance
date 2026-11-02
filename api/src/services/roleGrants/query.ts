/**
 * Read helpers over the grant cache: panels/actions, canPerform, matrix for UI.
 */
import { Prisma, Role, type GrantKind } from "@prisma/client";
import { prisma } from "../../db";
import {
  ALL_ACTIONS,
  ALL_PANELS,
  MATRIX_ROLES,
  OPERATIONAL_EDITABLE_ROLES,
  type Action,
  type Panel,
  isOwner,
  landingPanelFor,
} from "../../permissions";
import {
  emptyGrants,
  foldGrantRows,
  getGrantMap,
  type RoleGrants,
} from "./cache";

/**
 * Owner always receives the full catalog; other roles use DB grants.
 * Missing role keys deny by default (empty grants).
 */
export async function getGrantsForRole(role: Role): Promise<RoleGrants> {
  // Owner bypasses DB entirely so stray RoleGrant rows cannot shrink access.
  if (isOwner(role)) {
    return { panels: [...ALL_PANELS], actions: [...ALL_ACTIONS] };
  }
  // Load (possibly cached) role → grants map.
  const map = await getGrantMap();
  // Missing role key → empty grants (deny by default).
  return map.get(role) ?? emptyGrants();
}

/** Panel keys granted to the role (nav visibility). */
export async function panelsForRole(role: Role): Promise<Panel[]> {
  // Delegate to getGrantsForRole so owner bypass stays consistent.
  const g = await getGrantsForRole(role);
  return g.panels;
}

/** Action keys granted to the role (mutation / API checks). */
export async function actionsForRole(role: Role): Promise<Action[]> {
  // Same owner/DB path as panelsForRole.
  const g = await getGrantsForRole(role);
  return g.actions;
}

/** Fast permission check used by middleware and sync command handlers. */
export async function canPerform(role: Role, action: Action): Promise<boolean> {
  // Owner short-circuit avoids a cache/DB round-trip on every request.
  if (isOwner(role)) return true;
  // Otherwise require an explicit action grant.
  const actions = await actionsForRole(role);
  return actions.includes(action);
}

/** Panels + actions + default landing panel for session bootstrap. */
export async function capabilitiesFor(role: Role) {
  // Parallel fetch; landing is a pure function of role.
  const [panels, actions] = await Promise.all([
    panelsForRole(role),
    actionsForRole(role),
  ]);
  // Bundle into the session capabilities payload.
  return {
    panels,
    actions,
    landing: landingPanelFor(role),
  };
}

/**
 * Roles the actor may edit in the permissions matrix.
 * Owner: all matrix roles; manager/admin: operational subset; others: none.
 */
export function editableRolesFor(actor: Role): Exclude<Role, "owner">[] {
  // Owner may edit every matrix role (not including owner itself).
  if (isOwner(actor)) return [...MATRIX_ROLES];
  // Manager/admin may only edit the operational subset.
  if (actor === Role.manager || actor === Role.admin) {
    return [...OPERATIONAL_EDITABLE_ROLES];
  }
  // Other roles cannot mutate the permissions matrix.
  return [];
}

/** Ensure every matrix role has a revision row (idempotent). */
async function ensureRevisionRows() {
  for (const role of MATRIX_ROLES) {
    await prisma.$executeRaw`
      INSERT INTO "RoleGrantRevision" (role, version, "updatedAt")
      VALUES (CAST(${role} AS "Role"), 1, CURRENT_TIMESTAMP)
      ON CONFLICT (role) DO NOTHING
    `;
  }
}

/** Per-role optimistic concurrency versions for the permissions UI. */
export async function getRoleGrantVersions(): Promise<Record<string, number>> {
  await ensureRevisionRows();
  const rows = await prisma.roleGrantRevision.findMany({
    where: { role: { in: [...MATRIX_ROLES] } },
    select: { role: true, version: true },
  });
  const versions: Record<string, number> = {};
  for (const role of MATRIX_ROLES) {
    versions[role] = 1;
  }
  for (const row of rows) {
    versions[row.role] = row.version;
  }
  return versions;
}

/** Default revision for a matrix role that has no RoleGrantRevision row yet. */
const DEFAULT_REVISION = 1;

/**
 * Pure fold of rows read from ONE DB snapshot into grants + versions.
 * Callers must never mix rows from different reads (TD-04).
 */
export function foldMatrixSnapshot(
  grantRows: { role: Role; kind: GrantKind; key: string }[],
  revisionRows: { role: Role; version: number }[],
): {
  byRole: Record<string, RoleGrants>;
  versions: Record<string, number>;
} {
  const map = foldGrantRows(grantRows);
  const byRole: Record<string, RoleGrants> = {};
  const versions: Record<string, number> = {};
  for (const role of MATRIX_ROLES) {
    byRole[role] = map.get(role) ?? emptyGrants();
    versions[role] = DEFAULT_REVISION;
  }
  for (const row of revisionRows) {
    if (row.role in versions) versions[row.role] = row.version;
  }
  return { byRole, versions };
}

/**
 * Read every grant row and revision in a single REPEATABLE READ snapshot.
 * replaceRoleGrants bumps the revision in the same transaction as the grant
 * rewrite, so a snapshot always sees either (old grants, old version) or
 * (new grants, new version) — never a mix. Deliberately bypasses the TTL cache.
 */
async function readMatrixSnapshot() {
  await ensureRevisionRows();
  return prisma.$transaction(
    async (tx) => {
      const grantRows = await tx.roleGrant.findMany();
      const revisionRows = await tx.roleGrantRevision.findMany({
        where: { role: { in: [...MATRIX_ROLES] } },
        select: { role: true, version: true },
      });
      return foldMatrixSnapshot(grantRows, revisionRows);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/**
 * Full matrix payload for the permissions admin UI (includes owner synthetic row).
 * `editableRoles` is scoped to what the acting role is allowed to change.
 * Grants and versions come from one snapshot, never from the TTL cache.
 */
export async function getFullMatrix(actorRole: Role) {
  const { byRole, versions } = await readMatrixSnapshot();
  return {
    // Full catalog of panel/action keys for the matrix columns.
    panels: [...ALL_PANELS],
    actions: [...ALL_ACTIONS],
    roles: [...MATRIX_ROLES],
    byRole,
    versions,
    // Which role columns the current actor may toggle.
    editableRoles: editableRolesFor(actorRole),
    // Synthetic owner row — always full catalog, never stored in RoleGrant.
    owner: { panels: [...ALL_PANELS], actions: [...ALL_ACTIONS] },
  };
}
