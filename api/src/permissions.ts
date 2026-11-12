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
  // List item in import/export/params.
  ALL_ACTIONS,
  // List item in import/export/params.
  ALL_PANELS,
  // List item in import/export/params.
  DEFAULT_PANEL_BY_ROLE,
  // Support the surrounding logic for this step.
  LANDING_BY_ROLE as LANDING_BY_ROLE_CATALOG,
  // Declare type alias Action.
  type Action,
  // Declare type alias Panel.
  type Panel,
// Support the surrounding logic for this step.
} from "./contracts/permissionsCatalog";

// Re-export catalog constants so API callers import from one module.
export { ALL_ACTIONS, ALL_PANELS };
// Re-export catalog types for middleware and services.
export type { Action, Panel };

/** Seed / bootstrap source only — runtime reads RoleGrant from DB. */
export const DEFAULT_PANEL_GRANTS: Record<Exclude<Role, "owner">, Panel[]> = {
  // Clone catalog defaults so seed code can mutate without sharing arrays.
  housekeeper: [...DEFAULT_PANEL_BY_ROLE.housekeeper],
  // Provide technician field used by this structure.
  technician: [...DEFAULT_PANEL_BY_ROLE.technician],
  // Provide reception field used by this structure.
  reception: [...DEFAULT_PANEL_BY_ROLE.reception],
  // Provide supervisor field used by this structure.
  supervisor: [...DEFAULT_PANEL_BY_ROLE.supervisor],
  // Provide manager field used by this structure.
  manager: [...DEFAULT_PANEL_BY_ROLE.manager],
  // Provide admin field used by this structure.
  admin: [...DEFAULT_PANEL_BY_ROLE.admin],
};

