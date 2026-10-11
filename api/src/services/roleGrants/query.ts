import { Role } from "@prisma/client";
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
import { emptyGrants, getGrantMap, type RoleGrants } from "./cache";

export async function getGrantsForRole(role: Role): Promise<RoleGrants> {
  if (isOwner(role)) {
    return { panels: [...ALL_PANELS], actions: [...ALL_ACTIONS] };
  }
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
