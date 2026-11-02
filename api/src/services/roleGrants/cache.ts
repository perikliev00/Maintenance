/**
 * In-process grant matrix cache (5s TTL). Presence of a RoleGrant row = allowed;
 * absence = not granted. Owner rows are ignored if present.
 */
import { GrantKind, Role } from "@prisma/client";
import { prisma } from "../../db";
import {
  MATRIX_ROLES,
  type Action,
  type Panel,
  isAction,
  isPanel,
} from "../../permissions";

export type RoleGrants = { panels: Panel[]; actions: Action[] };

type CacheEntry = { value: Map<Role, RoleGrants>; loadedAt: number };

let cache: CacheEntry | null = null;
/** Bumped on every invalidation so in-flight loads cannot repopulate stale rows. */
let cacheGeneration = 0;
const CACHE_TTL_MS = 5_000;

/** Drop the cached matrix after replace/seed so the next read hits the DB. */
export function invalidateGrantCache() {
  cacheGeneration += 1;
  cache = null;
}

/** Empty panels/actions bucket used when a role has no RoleGrant rows. */
export function emptyGrants(): RoleGrants {
  return { panels: [], actions: [] };
}

type GrantRow = { role: Role; kind: GrantKind; key: string };

/** Fold raw RoleGrant rows into a Map keyed by matrix role (owner rows skipped). */
export function foldGrantRows(rows: GrantRow[]): Map<Role, RoleGrants> {
  const map = new Map<Role, RoleGrants>();
  // Seed every matrix role so callers never get undefined.
  for (const role of MATRIX_ROLES) {
    map.set(role, emptyGrants());
  }
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
    map.set(row.role, bucket);
  }
  return map;
}

/** Load every RoleGrant row and fold into a Map keyed by matrix role. */
async function loadAllGrantsFromDb(): Promise<Map<Role, RoleGrants>> {
  // Full table scan — matrix is small; cached for CACHE_TTL_MS.
  const rows = await prisma.roleGrant.findMany();
  return foldGrantRows(rows);
}

/**
 * Full role → grants map, refreshed at most every CACHE_TTL_MS.
 * NOT safe to pair with revision numbers (use readGrantsWithVersions for that).
 */
export async function getGrantMap(): Promise<Map<Role, RoleGrants>> {
  // Serve from memory when the TTL has not elapsed.
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.value;
  }
  // A load that started before an invalidation may hold pre-write rows;
  // only publish it if no invalidation happened while it was in flight.
  const startedGeneration = cacheGeneration;
  const value = await loadAllGrantsFromDb();
  if (startedGeneration === cacheGeneration) {
    cache = { value, loadedAt: Date.now() };
  }
  return value;
}