/** Seed / bootstrap source only — runtime reads RoleGrant from DB. */
export const DEFAULT_ACTION_GRANTS: Record<Exclude<Role, "owner">, Action[]> = {
  // Floor cleaner: own tasks, report tickets, request attendance fixes.
  housekeeper: [
    // Support the surrounding logic for this step.
    "rooms.view",
    // Support the surrounding logic for this step.
    "cleaning.start",
    // Support the surrounding logic for this step.
    "cleaning.complete",
    // Support the surrounding logic for this step.
    "tickets.report",
    // Support the surrounding logic for this step.
    "attendance.request_adjustment",
  ],
  // Technician: view rooms, resolve tickets, request attendance fixes.
  technician: [
    // Support the surrounding logic for this step.
    "rooms.view",
    // Support the surrounding logic for this step.
    "tickets.report",
    // Support the surrounding logic for this step.
    "tickets.resolve",
    // Support the surrounding logic for this step.
    "attendance.request_adjustment",
  ],
  // Front desk: occupancy, create/reassign cleaning, plan and cards.
  reception: [
    // Support the surrounding logic for this step.
    "rooms.view",
    // Support the surrounding logic for this step.
    "rooms.mark_dirty",
    // Support the surrounding logic for this step.
    "rooms.set_occupancy",
    // Support the surrounding logic for this step.
    "cleaning.create",
    // Support the surrounding logic for this step.
    "cleaning.reassign",
    // Support the surrounding logic for this step.
    "tickets.report",
    // Support the surrounding logic for this step.
    "tickets.assign",
    // Support the surrounding logic for this step.
    "plan.view",
    // Support the surrounding logic for this step.
    "plan.manage",
    // Support the surrounding logic for this step.
    "cards.view",
    // Support the surrounding logic for this step.
    "cards.issue",
  ],
  // Supervisor: inspect cleaning, live ops, attendance approve, sectors/shifts.
  supervisor: [
    // Support the surrounding logic for this step.
    "rooms.view",
    // Support the surrounding logic for this step.
    "rooms.mark_dirty",
    // Support the surrounding logic for this step.
    "rooms.manage",
    // Support the surrounding logic for this step.
    "rooms.set_occupancy",
    // Support the surrounding logic for this step.
    "rooms.set_service_status",
    // Support the surrounding logic for this step.
    "cleaning.create",
    // Support the surrounding logic for this step.
    "cleaning.start",
    // Support the surrounding logic for this step.
    "cleaning.complete",
    // Support the surrounding logic for this step.
    "cleaning.inspect",
    // Support the surrounding logic for this step.
    "cleaning.reassign",
    // Support the surrounding logic for this step.
    "cleaning.review_overdue",
    // Support the surrounding logic for this step.
    "cleaning.results_view",
    // Support the surrounding logic for this step.
    "operations.view_live",
    // Support the surrounding logic for this step.
    "tickets.report",
    // Support the surrounding logic for this step.
    "tickets.resolve",
    // Support the surrounding logic for this step.
    "tickets.assign",
    // Support the surrounding logic for this step.
    "tickets.close",
    // Support the surrounding logic for this step.
    "people.view",
    // Support the surrounding logic for this step.
    "plan.view",
    // Support the surrounding logic for this step.
    "plan.manage",
    // Support the surrounding logic for this step.
    "attendance.view",
    // Support the surrounding logic for this step.
    "attendance.approve_adjustment",
    // Support the surrounding logic for this step.
    "cards.view",
    // Support the surrounding logic for this step.
    "cards.issue",
    // Support the surrounding logic for this step.
    "analytics.view",
    // Support the surrounding logic for this step.
    "sectors.manage",
    // Support the surrounding logic for this step.
    "shifts.manage",
  ],
  // Manager: people/permissions/settings plus most operational actions.
  manager: [
    // Support the surrounding logic for this step.
    "rooms.view",
    // Support the surrounding logic for this step.
    "rooms.mark_dirty",
    // Support the surrounding logic for this step.
    "rooms.manage",
    // Support the surrounding logic for this step.
    "rooms.set_occupancy",
    // Support the surrounding logic for this step.
    "rooms.set_service_status",
    // Support the surrounding logic for this step.
    "cleaning.create",
    // Support the surrounding logic for this step.
    "cleaning.start",
    // Support the surrounding logic for this step.
    "cleaning.complete",
    // Support the surrounding logic for this step.
    "cleaning.reassign",
    // Support the surrounding logic for this step.
    "cleaning.inspect",
    // Support the surrounding logic for this step.
    "cleaning.review_overdue",
    // Support the surrounding logic for this step.
    "cleaning.results_view",
    // Support the surrounding logic for this step.
    "operations.view_live",
    // Support the surrounding logic for this step.
    "tickets.report",
    // Support the surrounding logic for this step.
    "tickets.resolve",
    // Support the surrounding logic for this step.
    "tickets.assign",
    // Support the surrounding logic for this step.
    "tickets.close",
    // Support the surrounding logic for this step.
    "people.view",
    // Support the surrounding logic for this step.
    "people.change_role",
    // Support the surrounding logic for this step.
    "people.invite",
    // Support the surrounding logic for this step.
    "people.manage_access",
    // Support the surrounding logic for this step.
    "control.access",
    // Support the surrounding logic for this step.
    "settings.manage",
    // Support the surrounding logic for this step.
    "permissions.manage",
    // Support the surrounding logic for this step.
    "plan.view",
    // Support the surrounding logic for this step.
    "plan.manage",
    // Support the surrounding logic for this step.
    "attendance.view",
    // Support the surrounding logic for this step.
    "attendance.ingest",
    // Support the surrounding logic for this step.
    "attendance.approve_adjustment",
    // Support the surrounding logic for this step.
    "cards.view",
    // Support the surrounding logic for this step.
    "cards.issue",
    // Support the surrounding logic for this step.
    "cards.revoke",
    // Support the surrounding logic for this step.
    "analytics.view",
    // Support the surrounding logic for this step.
    "sectors.manage",
    // Support the surrounding logic for this step.
    "sectors.transfer_cross",
    // Support the surrounding logic for this step.
    "shifts.manage",
    // Support the surrounding logic for this step.
    "issue_options.manage",
    // Support the surrounding logic for this step.
    "audit.view",
    // Support the surrounding logic for this step.
    "jobs.view",
    // Support the surrounding logic for this step.
    "jobs.run",
  ],
  // Admin: access control focused; fewer floor cleaning mutations than manager.
  admin: [
    // Support the surrounding logic for this step.
    "rooms.view",
    // Support the surrounding logic for this step.
    "rooms.manage",
    // Support the surrounding logic for this step.
    "rooms.set_service_status",
    // Support the surrounding logic for this step.
    "cleaning.start",
    // Support the surrounding logic for this step.
    "cleaning.complete",
    // Support the surrounding logic for this step.
    "tickets.report",
    // Support the surrounding logic for this step.
    "tickets.resolve",
    // Support the surrounding logic for this step.
    "tickets.assign",
    // Support the surrounding logic for this step.
    "tickets.close",
    // Support the surrounding logic for this step.
    "people.view",
    // Support the surrounding logic for this step.
    "people.invite",
    // Support the surrounding logic for this step.
    "people.manage_access",
    // Support the surrounding logic for this step.
    "settings.manage",
    // Support the surrounding logic for this step.
    "permissions.manage",
    // Support the surrounding logic for this step.
    "plan.view",
    // Support the surrounding logic for this step.
    "cleaning.results_view",
    // Support the surrounding logic for this step.
    "attendance.view",
    // Support the surrounding logic for this step.
    "attendance.ingest",
    // Support the surrounding logic for this step.
    "cards.view",
    // Support the surrounding logic for this step.
    "cards.issue",
    // Support the surrounding logic for this step.
    "cards.revoke",
    // Support the surrounding logic for this step.
    "analytics.view",
    // Support the surrounding logic for this step.
    "sectors.manage",
    // Support the surrounding logic for this step.
    "sectors.transfer_cross",
    // Support the surrounding logic for this step.
    "shifts.manage",
    // Support the surrounding logic for this step.
    "issue_options.manage",
    // Support the surrounding logic for this step.
    "audit.view",
    // Support the surrounding logic for this step.
    "jobs.view",
    // Support the surrounding logic for this step.
    "jobs.run",
  ],
};

