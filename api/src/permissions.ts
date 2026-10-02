import { Role } from "@prisma/client";

export const ALL_PANELS = [
  "mywork",
  "repairs",
  "home",
  "rooms",
  "common",
  "team",
  "live",
  "plan",
  "attendance",
  "cards",
  "results",
  "analytics",
  "cleaning",
  "audit",
  "control",
  "settings",
  "permissions",
] as const;
export type Panel = (typeof ALL_PANELS)[number];

export const ALL_ACTIONS = [
  "rooms.view",
  "rooms.mark_dirty",
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
  "people.change_role",
  "people.invite",
  "control.access",
  "settings.manage",
  "permissions.manage",
  "plan.view",
  "plan.manage",
  "attendance.view",
  "attendance.ingest",
  "attendance.request_adjustment",
  "attendance.approve_adjustment",
  "cards.view",
  "cards.issue",
  "cards.revoke",
  "analytics.view",
  "sectors.manage",
  "shifts.manage",
  "issue_options.manage",
  "audit.view",
  "jobs.view",
] as const;
export type Action = (typeof ALL_ACTIONS)[number];

/** Seed / bootstrap source only — runtime reads RoleGrant from DB. */
export const DEFAULT_PANEL_GRANTS: Record<Exclude<Role, "owner">, Panel[]> = {
  housekeeper: ["mywork", "home", "rooms", "common"],
  technician: ["mywork", "repairs", "home", "rooms", "common"],
  reception: ["home", "rooms", "common", "plan", "cards"],
  supervisor: [
    "home",
    "rooms",
    "common",
    "team",
    "live",
    "plan",
    "attendance",
    "cards",
    "results",
    "analytics",
    "cleaning",
    "repairs",
  ],
  manager: [
    "home",
    "rooms",
    "common",
    "team",
    "live",
    "plan",
    "attendance",
    "cards",
    "results",
    "analytics",
    "cleaning",
    "repairs",
    "audit",
    "control",
    "settings",
    "permissions",
  ],
  admin: [
    "home",
    "rooms",
    "common",
    "team",
    "plan",
    "attendance",
    "cards",
    "results",
    "analytics",
    "cleaning",
    "repairs",
    "audit",
    "settings",
    "permissions",
  ],
};

/** Seed / bootstrap source only — runtime reads RoleGrant from DB. */
export const DEFAULT_ACTION_GRANTS: Record<Exclude<Role, "owner">, Action[]> = {
  housekeeper: [
    "rooms.view",
    "cleaning.start",
    "cleaning.complete",
    "tickets.report",
    "attendance.request_adjustment",
  ],
  technician: [
    "rooms.view",
    "tickets.report",
    "tickets.resolve",
    "attendance.request_adjustment",
  ],
  reception: [
    "rooms.view",
    "rooms.mark_dirty",
    "cleaning.create",
    "cleaning.reassign",
    "tickets.report",
    "tickets.assign",
    "plan.view",
    "plan.manage",
    "cards.view",
    "cards.issue",
  ],
  supervisor: [
    "rooms.view",
    "rooms.mark_dirty",
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
  manager: [
    "rooms.view",
    "rooms.mark_dirty",
    "cleaning.create",
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
    "shifts.manage",
    "issue_options.manage",
    "audit.view",
    "jobs.view",
  ],
  admin: [
    "rooms.view",
    "tickets.report",
    "tickets.resolve",
    "tickets.assign",
    "tickets.close",
    "people.view",
    "people.invite",
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
    "shifts.manage",
    "issue_options.manage",
    "audit.view",
    "jobs.view",
  ],
};

export const LANDING_BY_ROLE: Record<Role, Panel> = {
  housekeeper: "mywork",
  technician: "mywork",
  reception: "rooms",
  supervisor: "rooms",
  manager: "control",
  admin: "team",
  owner: "control",
};

export const MATRIX_ROLES: Exclude<Role, "owner">[] = [
  "housekeeper",
  "technician",
  "reception",
  "supervisor",
  "manager",
  "admin",
];

export const OPERATIONAL_EDITABLE_ROLES: Exclude<Role, "owner">[] = [
  "housekeeper",
  "technician",
  "reception",
  "supervisor",
];

export function isOwner(role: Role): boolean {
  return role === Role.owner;
}

export function isPanel(key: string): key is Panel {
  return (ALL_PANELS as readonly string[]).includes(key);
}

export function isAction(key: string): key is Action {
  return (ALL_ACTIONS as readonly string[]).includes(key);
}

export function landingPanelFor(role: Role): Panel {
  return LANDING_BY_ROLE[role];
}

/** Sync fallback from defaults (seed/tests/offline client mirror only). */
export function defaultPanelsForRole(role: Role): Panel[] {
  if (isOwner(role)) return [...ALL_PANELS];
  return [...DEFAULT_PANEL_GRANTS[role as Exclude<Role, "owner">]];
}

export function defaultActionsForRole(role: Role): Action[] {
  if (isOwner(role)) return [...ALL_ACTIONS];
  return [...DEFAULT_ACTION_GRANTS[role as Exclude<Role, "owner">]];
}
