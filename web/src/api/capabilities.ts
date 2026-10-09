export type Role =
  | "reception"
  | "housekeeper"
  | "supervisor"
  | "technician"
  | "manager"
  | "admin"
  | "owner";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "собственик",
  housekeeper: "камериер",
  technician: "техник",
  reception: "рецепция",
  supervisor: "супервайзър",
  manager: "управител",
  admin: "администратор",
};

export const ALL_ROLES: Role[] = [
  "owner",
  "admin",
  "manager",
  "supervisor",
  "reception",
  "technician",
  "housekeeper",
];

export type Panel =
  | "mywork"
  | "repairs"
  | "home"
  | "rooms"
  | "common"
  | "team"
  | "live"
  | "plan"
  | "attendance"
  | "cards"
  | "results"
  | "analytics"
  | "cleaning"
  | "audit"
  | "control"
  | "settings"
  | "permissions"
  | "notifications";

export type Action =
  | "rooms.view"
  | "rooms.mark_dirty"
  | "rooms.manage"
  | "rooms.set_occupancy"
  | "rooms.set_service_status"
  | "cleaning.create"
  | "cleaning.start"
  | "cleaning.complete"
  | "cleaning.inspect"
  | "cleaning.reassign"
  | "cleaning.review_overdue"
  | "cleaning.results_view"
  | "operations.view_live"
  | "tickets.report"
  | "tickets.resolve"
  | "tickets.assign"
  | "tickets.close"
  | "people.view"
  | "people.change_role"
  | "people.invite"
  | "control.access"
  | "settings.manage"
  | "permissions.manage"
  | "plan.view"
  | "plan.manage"
  | "attendance.view"
  | "attendance.ingest"
  | "attendance.request_adjustment"
  | "attendance.approve_adjustment"
  | "cards.view"
  | "cards.issue"
  | "cards.revoke"
  | "analytics.view"
  | "sectors.manage"
  | "sectors.transfer_cross"
  | "shifts.manage"
  | "issue_options.manage"
  | "audit.view"
  | "jobs.view";

const ALL_PANELS: Panel[] = [
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
  "notifications",
];

