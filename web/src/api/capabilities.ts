/**
 * Client-side role / panel / action helpers.
 *
 * Prefer server-provided `user.panels` and `user.actions` when present; role
 * tables here are a fallback for stale sessions and offline UI gating.
 * Catalogs come from `api/src/contracts/permissionsCatalog` (single source).
 */
import {
  ALL_ACTIONS,
  ALL_PANELS,
  DEFAULT_PANEL_BY_ROLE,
  LANDING_BY_ROLE as LANDING_BY_ROLE_CATALOG,
  type Action,
  type Panel,
} from "../../../api/src/contracts/permissionsCatalog";

export type Role =
  | "reception"
  | "housekeeper"
  | "supervisor"
  | "technician"
  | "manager"
  | "admin"
  | "owner";

/** Display labels (Bulgarian) for role chips in the shell. */
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

export { ALL_ACTIONS, ALL_PANELS };
export type { Action, Panel };

/** Offline / stale-session fallback panels (same data as API seed defaults). */
const PANEL_BY_ROLE: Record<Exclude<Role, "owner">, Panel[]> = {
  housekeeper: [...DEFAULT_PANEL_BY_ROLE.housekeeper],
  technician: [...DEFAULT_PANEL_BY_ROLE.technician],
  reception: [...DEFAULT_PANEL_BY_ROLE.reception],
  supervisor: [...DEFAULT_PANEL_BY_ROLE.supervisor],
  manager: [...DEFAULT_PANEL_BY_ROLE.manager],
  admin: [...DEFAULT_PANEL_BY_ROLE.admin],
};

const LANDING_BY_ROLE: Record<Role, Panel> = {
  housekeeper: LANDING_BY_ROLE_CATALOG.housekeeper,
  technician: LANDING_BY_ROLE_CATALOG.technician,
  reception: LANDING_BY_ROLE_CATALOG.reception,
  supervisor: LANDING_BY_ROLE_CATALOG.supervisor,
  manager: LANDING_BY_ROLE_CATALOG.manager,
  admin: LANDING_BY_ROLE_CATALOG.admin,
  owner: LANDING_BY_ROLE_CATALOG.owner,
};

/** Owner bypasses all client-side capability checks. */
export function isOwner(role: Role): boolean {
  // Return value / early exit.
  return role === "owner";
}

