/**
 * Permission catalog and role-assignment policy for the hotel ops UI.
 *
 * Panel/action catalogs live in `./contracts/permissionsCatalog` (shared with web).
 * DEFAULT_*_GRANTS seed RoleGrant rows; runtime authorization reads DB grants.
 * Owner is excluded from matrix defaults — owners bypass or are handled separately.
 */
// Prisma Role enum used by assignment helpers and grant maps.
import { Role } from "@prisma/client";
// Shared catalog of panels/actions and default panel/landing tables.
import {
  ALL_ACTIONS,
  ALL_PANELS,
  DEFAULT_PANEL_BY_ROLE,
  LANDING_BY_ROLE as LANDING_BY_ROLE_CATALOG,
  type Action,
  type Panel,
} from "./contracts/permissionsCatalog";

// Re-export catalog constants so API callers import from one module.
export { ALL_ACTIONS, ALL_PANELS };
// Re-export catalog types for middleware and services.
export type { Action, Panel };

/** Seed / bootstrap source only — runtime reads RoleGrant from DB. */
export const DEFAULT_PANEL_GRANTS: Record<Exclude<Role, "owner">, Panel[]> = {
  // Clone catalog defaults so seed code can mutate without sharing arrays.
  housekeeper: [...DEFAULT_PANEL_BY_ROLE.housekeeper],
  technician: [...DEFAULT_PANEL_BY_ROLE.technician],
  reception: [...DEFAULT_PANEL_BY_ROLE.reception],
  supervisor: [...DEFAULT_PANEL_BY_ROLE.supervisor],
  manager: [...DEFAULT_PANEL_BY_ROLE.manager],
  admin: [...DEFAULT_PANEL_BY_ROLE.admin],
};

/** Seed / bootstrap source only — runtime reads RoleGrant from DB. */
export const DEFAULT_ACTION_GRANTS: Record<Exclude<Role, "owner">, Action[]> = {
  // Floor cleaner: own tasks, report tickets, request attendance fixes.
  housekeeper: [
    "rooms.view",
    "cleaning.start",
    "cleaning.complete",
    "tickets.report",
    "attendance.request_adjustment",
  ],
  // Technician: view rooms, resolve tickets, request attendance fixes.
  technician: [
    "rooms.view",
    "tickets.report",
    "tickets.resolve",
    "attendance.request_adjustment",
  ],
  // Front desk: occupancy, create/reassign cleaning, plan and cards.
  reception: [
    "rooms.view",
    "rooms.mark_dirty",
    "rooms.set_occupancy",
    "cleaning.create",
    "cleaning.reassign",
    "tickets.report",
    "tickets.assign",
    "plan.view",
    "plan.manage",
    "cards.view",
    "cards.issue",
  ],
  // Supervisor: inspect cleaning, live ops, attendance approve, sectors/shifts.
  supervisor: [
    "rooms.view",
    "rooms.mark_dirty",
    "rooms.manage",
    "rooms.set_occupancy",
    "rooms.set_service_status",
    "cleaning.create",
    "cleaning.start",
    "cleaning.complete",
    "cleaning.inspect",
    "cleaning.reassign",
    "cleaning.review_overdue",
    "cleaning.results_view",
    "operations.view_live",
    "tickets.report",
    "tickets.resolve",
    "tickets.assign",
    "tickets.close",
    "people.view",
    "plan.view",
    "plan.manage",
    "attendance.view",
    "attendance.approve_adjustment",
    "cards.view",
    "cards.issue",
    "analytics.view",
    "sectors.manage",
    "shifts.manage",
  ],
  // Manager: people/permissions/settings plus most operational actions.
  manager: [
    "rooms.view",
    "rooms.mark_dirty",
    "rooms.manage",
    "rooms.set_occupancy",
    "rooms.set_service_status",
    "cleaning.create",
    "cleaning.start",
    "cleaning.complete",
    "cleaning.reassign",
    "cleaning.inspect",
    "cleaning.review_overdue",
    "cleaning.results_view",
    "operations.view_live",
    "tickets.report",
    "tickets.resolve",
    "tickets.assign",
    "tickets.close",
    "people.view",
    "people.change_role",
    "people.invite",
    "people.manage_access",
    "control.access",
    "settings.manage",
    "permissions.manage",
    "plan.view",
    "plan.manage",
    "attendance.view",
    "attendance.ingest",
    "attendance.approve_adjustment",
    "cards.view",
    "cards.issue",
    "cards.revoke",
    "analytics.view",
    "sectors.manage",
    "sectors.transfer_cross",
    "shifts.manage",
    "issue_options.manage",
    "audit.view",
    "jobs.view",
    "jobs.run",
  ],
  // Admin: access control focused; fewer floor cleaning mutations than manager.
  admin: [
    "rooms.view",
    "rooms.manage",
    "rooms.set_service_status",
    "cleaning.start",
    "cleaning.complete",
    "tickets.report",
    "tickets.resolve",
    "tickets.assign",
    "tickets.close",
    "people.view",
    "people.invite",
    "people.manage_access",
    "settings.manage",
    "permissions.manage",
    "plan.view",
    "cleaning.results_view",
    "attendance.view",
    "attendance.ingest",
    "cards.view",
    "cards.issue",
    "cards.revoke",
    "analytics.view",
    "sectors.manage",
    "sectors.transfer_cross",
    "shifts.manage",
    "issue_options.manage",
    "audit.view",
    "jobs.view",
    "jobs.run",
  ],
};

