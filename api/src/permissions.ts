import { Role } from "@prisma/client";

export const ALL_PANELS = ["home", "rooms", "team", "control"] as const;
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
  "tickets.report",
  "tickets.resolve",
  "people.view",
  "people.change_role",
  "control.access",
] as const;
export type Action = (typeof ALL_ACTIONS)[number];

const PANEL_GRANTS: Record<Exclude<Role, "owner">, Panel[]> = {
  housekeeper: ["home", "rooms"],
  technician: ["home", "rooms"],
  reception: ["home", "rooms"],
  supervisor: ["home", "rooms", "team"],
  manager: ["home", "rooms", "team", "control"],
  admin: ["home", "rooms", "team"],
};

const ACTION_GRANTS: Record<Exclude<Role, "owner">, Action[]> = {
  housekeeper: [
    "rooms.view",
    "cleaning.start",
    "cleaning.complete",
    "tickets.report",
  ],
  technician: ["rooms.view", "tickets.report", "tickets.resolve"],
  reception: [
    "rooms.view",
    "rooms.mark_dirty",
    "cleaning.create",
    "cleaning.reassign",
    "tickets.report",
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
    "tickets.report",
    "tickets.resolve",
    "people.view",
  ],
  manager: [
    "rooms.view",
    "rooms.mark_dirty",
    "cleaning.create",
    "cleaning.reassign",
    "cleaning.inspect",
    "cleaning.review_overdue",
    "tickets.report",
    "tickets.resolve",
    "people.view",
    "people.change_role",
    "control.access",
  ],
  admin: [
    "rooms.view",
    "tickets.report",
    "tickets.resolve",
    "people.view",
  ],
};

export const LANDING_BY_ROLE: Record<Role, Panel> = {
  housekeeper: "home",
  technician: "home",
  reception: "rooms",
  supervisor: "rooms",
  manager: "control",
  admin: "team",
  owner: "control",
};

export function isOwner(role: Role): boolean {
  return role === Role.owner;
}

export function panelsForRole(role: Role): Panel[] {
  if (isOwner(role)) return [...ALL_PANELS];
  return [...PANEL_GRANTS[role as Exclude<Role, "owner">]];
}

export function actionsForRole(role: Role): Action[] {
  if (isOwner(role)) return [...ALL_ACTIONS];
  return [...ACTION_GRANTS[role as Exclude<Role, "owner">]];
}

export function canPerform(role: Role, action: Action): boolean {
  if (isOwner(role)) return true;
  return ACTION_GRANTS[role as Exclude<Role, "owner">].includes(action);
}

export function canAccessPanel(role: Role, panel: Panel): boolean {
  if (isOwner(role)) return true;
  return PANEL_GRANTS[role as Exclude<Role, "owner">].includes(panel);
}

export function landingPanelFor(role: Role): Panel {
  return LANDING_BY_ROLE[role];
}

export function capabilitiesFor(role: Role) {
  return {
    panels: panelsForRole(role),
    actions: actionsForRole(role),
    landing: landingPanelFor(role),
  };
}