/** Privileged accounts (owner/admin) — mirrors server `isPrivilegedRole`. */
export function isPrivilegedRole(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Whether the actor may manage access (block/archive/device revoke) for a
 * target role. Non-owners cannot manage owner/admin targets.
 */
export function canManagePersonAccess(
  actorRole: Role,
  targetRole: Role | null,
): boolean {
  if (targetRole == null) return true;
  if (isPrivilegedRole(targetRole) && !isOwner(actorRole)) return false;
  return true;
}

/** Client-side mirror of server registry (offline / stale session fallback). */
export function panelsForRole(role: Role): Panel[] {
  // Branch: conditional gate.
  if (isOwner(role)) return [...ALL_PANELS];
  // Return value / early exit.
  return [...PANEL_BY_ROLE[role as Exclude<Role, "owner">]];
}

/** Default first panel after login when the user has no `landing` from the API. */
export function landingForRole(role: Role): Panel {
  // Return value / early exit.
  return LANDING_BY_ROLE[role];
}

/**
 * Helper `canViewTeam`.
 */
export function canViewTeam(role: Role): boolean {
  // Return value / early exit.
  return panelsForRole(role).includes("team");
}

/**
 * Helper `canViewControl`.
 */
export function canViewControl(role: Role): boolean {
  // Return value / early exit.
  return panelsForRole(role).includes("control");
}

/**
 * Internal role heuristics for pre-capabilities sessions only.
 * Not exported (SEC-003 / B3) — UI must use `canPerformAction` so `user.actions`
 * remains authoritative when present (including empty arrays).
 */
function legacyTicketResolve(role: Role): boolean {
  return isOwner(role) || ["supervisor", "manager", "technician", "admin"].includes(role);
}

function legacyTicketAssign(role: Role): boolean {
  return (
    isOwner(role) ||
    ["reception", "supervisor", "manager", "admin"].includes(role)
  );
}

function legacyTicketClose(role: Role): boolean {
  return isOwner(role) || ["supervisor", "manager", "admin"].includes(role);
}

/**
 * Gate a UI action. Explicit `user.actions` (including empty) wins; otherwise
 * fall back to role heuristics so older sessions still work offline.
 */
export function canPerformAction(user: AuthUser, action: Action): boolean {
  // Branch: conditional gate.
  if (isOwner(user.role)) return true;
  // Explicit array (including []) is authoritative; legacy fallback only when missing.
  if (Array.isArray(user.actions)) return user.actions.includes(action);
  // Fallback when session predates capabilities (actions omitted, not []).
  if (action === "tickets.resolve") return legacyTicketResolve(user.role);
  if (action === "tickets.assign") return legacyTicketAssign(user.role);
  if (action === "tickets.close") return legacyTicketClose(user.role);
  // Branch: conditional gate.
  if (action === "people.view") return canViewTeam(user.role);
  // Branch: conditional gate.
  if (action === "people.invite" || action === "people.manage_access") {
    // Return value / early exit.
    return ["manager", "admin"].includes(user.role);
  }
  // Branch: conditional gate.
  if (action === "control.access" || action === "people.change_role") {
    // Return value / early exit.
    return canViewControl(user.role);
  }
  // Branch: conditional gate.
  if (action === "settings.manage") {
    // Return value / early exit.
    return ["manager", "admin"].includes(user.role);
  }
  // Branch: conditional gate.
  if (action === "permissions.manage") {
    // Return value / early exit.
    return ["manager", "admin"].includes(user.role);
  }
  // Branch: conditional gate.
  if (action === "operations.view_live") {
    // Return value / early exit.
    return ["supervisor", "manager"].includes(user.role);
  }
  // Branch: conditional gate.
  if (action === "cards.view" || action === "cards.issue") {
    // Return value / early exit.
    return ["reception", "supervisor", "manager", "admin"].includes(user.role);
  }
  // Branch: conditional gate.
  if (action === "cards.revoke") {
    // Return value / early exit.
    return ["manager", "admin"].includes(user.role);
  }
  // Branch: conditional gate.
  if (action === "plan.view" || action === "plan.manage") {
    // Return value / early exit.
    return (
      ["reception", "supervisor", "manager"].includes(user.role) ||
      (action === "plan.view" && user.role === "admin")
    );
  }
  // Branch: conditional gate.
  if (action === "analytics.view") {
    // Return value / early exit.
    return ["supervisor", "manager", "admin"].includes(user.role);
  }
  // Branch: conditional gate.
  if (action === "sectors.manage" || action === "shifts.manage") {
    // Return value / early exit.
    return ["supervisor", "manager", "admin"].includes(user.role);
  }
  // Branch: conditional gate.
  if (action === "sectors.transfer_cross") {
    // Return value / early exit.
    return ["manager", "admin"].includes(user.role);
  }
  // Branch: conditional gate.
  if (action === "rooms.manage") {
    // Return value / early exit.
    return ["supervisor", "manager", "admin"].includes(user.role);
  }
  // Branch: conditional gate.
  if (action === "rooms.set_occupancy") {
    // Return value / early exit.
    return ["reception", "supervisor", "manager"].includes(user.role);
  }
  // Branch: conditional gate.
  if (action === "rooms.set_service_status") {
    // Return value / early exit.
    return ["supervisor", "manager", "admin"].includes(user.role);
  }
  // Branch: conditional gate.
  if (action === "issue_options.manage") {
    // Return value / early exit.
    return ["manager", "admin"].includes(user.role);
  }
  // Branch: conditional gate.
  if (
    action === "audit.view" ||
    action === "jobs.view" ||
    action === "jobs.run"
  ) {
    // Return value / early exit.
    return ["manager", "admin"].includes(user.role);
  }
  // Return value / early exit.
  return false;
}

/**
 * Panels the user may open. Server RoleGrant `panels` is authoritative
 * (FEAT-001 / B1 — notifications is a real catalog panel, not client-forced).
 */
export function panelsForUser(user: AuthUser): Panel[] {
  // Explicit array (including []) is authoritative; legacy fallback only when missing.
  if (Array.isArray(user.panels)) {
    return [...user.panels];
  }
  return [...panelsForRole(user.role)];
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
  // Branch: conditional gate.
  if (!modules) return panels;
  // Return value / early exit.
  return panels.filter((p) => {
    // Branch: conditional gate.
    if (p === "rooms") return modules.rooms !== false;
    // Branch: conditional gate.
    if (p === "common") return modules.common !== false;
    // Branch: conditional gate.
    if (p === "team") return modules.team !== false;
    // Branch: conditional gate.
    if (p === "live") return modules.live !== false;
    // Branch: conditional gate.
    if (p === "plan") return modules.daily_plan !== false;
    // Branch: conditional gate.
    if (p === "control") return modules.control !== false;
    // Branch: conditional gate.
    if (p === "attendance") return modules.attendance !== false;
    // Branch: conditional gate.
    if (p === "cards") return modules.access_cards !== false;
    // Branch: conditional gate.
    if (p === "results") return modules.analytics !== false;
    // Branch: conditional gate.
    if (p === "analytics") return modules.analytics !== false;
    // Branch: conditional gate.
    if (p === "cleaning") return modules.cleaning !== false;
    // Branch: conditional gate.
    if (p === "mywork") {
      // Return value / early exit.
      return (
        modules.my_work !== false &&
        (modules.maintenance !== false || modules.cleaning !== false)
      );
    }
    // Branch: conditional gate.
    if (p === "repairs") {
      // Return value / early exit.
      return modules.repairs !== false && modules.maintenance !== false;
    }
    // Branch: conditional gate.
    if (p === "audit") return modules.audit !== false;
    // permissions / settings follow role grants
    if (p === "home") {
      // Return value / early exit.
      return modules.maintenance !== false || modules.cleaning !== false;
    }
    // Return value / early exit.
    return true;
  });
}

/** Prefer server `landing`; else role default. */
export function landingForUser(user: AuthUser): Panel {
  // Branch: conditional gate.
  if (user.landing) return user.landing;
  // Return value / early exit.
  return landingForRole(user.role);
}

/** Roles the actor may assign via Control (mirrors API policy). */
export function assignableRolesFor(actor: Role): Role[] {
  // Branch: conditional gate.
  if (actor === "owner") return [...ALL_ROLES];
  // Non-owners never assign owner/admin, even with people.change_role.
  return ALL_ROLES.filter((r) => r !== "owner" && r !== "admin");
}

/** Session identity + optional capability fields from `/auth/me`. */
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
