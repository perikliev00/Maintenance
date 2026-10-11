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
const CACHE_TTL_MS = 5_000;

export function invalidateGrantCache() {
  cache = null;
}

export function emptyGrants(): RoleGrants {
  return { panels: [], actions: [] };
}

async function loadAllGrantsFromDb(): Promise<Map<Role, RoleGrants>> {
  const rows = await prisma.roleGrant.findMany();
  const map = new Map<Role, RoleGrants>();
  for (const role of MATRIX_ROLES) {
    map.set(role, emptyGrants());
  }
  for (const row of rows) {
    if (row.role === Role.owner) continue;
    const bucket = map.get(row.role) ?? emptyGrants();
    if (row.kind === GrantKind.panel && isPanel(row.key)) {
      if (!bucket.panels.includes(row.key)) bucket.panels.push(row.key);
    }
    if (row.kind === GrantKind.action && isAction(row.key)) {
      if (!bucket.actions.includes(row.key)) bucket.actions.push(row.key);
    }
    map.set(row.role, bucket);
  }
  return map;
}

export async function getGrantMap(): Promise<Map<Role, RoleGrants>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.value;
  }
  const value = await loadAllGrantsFromDb();
  cache = { value, loadedAt: Date.now() };
  return value;
}