/** Default first panel after login when no override is stored. */
const LANDING_BY_ROLE: Record<Role, Panel> = {
  // Map each Prisma role to the shared catalog landing panel.
  housekeeper: LANDING_BY_ROLE_CATALOG.housekeeper,
  // Provide technician field used by this structure.
  technician: LANDING_BY_ROLE_CATALOG.technician,
  // Provide reception field used by this structure.
  reception: LANDING_BY_ROLE_CATALOG.reception,
  // Provide supervisor field used by this structure.
  supervisor: LANDING_BY_ROLE_CATALOG.supervisor,
  // Provide manager field used by this structure.
  manager: LANDING_BY_ROLE_CATALOG.manager,
  // Provide admin field used by this structure.
  admin: LANDING_BY_ROLE_CATALOG.admin,
  // Provide owner field used by this structure.
  owner: LANDING_BY_ROLE_CATALOG.owner,
};

/** Roles editable in the permissions matrix UI (owner excluded). */
export const MATRIX_ROLES: Exclude<Role, "owner">[] = [
  // Support the surrounding logic for this step.
  "housekeeper",
  // Support the surrounding logic for this step.
  "technician",
  // Support the surrounding logic for this step.
  "reception",
  // Support the surrounding logic for this step.
  "supervisor",
  // Support the surrounding logic for this step.
  "manager",
  // Support the surrounding logic for this step.
  "admin",
// Support the surrounding logic for this step.
];

/** Floor roles whose grants managers typically adjust day-to-day. */
export const OPERATIONAL_EDITABLE_ROLES: Exclude<Role, "owner">[] = [
  // Support the surrounding logic for this step.
  "housekeeper",
  // Support the surrounding logic for this step.
  "technician",
  // Support the surrounding logic for this step.
  "reception",
  // Support the surrounding logic for this step.
  "supervisor",
// Support the surrounding logic for this step.
];

/** All Prisma Role values in display / matrix order (owner first). */
export const ALL_ROLES: Role[] = [
  // Support the surrounding logic for this step.
  Role.owner,
  // Support the surrounding logic for this step.
  Role.admin,
  // Support the surrounding logic for this step.
  Role.manager,
  // Support the surrounding logic for this step.
  Role.supervisor,
  // Support the surrounding logic for this step.
  Role.reception,
  // Support the surrounding logic for this step.
  Role.technician,
  // Support the surrounding logic for this step.
  Role.housekeeper,
// Support the surrounding logic for this step.
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
  // Provide actor field used by this structure.
  actor: Role,
  // Provide currentRole field used by this structure.
  currentRole: Role,
  // Provide nextRole field used by this structure.
  nextRole: Role,
// Support the surrounding logic for this step.
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