/** Default first panel after login when no override is stored. */
const LANDING_BY_ROLE: Record<Role, Panel> = {
  // Map each Prisma role to the shared catalog landing panel.
  housekeeper: LANDING_BY_ROLE_CATALOG.housekeeper,
  technician: LANDING_BY_ROLE_CATALOG.technician,
  reception: LANDING_BY_ROLE_CATALOG.reception,
  supervisor: LANDING_BY_ROLE_CATALOG.supervisor,
  manager: LANDING_BY_ROLE_CATALOG.manager,
  admin: LANDING_BY_ROLE_CATALOG.admin,
  owner: LANDING_BY_ROLE_CATALOG.owner,
};

/** Roles editable in the permissions matrix UI (owner excluded). */
export const MATRIX_ROLES: Exclude<Role, "owner">[] = [
  "housekeeper",
  "technician",
  "reception",
  "supervisor",
  "manager",
  "admin",
];

/** Floor roles whose grants managers typically adjust day-to-day. */
export const OPERATIONAL_EDITABLE_ROLES: Exclude<Role, "owner">[] = [
  "housekeeper",
  "technician",
  "reception",
  "supervisor",
];

/** All Prisma Role values in display / matrix order (owner first). */
export const ALL_ROLES: Role[] = [
  Role.owner,
  Role.admin,
  Role.manager,
  Role.supervisor,
  Role.reception,
  Role.technician,
  Role.housekeeper,
];

/** Whether the role is the hotel owner (full bypass / special assignment rules). */
export function isOwner(role: Role): boolean {
  // Owner is the only full-bypass role in assignment and matrix rules.
  return role === Role.owner;
}

/** Owner and admin — restricted for non-owner role assignment. */
export function isPrivilegedRole(role: Role): boolean {
  // Privileged roles may only be assigned by an owner.
  return role === Role.owner || role === Role.admin;
}

/**
 * Roles the actor may assign via people.change_role / people.invite.
 * Having the action is not enough for owner/admin — only owner may assign those.
 */
export function assignableRolesFor(actor: Role): Role[] {
  // Owner may assign any role including owner/admin.
  if (isOwner(actor)) return [...ALL_ROLES];
  // Everyone else is limited to non-privileged floor/ops roles.
  return ALL_ROLES.filter((r) => !isPrivilegedRole(r));
}

/**
 * Whether actor may change a user from currentRole to nextRole.
 * Non-owners cannot assign privileged roles or modify privileged users.
 */
export function canChangeUserRole(
  actor: Role,
  currentRole: Role,
  nextRole: Role,
): boolean {
  // Target role must be in the actor's assignable set.
  if (!assignableRolesFor(actor).includes(nextRole)) return false;
  // Non-owners cannot touch users who are already owner/admin.
  if (isPrivilegedRole(currentRole) && !isOwner(actor)) return false;
  // Both gates passed — role change is allowed.
  return true;
}

/** Type guard: string is a known panel catalog key. */
export function isPanel(key: string): key is Panel {
  // Narrow unknown strings against the panel catalog.
  return (ALL_PANELS as readonly string[]).includes(key);
}

/** Type guard: string is a known action catalog key. */
export function isAction(key: string): key is Action {
  // Narrow unknown strings against the action catalog.
  return (ALL_ACTIONS as readonly string[]).includes(key);
}

/** Default landing panel for a role after login. */
export function landingPanelFor(role: Role): Panel {
  // Lookup table is the single source for post-login home panel.
  return LANDING_BY_ROLE[role];
}

