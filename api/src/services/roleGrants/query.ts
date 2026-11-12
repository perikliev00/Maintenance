/**
 * Read helpers over the grant cache: panels/actions, canPerform, matrix for UI.
 */
import { Prisma, Role, type GrantKind } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module dependency for this service.
import {
  // Run next step: ALL_ACTIONS,
  ALL_ACTIONS,
  // Run next step: ALL_PANELS,
  ALL_PANELS,
  // Run next step: MATRIX_ROLES,
  MATRIX_ROLES,
  // Run next step: OPERATIONAL_EDITABLE_ROLES,
  OPERATIONAL_EDITABLE_ROLES,
  // Declare type Action for callers and internals.
  type Action,
  // Declare type Panel for callers and internals.
  type Panel,
  // Run next step: isOwner,
  isOwner,
  // Run next step: landingPanelFor,
  landingPanelFor,
// Run next step: } from "../../permissions";
} from "../../permissions";
// Import module dependency for this service.
import {
  // Run next step: emptyGrants,
  emptyGrants,
  // Run next step: foldGrantRows,
  foldGrantRows,
  // Run next step: getGrantMap,
  getGrantMap,
  // Declare type RoleGrants for callers and internals.
  type RoleGrants,
// Run next step: } from "./cache";
} from "./cache";

/**
 * Owner always receives the full catalog; other roles use DB grants.
 * Missing role keys deny by default (empty grants).
 */
