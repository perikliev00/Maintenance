/**
 * In-process grant matrix cache (5s TTL), invalidated by RoleGrantRevision stamp.
 * Presence of a RoleGrant row = allowed; absence = not granted. Owner rows are
 * ignored if present.
 *
 * Cross-instance safety: every cache hit still reads a cheap revision stamp from
 * Postgres. Another API process that commits replaceRoleGrants bumps revisions,
 * so this process reloads before serving canPerform — without Redis.
 */
import { GrantKind, Prisma, Role } from "@prisma/client";
import { prisma } from "../../db";
import {
  MATRIX_ROLES,
  // Declare type Action for callers and internals.
  type Action,
  // Declare type Panel for callers and internals.
  type Panel,
  isAction,
  isPanel,
} from "../../permissions";

// Declare type RoleGrants for callers and internals.
export type RoleGrants = { panels: Panel[]; actions: Action[] };

// Declare type CacheEntry for callers and internals.
type CacheEntry = {
  value: Map<Role, RoleGrants>;
  loadedAt: number;
  /** Compact RoleGrantRevision fingerprint shared across API processes. */
  stamp: string;
};

let cache: CacheEntry | null = null;
/** Bumped on every invalidation so in-flight loads cannot repopulate stale rows. */
let cacheGeneration = 0;
// Capture cache ttl ms for use in this scope.
const CACHE_TTL_MS = 5_000;
// Capture max stamp reloads for use in this scope.
const MAX_STAMP_RELOADS = 3;

/** Drop the cached matrix after replace/seed so the next read hits the DB. */
export function invalidateGrantCache() {
  cacheGeneration += 1;
  cache = null;
}

/** Empty panels/actions bucket used when a role has no RoleGrant rows. */
export function emptyGrants(): RoleGrants {
  return { panels: [], actions: [] };
}

// Declare type GrantRow for callers and internals.
type GrantRow = { role: Role; kind: GrantKind; key: string };

/** Fold raw RoleGrant rows into a Map keyed by matrix role (owner rows skipped). */
export function foldGrantRows(rows: GrantRow[]): Map<Role, RoleGrants> {
  const map = new Map<Role, RoleGrants>();
  // Seed every matrix role so callers never get undefined.
  for (const role of MATRIX_ROLES) {
    // Store a keyed value for later lookup.
    map.set(role, emptyGrants());
  }
  // Iterate items to apply the same logic to each entry.
  for (const row of rows) {
    // Owner is always full-access in query layer; skip any stray DB rows.
    if (row.role === Role.owner) continue;
    const bucket = map.get(row.role) ?? emptyGrants();
    // Presence of a valid panel key = granted (dedupe pushes).
    if (row.kind === GrantKind.panel && isPanel(row.key)) {
      if (!bucket.panels.includes(row.key)) bucket.panels.push(row.key);
    }
    // Same for action keys.
    if (row.kind === GrantKind.action && isAction(row.key)) {
      if (!bucket.actions.includes(row.key)) bucket.actions.push(row.key);
    }
    // Store a keyed value for later lookup.
    map.set(row.role, bucket);
  }
  return map;
}

/**
 * Cheap cross-process fingerprint of the grant matrix. replaceRoleGrants bumps
 * RoleGrantRevision in the same transaction as the rewrite, so a new stamp is
 * visible to every API instance immediately after commit.
 */
export async function readGrantRevisionStamp(
  db: { $queryRaw: typeof prisma.$queryRaw } = prisma,
): Promise<string> {
  const rows = await db.$queryRaw<{ stamp: string }[]>`
    SELECT coalesce(
      string_agg(role::text || ':' || version::text, ',' ORDER BY role),
      ''
    ) AS stamp
    FROM "RoleGrantRevision"
  `;
  return rows[0]?.stamp ?? "";
}

async function loadGrantsWithStamp(): Promise<{
  value: Map<Role, RoleGrants>;
  stamp: string;
}> {
  // One REPEATABLE READ snapshot so grants and revisions cannot mix across a
  // concurrent replaceRoleGrants commit.
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.roleGrant.findMany();
      const stamp = await readGrantRevisionStamp(tx);
      return { value: foldGrantRows(rows), stamp };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/**
 * Full role → grants map. Serves memory only when the DB revision stamp still
 * matches and the local TTL has not elapsed. NOT safe to pair with revision
 * numbers for UI CAS (use readGrantsWithVersions / getFullMatrix for that).
 */
export async function getGrantMap(): Promise<Map<Role, RoleGrants>> {
  // Iterate items to apply the same logic to each entry.
  for (let attempt = 0; attempt < MAX_STAMP_RELOADS; attempt++) {
    const stamp = await readGrantRevisionStamp();
    // Serve from memory when stamp is unchanged and the TTL has not elapsed.
    if (
      cache &&
      cache.stamp === stamp &&
      Date.now() - cache.loadedAt < CACHE_TTL_MS
    ) {
      return cache.value;
    }
    // Capture started generation for use in this scope.
    const startedGeneration = cacheGeneration;
    const loaded = await loadGrantsWithStamp();
    // Local invalidateGrantCache during the load — discard and retry.
    if (startedGeneration !== cacheGeneration) continue;
    cache = {
      value: loaded.value,
      loadedAt: Date.now(),
      stamp: loaded.stamp,
    };
    return loaded.value;
  }
  // Continuous invalidation under extreme contention — return a fresh snapshot.
  const loaded = await loadGrantsWithStamp();
  cache = { value: loaded.value, loadedAt: Date.now(), stamp: loaded.stamp };
  return loaded.value;
}