const PANEL_BY_ROLE: Record<Exclude<Role, "owner">, Panel[]> = {
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

const LANDING_BY_ROLE: Record<Role, Panel> = {
  housekeeper: "mywork",
  technician: "mywork",
  reception: "rooms",
  supervisor: "rooms",
  manager: "control",
  admin: "team",
  owner: "control",
};

export function isOwner(role: Role): boolean {
  return role === "owner";
}

/** Client-side mirror of server registry (offline / stale session fallback). */
export function panelsForRole(role: Role): Panel[] {
  if (isOwner(role)) return [...ALL_PANELS];
  return [...PANEL_BY_ROLE[role as Exclude<Role, "owner">]];
}

export function landingForRole(role: Role): Panel {
  return LANDING_BY_ROLE[role];
}

export function canViewTeam(role: Role): boolean {
  return panelsForRole(role).includes("team");
}

export function canViewControl(role: Role): boolean {
  return panelsForRole(role).includes("control");
}

export function canResolveIssues(role: Role): boolean {
  return isOwner(role) || ["supervisor", "manager", "technician", "admin"].includes(role);
}

export function canAssignIssues(role: Role): boolean {
  return (
    isOwner(role) ||
    ["reception", "supervisor", "manager", "admin"].includes(role)
  );
}

export function canCloseIssues(role: Role): boolean {
  return isOwner(role) || ["supervisor", "manager", "admin"].includes(role);
}

export function canPerformAction(user: AuthUser, action: Action): boolean {
  if (isOwner(user.role)) return true;
  // Explicit array (including []) is authoritative; legacy fallback only when missing.
  if (Array.isArray(user.actions)) return user.actions.includes(action);
  // Fallback mirrors when session predates capabilities
  if (action === "tickets.resolve") return canResolveIssues(user.role);
  if (action === "tickets.assign") return canAssignIssues(user.role);
  if (action === "tickets.close") return canCloseIssues(user.role);
  if (action === "people.view") return canViewTeam(user.role);
  if (action === "people.invite") {
    return ["manager", "admin"].includes(user.role);
  }
  if (action === "control.access" || action === "people.change_role") {
    return canViewControl(user.role);
  }
  if (action === "settings.manage") {
    return ["manager", "admin"].includes(user.role);
  }
  if (action === "permissions.manage") {
    return ["manager", "admin"].includes(user.role);
  }
  if (action === "operations.view_live") {
    return ["supervisor", "manager"].includes(user.role);
  }
  if (action === "cards.view" || action === "cards.issue") {
    return ["reception", "supervisor", "manager", "admin"].includes(user.role);
  }
  if (action === "cards.revoke") {
    return ["manager", "admin"].includes(user.role);
  }
  if (action === "plan.view" || action === "plan.manage") {
    return (
      ["reception", "supervisor", "manager"].includes(user.role) ||
      (action === "plan.view" && user.role === "admin")
    );
  }
  if (action === "analytics.view") {
    return ["supervisor", "manager", "admin"].includes(user.role);
  }
  if (action === "sectors.manage" || action === "shifts.manage") {
    return ["supervisor", "manager", "admin"].includes(user.role);
  }
  if (action === "sectors.transfer_cross") {
    return ["manager", "admin"].includes(user.role);
  }
  if (action === "rooms.manage") {
    return ["supervisor", "manager", "admin"].includes(user.role);
  }
  if (action === "rooms.set_occupancy") {
    return ["reception", "supervisor", "manager"].includes(user.role);
  }
  if (action === "rooms.set_service_status") {
    return ["supervisor", "manager", "admin"].includes(user.role);
  }
  if (action === "issue_options.manage") {
    return ["manager", "admin"].includes(user.role);
  }
  if (action === "audit.view" || action === "jobs.view") {
    return ["manager", "admin"].includes(user.role);
  }
  return false;
}

export function panelsForUser(user: AuthUser): Panel[] {
  // Explicit array (including []) is authoritative; legacy fallback only when missing.
  const base = Array.isArray(user.panels)
    ? [...user.panels]
    : [...panelsForRole(user.role)];
  if (!base.includes("notifications")) {
    base.push("notifications");
  }
  return base;
}

export type ModuleToggles = {
  rooms: boolean;
  common: boolean;
  cleaning: boolean;
  maintenance: boolean;
  my_work?: boolean;
  repairs?: boolean;
  team: boolean;
  live: boolean;
  control: boolean;
  daily_plan: boolean;
  attendance: boolean;
  access_cards: boolean;
  analytics: boolean;
  audit?: boolean;
};

/** Apply module toggles from public settings onto role panels. */
export function filterPanelsByModules(
  panels: Panel[],
  modules?: ModuleToggles | null,
): Panel[] {
  if (!modules) return panels;
  return panels.filter((p) => {
    if (p === "rooms") return modules.rooms !== false;
    if (p === "common") return modules.common !== false;
    if (p === "team") return modules.team !== false;
    if (p === "live") return modules.live !== false;
    if (p === "plan") return modules.daily_plan !== false;
    if (p === "control") return modules.control !== false;
    if (p === "attendance") return modules.attendance !== false;
    if (p === "cards") return modules.access_cards !== false;
    if (p === "results") return modules.analytics !== false;
    if (p === "analytics") return modules.analytics !== false;
    if (p === "cleaning") return modules.cleaning !== false;
    if (p === "mywork") {
      return (
        modules.my_work !== false &&
        (modules.maintenance !== false || modules.cleaning !== false)
      );
    }
    if (p === "repairs") {
      return modules.repairs !== false && modules.maintenance !== false;
    }
    if (p === "audit") return modules.audit !== false;
    // permissions / settings follow role grants
    if (p === "home") {
      return modules.maintenance !== false || modules.cleaning !== false;
    }
    return true;
  });
}

export function landingForUser(user: AuthUser): Panel {
  if (user.landing) return user.landing;
  return landingForRole(user.role);
}

/** Roles the actor may assign via Control (mirrors API policy). */
export function assignableRolesFor(actor: Role): Role[] {
  if (actor === "owner") return [...ALL_ROLES];
  // Non-owners never assign owner/admin, even with people.change_role.
  return ALL_ROLES.filter((r) => r !== "owner" && r !== "admin");
}

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  employeeId: string;
  fullName: string;
  panels?: Panel[];
  actions?: Action[];
  landing?: Panel;
  /** Set for supervisors — count of active sectors they primarily supervise. */
  supervisedSectorCount?: number | null;
};
