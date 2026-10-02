import { GrantKind, Role } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "./cleaning";
import {
  ALL_ACTIONS,
  ALL_PANELS,
  DEFAULT_ACTION_GRANTS,
  DEFAULT_PANEL_GRANTS,
  MATRIX_ROLES,
  OPERATIONAL_EDITABLE_ROLES,
  type Action,
  type Panel,
  isAction,
  isOwner,
  isPanel,
  landingPanelFor,
} from "../permissions";
import { listAuditEvents, recordAuditMany } from "./audit";

type RoleGrants = { panels: Panel[]; actions: Action[] };

type CacheEntry = { value: Map<Role, RoleGrants>; loadedAt: number };

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 5_000;

export function invalidateGrantCache() {
  cache = null;
}

function emptyGrants(): RoleGrants {
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

async function getGrantMap(): Promise<Map<Role, RoleGrants>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.value;
  }
  const value = await loadAllGrantsFromDb();
  cache = { value, loadedAt: Date.now() };
  return value;
}

/**
 * If the RoleGrant table is empty, seed all defaults.
 * If a matrix role has zero grants, seed that role's defaults only.
 * For roles that already have grants, insert any missing DEFAULT panel/action
 * keys (e.g. newly introduced actions like issue_options.manage) without
 * wiping existing customizations. Does not remove revoked-but-non-default keys.
 */
export async function ensureDefaultRoleGrants() {
  const total = await prisma.roleGrant.count();
  if (total === 0) {
    const data = [];
    for (const role of MATRIX_ROLES) {
      for (const panel of DEFAULT_PANEL_GRANTS[role]) {
        data.push({ role, kind: GrantKind.panel, key: panel });
      }
      for (const action of DEFAULT_ACTION_GRANTS[role]) {
        data.push({ role, kind: GrantKind.action, key: action });
      }
    }
    if (data.length) {
      await prisma.roleGrant.createMany({ data, skipDuplicates: true });
    }
    invalidateGrantCache();
    return;
  }

  const existing = await prisma.roleGrant.findMany({
    where: { role: { in: [...MATRIX_ROLES] } },
    select: { role: true, kind: true, key: true },
  });
  const have = new Set(
    existing.map((r) => `${r.role}|${r.kind}|${r.key}`),
  );
  const counts = new Map<Role, number>();
  for (const row of existing) {
    counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
  }

  const missing: Array<{
    role: (typeof MATRIX_ROLES)[number];
    kind: GrantKind;
    key: string;
  }> = [];

  for (const role of MATRIX_ROLES) {
    const count = counts.get(role) ?? 0;
    if (count === 0) {
      for (const panel of DEFAULT_PANEL_GRANTS[role]) {
        missing.push({ role, kind: GrantKind.panel, key: panel });
      }
      for (const action of DEFAULT_ACTION_GRANTS[role]) {
        missing.push({ role, kind: GrantKind.action, key: action });
      }
      continue;
    }
    for (const panel of DEFAULT_PANEL_GRANTS[role]) {
      if (!have.has(`${role}|${GrantKind.panel}|${panel}`)) {
        missing.push({ role, kind: GrantKind.panel, key: panel });
      }
    }
    for (const action of DEFAULT_ACTION_GRANTS[role]) {
      if (!have.has(`${role}|${GrantKind.action}|${action}`)) {
        missing.push({ role, kind: GrantKind.action, key: action });
      }
    }
  }

  if (missing.length) {
    await prisma.roleGrant.createMany({
      data: missing,
      skipDuplicates: true,
    });
  }

  invalidateGrantCache();
}

export async function getGrantsForRole(role: Role): Promise<RoleGrants> {
  if (isOwner(role)) {
    return { panels: [...ALL_PANELS], actions: [...ALL_ACTIONS] };
  }
  await ensureDefaultRoleGrants();
  const map = await getGrantMap();
  return map.get(role) ?? emptyGrants();
}

export async function panelsForRole(role: Role): Promise<Panel[]> {
  const g = await getGrantsForRole(role);
  return g.panels;
}

export async function actionsForRole(role: Role): Promise<Action[]> {
  const g = await getGrantsForRole(role);
  return g.actions;
}

export async function canPerform(role: Role, action: Action): Promise<boolean> {
  if (isOwner(role)) return true;
  const actions = await actionsForRole(role);
  return actions.includes(action);
}

export async function canAccessPanel(
  role: Role,
  panel: Panel,
): Promise<boolean> {
  if (isOwner(role)) return true;
  const panels = await panelsForRole(role);
  return panels.includes(panel);
}

export async function capabilitiesFor(role: Role) {
  const [panels, actions] = await Promise.all([
    panelsForRole(role),
    actionsForRole(role),
  ]);
  return {
    panels,
    actions,
    landing: landingPanelFor(role),
  };
}

export function editableRolesFor(actor: Role): Exclude<Role, "owner">[] {
  if (isOwner(actor)) return [...MATRIX_ROLES];
  if (actor === Role.manager || actor === Role.admin) {
    return [...OPERATIONAL_EDITABLE_ROLES];
  }
  return [];
}

export async function getFullMatrix(actorRole: Role) {
  await ensureDefaultRoleGrants();
  const map = await getGrantMap();
  const byRole: Record<string, RoleGrants> = {};
  for (const role of MATRIX_ROLES) {
    byRole[role] = map.get(role) ?? emptyGrants();
  }
  return {
    panels: [...ALL_PANELS],
    actions: [...ALL_ACTIONS],
    roles: [...MATRIX_ROLES],
    byRole,
    editableRoles: editableRolesFor(actorRole),
    owner: { panels: [...ALL_PANELS], actions: [...ALL_ACTIONS] },
  };
}