export async function getGrantsForRole(role: Role): Promise<RoleGrants> {
  // Owner bypasses DB entirely so stray RoleGrant rows cannot shrink access.
  if (isOwner(role)) {
    // Return the computed result to the caller.
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
  // Return the computed result to the caller.
  return g.panels;
}

/** Action keys granted to the role (mutation / API checks). */
export async function actionsForRole(role: Role): Promise<Action[]> {
  // Same owner/DB path as panelsForRole.
  const g = await getGrantsForRole(role);
  // Return the computed result to the caller.
  return g.actions;
}

/** Fast permission check used by middleware and sync command handlers. */
export async function canPerform(role: Role, action: Action): Promise<boolean> {
  // Owner short-circuit avoids a cache/DB round-trip on every request.
  if (isOwner(role)) return true;
  // Otherwise require an explicit action grant.
  const actions = await actionsForRole(role);
  // Return the computed result to the caller.
  return actions.includes(action);
}

/** Panels + actions + default landing panel for session bootstrap. */
export async function capabilitiesFor(role: Role) {
  // Parallel fetch; landing is a pure function of role.
  const [panels, actions] = await Promise.all([
    // Run next step: panelsForRole(role),
    panelsForRole(role),
    // Run next step: actionsForRole(role),
    actionsForRole(role),
  ]);
  // Bundle into the session capabilities payload.
  return {
    // Run next step: panels,
    panels,
    // Run next step: actions,
    actions,
    // Set landing on the structure being built.
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
    // Return the computed result to the caller.
    return [...OPERATIONAL_EDITABLE_ROLES];
  }
  // Other roles cannot mutate the permissions matrix.
  return [];
}

/** Ensure every matrix role has a revision row (idempotent). */
async function ensureRevisionRows() {
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

/** Per-role optimistic concurrency versions for the permissions UI. */
export async function getRoleGrantVersions(): Promise<Record<string, number>> {
  // Wait for the async step before continuing.
  await ensureRevisionRows();
  // Load rows asynchronously for the next steps.
  const rows = await prisma.roleGrantRevision.findMany({
    // Set where on the structure being built.
    where: { role: { in: [...MATRIX_ROLES] } },
    // Set select on the structure being built.
    select: { role: true, version: true },
  });
  // Capture versions for use in this scope.
  const versions: Record<string, number> = {};
  // Iterate items to apply the same logic to each entry.
  for (const role of MATRIX_ROLES) {
    // Run next step: versions[role] = 1;
    versions[role] = 1;
  }
  // Iterate items to apply the same logic to each entry.
  for (const row of rows) {
    // Run next step: versions[row.role] = row.version;
    versions[row.role] = row.version;
  }
  // Return the computed result to the caller.
  return versions;
}

/** Default revision for a matrix role that has no RoleGrantRevision row yet. */
const DEFAULT_REVISION = 1;

/**
 * Pure fold of rows read from ONE DB snapshot into grants + versions.
 * Callers must never mix rows from different reads (TD-04).
 */
export function foldMatrixSnapshot(
  // Set grantRows on the structure being built.
  grantRows: { role: Role; kind: GrantKind; key: string }[],
  // Set revisionRows on the structure being built.
  revisionRows: { role: Role; version: number }[],
// Run next step: ): {
): {
  // Set byRole on the structure being built.
  byRole: Record<string, RoleGrants>;
  // Set versions on the structure being built.
  versions: Record<string, number>;
// Run next step: } {
} {
  // Capture map for use in this scope.
  const map = foldGrantRows(grantRows);
  // Capture by role for use in this scope.
  const byRole: Record<string, RoleGrants> = {};
  // Capture versions for use in this scope.
  const versions: Record<string, number> = {};
  // Iterate items to apply the same logic to each entry.
  for (const role of MATRIX_ROLES) {
    // Run next step: byRole[role] = map.get(role) ?? emptyGrants();
    byRole[role] = map.get(role) ?? emptyGrants();
    // Run next step: versions[role] = DEFAULT_REVISION;
    versions[role] = DEFAULT_REVISION;
  }
  // Iterate items to apply the same logic to each entry.
  for (const row of revisionRows) {
    // Branch when this condition holds so the right path runs.
    if (row.role in versions) versions[row.role] = row.version;
  }
  // Return the computed result to the caller.
  return { byRole, versions };
}

/**
 * Read every grant row and revision in a single REPEATABLE READ snapshot.
 * replaceRoleGrants bumps the revision in the same transaction as the grant
 * rewrite, so a snapshot always sees either (old grants, old version) or
 * (new grants, new version) — never a mix. Deliberately bypasses the TTL cache.
 */
async function readMatrixSnapshot() {
  // Wait for the async step before continuing.
  await ensureRevisionRows();
  // Return the computed result to the caller.
  return prisma.$transaction(
    // Run next step: async (tx) => {
    async (tx) => {
      // Load grant rows asynchronously for the next steps.
      const grantRows = await tx.roleGrant.findMany();
      // Load revision rows asynchronously for the next steps.
      const revisionRows = await tx.roleGrantRevision.findMany({
        // Set where on the structure being built.
        where: { role: { in: [...MATRIX_ROLES] } },
        // Set select on the structure being built.
        select: { role: true, version: true },
      });
      // Return the computed result to the caller.
      return foldMatrixSnapshot(grantRows, revisionRows);
    },
    // Run next step: { isolationLevel: Prisma.TransactionIsolationLevel.Repeatabl…
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/**
 * Full matrix payload for the permissions admin UI (includes owner synthetic row).
 * `editableRoles` is scoped to what the acting role is allowed to change.
 * Grants and versions come from one snapshot, never from the TTL cache.
 */
export async function getFullMatrix(actorRole: Role) {
  // Load value asynchronously for the next steps.
  const { byRole, versions } = await readMatrixSnapshot();
  // Return the computed result to the caller.
  return {
    // Full catalog of panel/action keys for the matrix columns.
    panels: [...ALL_PANELS],
    // Set actions on the structure being built.
    actions: [...ALL_ACTIONS],
    // Set roles on the structure being built.
    roles: [...MATRIX_ROLES],
    // Run next step: byRole,
    byRole,
    // Run next step: versions,
    versions,
    // Which role columns the current actor may toggle.
    editableRoles: editableRolesFor(actorRole),
    // Synthetic owner row — always full catalog, never stored in RoleGrant.
    owner: { panels: [...ALL_PANELS], actions: [...ALL_ACTIONS] },
  };
}
