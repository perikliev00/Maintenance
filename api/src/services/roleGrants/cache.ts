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
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module dependency for this service.
import {
  // Run next step: MATRIX_ROLES,
  MATRIX_ROLES,
  // Declare type Action for callers and internals.
  type Action,
  // Declare type Panel for callers and internals.
  type Panel,
  // Run next step: isAction,
  isAction,
  // Run next step: isPanel,
  isPanel,
// Run next step: } from "../../permissions";
} from "../../permissions";

// Declare type RoleGrants for callers and internals.
export type RoleGrants = { panels: Panel[]; actions: Action[] };

// Declare type CacheEntry for callers and internals.
type CacheEntry = {
  // Set value on the structure being built.
  value: Map<Role, RoleGrants>;
  // Set loadedAt on the structure being built.
  loadedAt: number;
  /** Compact RoleGrantRevision fingerprint shared across API processes. */
  stamp: string;
};

// Capture cache for use in this scope.
let cache: CacheEntry | null = null;
/** Bumped on every invalidation so in-flight loads cannot repopulate stale rows. */
let cacheGeneration = 0;
// Capture cache ttl ms for use in this scope.
const CACHE_TTL_MS = 5_000;
// Capture max stamp reloads for use in this scope.
const MAX_STAMP_RELOADS = 3;

/** Drop the cached matrix after replace/seed so the next read hits the DB. */
export function invalidateGrantCache() {
  // Run next step: cacheGeneration += 1;
  cacheGeneration += 1;
  // Update cache as control flow progresses.
  cache = null;
}

/** Empty panels/actions bucket used when a role has no RoleGrant rows. */
export function emptyGrants(): RoleGrants {
  // Return the computed result to the caller.
  return { panels: [], actions: [] };
}

// Declare type GrantRow for callers and internals.
type GrantRow = { role: Role; kind: GrantKind; key: string };

/** Fold raw RoleGrant rows into a Map keyed by matrix role (owner rows skipped). */
export function foldGrantRows(rows: GrantRow[]): Map<Role, RoleGrants> {
  // Capture map for use in this scope.
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
    // Capture bucket for use in this scope.
    const bucket = map.get(row.role) ?? emptyGrants();
    // Presence of a valid panel key = granted (dedupe pushes).
    if (row.kind === GrantKind.panel && isPanel(row.key)) {
      // Branch when this condition holds so the right path runs.
      if (!bucket.panels.includes(row.key)) bucket.panels.push(row.key);
    }
    // Same for action keys.
    if (row.kind === GrantKind.action && isAction(row.key)) {
      // Branch when this condition holds so the right path runs.
      if (!bucket.actions.includes(row.key)) bucket.actions.push(row.key);
    }
    // Store a keyed value for later lookup.
    map.set(row.role, bucket);
  }
  // Return the computed result to the caller.
  return map;
}

/**
 * Cheap cross-process fingerprint of the grant matrix. replaceRoleGrants bumps
 * RoleGrantRevision in the same transaction as the rewrite, so a new stamp is
 * visible to every API instance immediately after commit.
 */
export async function readGrantRevisionStamp(
  // Set db on the structure being built.
  db: { $queryRaw: typeof prisma.$queryRaw } = prisma,
// Run next step: ): Promise<string> {
): Promise<string> {
  // Load rows asynchronously for the next steps.
  const rows = await db.$queryRaw<{ stamp: string }[]>`
    SELECT coalesce(
      string_agg(role::text || ':' || version::text, ',' ORDER BY role),
      ''
    ) AS stamp
    FROM "RoleGrantRevision"
  `;
  // Return the computed result to the caller.
  return rows[0]?.stamp ?? "";
}

// Define loadGrantsWithStamp — core behavior for this module.
async function loadGrantsWithStamp(): Promise<{
  // Set value on the structure being built.
  value: Map<Role, RoleGrants>;
  // Set stamp on the structure being built.
  stamp: string;
// Run next step: }> {
}> {
  // One REPEATABLE READ snapshot so grants and revisions cannot mix across a
  // concurrent replaceRoleGrants commit.
  return prisma.$transaction(
    // Run next step: async (tx) => {
    async (tx) => {
      // Load rows asynchronously for the next steps.
      const rows = await tx.roleGrant.findMany();
      // Load stamp asynchronously for the next steps.
      const stamp = await readGrantRevisionStamp(tx);
      // Return the computed result to the caller.
      return { value: foldGrantRows(rows), stamp };
    },
    // Run next step: { isolationLevel: Prisma.TransactionIsolationLevel.Repeatabl…
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
    // Load stamp asynchronously for the next steps.
    const stamp = await readGrantRevisionStamp();
    // Serve from memory when stamp is unchanged and the TTL has not elapsed.
    if (
      // Run next step: cache &&
      cache &&
      // Run next step: cache.stamp === stamp &&
      cache.stamp === stamp &&
      // Run next step: Date.now() - cache.loadedAt < CACHE_TTL_MS
      Date.now() - cache.loadedAt < CACHE_TTL_MS
    // Run next step: ) {
    ) {
      // Return the computed result to the caller.
      return cache.value;
    }
    // Capture started generation for use in this scope.
    const startedGeneration = cacheGeneration;
    // Load loaded asynchronously for the next steps.
    const loaded = await loadGrantsWithStamp();
    // Local invalidateGrantCache during the load — discard and retry.
    if (startedGeneration !== cacheGeneration) continue;
    // Update cache as control flow progresses.
    cache = {
      // Set value on the structure being built.
      value: loaded.value,
      // Set loadedAt on the structure being built.
      loadedAt: Date.now(),
      // Set stamp on the structure being built.
      stamp: loaded.stamp,
    };
    // Return the computed result to the caller.
    return loaded.value;
  }
  // Continuous invalidation under extreme contention — return a fresh snapshot.
  const loaded = await loadGrantsWithStamp();
  // Update cache as control flow progresses.
  cache = { value: loaded.value, loadedAt: Date.now(), stamp: loaded.stamp };
  // Return the computed result to the caller.
  return loaded.value;
}