function normalizePanelsActions(
  panelsIn: string[],
  actionsIn: string[],
): RoleGrants {
  const actions = Array.from(
    new Set(actionsIn.filter(isAction)),
  ) as Action[];
  let panels = Array.from(new Set(panelsIn.filter(isPanel))) as Panel[];

  const hasManage = actions.includes("permissions.manage");
  if (hasManage && !panels.includes("permissions")) {
    panels = [...panels, "permissions"];
  }
  if (!hasManage) {
    panels = panels.filter((p) => p !== "permissions");
  }

  return { panels, actions };
}

export async function replaceRoleGrants(input: {
  targetRole: Role;
  panels: string[];
  actions: string[];
  actorRole: Role;
  actorEmployeeId: string;
  reason?: string;
}) {
  if (input.targetRole === Role.owner) {
    throw new AppError(400, "validation", "Owner grants cannot be edited");
  }
  if (!MATRIX_ROLES.includes(input.targetRole as Exclude<Role, "owner">)) {
    throw new AppError(400, "validation", `Unknown role: ${input.targetRole}`);
  }

  const editable = editableRolesFor(input.actorRole);
  if (!editable.includes(input.targetRole as Exclude<Role, "owner">)) {
    throw new AppError(
      403,
      "forbidden",
      "You cannot edit grants for this role",
    );
  }

  const next = normalizePanelsActions(input.panels, input.actions);
  const current = await getGrantsForRole(input.targetRole);

  // Guard: at least one non-owner must keep permissions.manage
  if (
    current.actions.includes("permissions.manage") &&
    !next.actions.includes("permissions.manage")
  ) {
    const map = await getGrantMap();
    let othersHave = false;
    for (const role of MATRIX_ROLES) {
      if (role === input.targetRole) continue;
      const g = map.get(role);
      if (g?.actions.includes("permissions.manage")) {
        othersHave = true;
        break;
      }
    }
    if (!othersHave) {
      throw new AppError(
        400,
        "validation",
        "Cannot remove the last permissions.manage grant from non-owner roles",
      );
    }
  }

  const panelSet = new Set(current.panels);
  const actionSet = new Set(current.actions);
  const nextPanelSet = new Set(next.panels);
  const nextActionSet = new Set(next.actions);

  const changes: Array<{
    kind: GrantKind;
    key: string;
    granted: boolean;
  }> = [];

  for (const p of next.panels) {
    if (!panelSet.has(p)) changes.push({ kind: GrantKind.panel, key: p, granted: true });
  }
  for (const p of current.panels) {
    if (!nextPanelSet.has(p)) {
      changes.push({ kind: GrantKind.panel, key: p, granted: false });
    }
  }
  for (const a of next.actions) {
    if (!actionSet.has(a)) changes.push({ kind: GrantKind.action, key: a, granted: true });
  }
  for (const a of current.actions) {
    if (!nextActionSet.has(a)) {
      changes.push({ kind: GrantKind.action, key: a, granted: false });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.roleGrant.deleteMany({ where: { role: input.targetRole } });
    const data = [
      ...next.panels.map((key) => ({
        role: input.targetRole,
        kind: GrantKind.panel,
        key,
      })),
      ...next.actions.map((key) => ({
        role: input.targetRole,
        kind: GrantKind.action,
        key,
      })),
    ];
    if (data.length) {
      await tx.roleGrant.createMany({ data });
    }
    if (changes.length) {
      await recordAuditMany(
        tx,
        changes.map((c) => ({
          actorEmployeeId: input.actorEmployeeId,
          action: c.granted ? "permission.grant" : "permission.revoke",
          entityType: "role_grant",
          entityId: `${input.targetRole}:${c.kind}:${c.key}`,
          reason: input.reason,
          before: { granted: !c.granted },
          after: {
            role: input.targetRole,
            kind: c.kind,
            key: c.key,
            granted: c.granted,
          },
          summary: `${c.granted ? "Granted" : "Revoked"} ${c.kind} ${c.key} for ${input.targetRole}`,
        })),
      );
    }
  });

  invalidateGrantCache();
  return {
    role: input.targetRole,
    panels: next.panels,
    actions: next.actions,
    changes: changes.length,
  };
}

export async function listPermissionHistory(input: {
  role?: Role;
  limit?: number;
}) {
  const rows = await listAuditEvents({
    entityType: "role_grant",
    entityIdStartsWith: input.role ? `${input.role}:` : undefined,
    limit: input.limit,
  });

  return rows.map((r) => {
    const after = (r.after ?? {}) as {
      role?: Role;
      kind?: GrantKind;
      key?: string;
      granted?: boolean;
    };
    const entityParts = r.entityId.split(":");
    const role =
      after.role ??
      (entityParts[0] && (MATRIX_ROLES as string[]).includes(entityParts[0])
        ? (entityParts[0] as Role)
        : ("" as Role));
    const kind =
      after.kind ??
      (entityParts[1] === "panel" || entityParts[1] === "action"
        ? (entityParts[1] as GrantKind)
        : GrantKind.action);
    const key = after.key ?? entityParts.slice(2).join(":") ?? r.entityId;
    const granted =
      typeof after.granted === "boolean"
        ? after.granted
        : r.action === "permission.grant";
    return {
      id: r.id,
      role,
      kind,
      key,
      granted,
      reason: r.reason,
      createdAt: r.occurredAt,
      actor: r.actor ?? {
        id: "",
        fullName: "System",
        employeeNumber: "",
      },
    };
  });
}
