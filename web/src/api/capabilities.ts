/**
 * Client-side role / panel / action helpers.
 *
 * Prefer server-provided `user.panels` and `user.actions` when present; role
 * tables here are a fallback for stale sessions and offline UI gating.
 * Catalogs come from `api/src/contracts/permissionsCatalog` (single source).
 */
import {
  // List item in import/export/params.
  ALL_ACTIONS,
  // List item in import/export/params.
  ALL_PANELS,
  // List item in import/export/params.
  DEFAULT_PANEL_BY_ROLE,
  // Continue multi-line list/arguments.
  LANDING_BY_ROLE as LANDING_BY_ROLE_CATALOG,
  // Local type alias shaping data.
  type Action,
  // Local type alias shaping data.
  type Panel,
// Close multi-line construct with trailing syntax.
} from "../../../api/src/contracts/permissionsCatalog";

// Export type alias for consumers.
export type Role =
  // Union/intersection type member.
  | "reception"
  // Union/intersection type member.
  | "housekeeper"
  // Union/intersection type member.
  | "supervisor"
  // Union/intersection type member.
  | "technician"
  // Union/intersection type member.
  | "manager"
  // Union/intersection type member.
  | "admin"
  // Union/intersection type member.
  | "owner";

/** Display labels (Bulgarian) for role chips in the shell. */
export const ROLE_LABELS: Record<Role, string> = {
  // Field/property in this shape.
  owner: "собственик",
  // Field/property in this shape.
  housekeeper: "камериер",
  // Field/property in this shape.
  technician: "техник",
  // Field/property in this shape.
  reception: "рецепция",
  // Field/property in this shape.
  supervisor: "супервайзър",
  // Field/property in this shape.
  manager: "управител",
  // Field/property in this shape.
  admin: "администратор",
};

// Exported constant / binding.
export const ALL_ROLES: Role[] = [
  // Continue multi-line list/arguments.
  "owner",
  // Continue multi-line list/arguments.
  "admin",
  // Continue multi-line list/arguments.
  "manager",
  // Continue multi-line list/arguments.
  "supervisor",
  // Continue multi-line list/arguments.
  "reception",
  // Continue multi-line list/arguments.
  "technician",
  // Continue multi-line list/arguments.
  "housekeeper",
];

// Re-export selected public symbols.
export { ALL_ACTIONS, ALL_PANELS };
// Export type alias for consumers.
export type { Action, Panel };

/** Offline / stale-session fallback panels (same data as API seed defaults). */
const PANEL_BY_ROLE: Record<Exclude<Role, "owner">, Panel[]> = {
  // Field/property in this shape.
  housekeeper: [...DEFAULT_PANEL_BY_ROLE.housekeeper],
  // Field/property in this shape.
  technician: [...DEFAULT_PANEL_BY_ROLE.technician],
  // Field/property in this shape.
  reception: [...DEFAULT_PANEL_BY_ROLE.reception],
  // Field/property in this shape.
  supervisor: [...DEFAULT_PANEL_BY_ROLE.supervisor],
  // Field/property in this shape.
  manager: [...DEFAULT_PANEL_BY_ROLE.manager],
  // Field/property in this shape.
  admin: [...DEFAULT_PANEL_BY_ROLE.admin],
};

// Local constant binding.
const LANDING_BY_ROLE: Record<Role, Panel> = {
  // Field/property in this shape.
  housekeeper: LANDING_BY_ROLE_CATALOG.housekeeper,
  // Field/property in this shape.
  technician: LANDING_BY_ROLE_CATALOG.technician,
  // Field/property in this shape.
  reception: LANDING_BY_ROLE_CATALOG.reception,
  // Field/property in this shape.
  supervisor: LANDING_BY_ROLE_CATALOG.supervisor,
  // Field/property in this shape.
  manager: LANDING_BY_ROLE_CATALOG.manager,
  // Field/property in this shape.
  admin: LANDING_BY_ROLE_CATALOG.admin,
  // Field/property in this shape.
  owner: LANDING_BY_ROLE_CATALOG.owner,
};

/** Owner bypasses all client-side capability checks. */
export function isOwner(role: Role): boolean {
  // Return value / early exit.
  return role === "owner";
}

/** Privileged accounts (owner/admin) — mirrors server `isPrivilegedRole`. */
export function isPrivilegedRole(role: Role): boolean {
  // Return computed result to caller.
  return role === "owner" || role === "admin";
}

/**
 * Whether the actor may manage access (block/archive/device revoke) for a
 * target role. Non-owners cannot manage owner/admin targets.
 */
export function canManagePersonAccess(
  // Field/property in this shape.
  actorRole: Role,
  // Field/property in this shape.
  targetRole: Role | null,
// Open multi-line construct.
): boolean {
  // Conditional branch for this case.
  if (targetRole == null) return true;
  // Conditional branch for this case.
  if (isPrivilegedRole(targetRole) && !isOwner(actorRole)) return false;
  // Return computed result to caller.
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
  // Return computed result to caller.
  return isOwner(role) || ["supervisor", "manager", "technician", "admin"].includes(role);
}

// Function definition.
function legacyTicketAssign(role: Role): boolean {
  // Return computed result to caller.
  return (
    // Invoke helper or pass arguments.
    isOwner(role) ||
    // Invoke helper or pass arguments.
    ["reception", "supervisor", "manager", "admin"].includes(role)
  );
}

// Function definition.
function legacyTicketClose(role: Role): boolean {
  // Return computed result to caller.
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
  // Conditional branch for this case.
  if (action === "tickets.assign") return legacyTicketAssign(user.role);
  // Conditional branch for this case.
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
      // Invoke helper or pass arguments.
      ["reception", "supervisor", "manager"].includes(user.role) ||
      // Assign value for subsequent use.
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
    // Assign value for subsequent use.
    action === "audit.view" ||
    // Assign value for subsequent use.
    action === "jobs.view" ||
    // Assign value for subsequent use.
    action === "jobs.run"
  // Open multi-line construct.
  ) {
    // Return value / early exit.
    return ["manager", "admin"].includes(user.role);
  }
  // Return value / early exit.
  return false;
}

/**
 * Panels the user may open. Server RoleGrant `panels` is authoritative
 * (FEAT-001 — notifications comes from the grant matrix / one-shot seed, not
 * a client-forced panel).
 */
export function panelsForUser(user: AuthUser): Panel[] {
  // Explicit array (including []) is authoritative; legacy fallback only when missing.
  if (Array.isArray(user.panels)) {
    // Return computed result to caller.
    return [...user.panels];
  }
  // Return computed result to caller.
  return [...panelsForRole(user.role)];
}

// Export type alias for consumers.
export type ModuleToggles = {
  // Field/property in this shape.
  rooms: boolean;
  // Field/property in this shape.
  common: boolean;
  // Field/property in this shape.
  cleaning: boolean;
  // Field/property in this shape.
  maintenance: boolean;
  // Field/property in this shape.
  my_work?: boolean;
  // Field/property in this shape.
  repairs?: boolean;
  // Field/property in this shape.
  team: boolean;
  // Field/property in this shape.
  live: boolean;
  // Field/property in this shape.
  control: boolean;
  // Field/property in this shape.
  daily_plan: boolean;
  // Field/property in this shape.
  attendance: boolean;
  // Field/property in this shape.
  access_cards: boolean;
  // Field/property in this shape.
  analytics: boolean;
  // Field/property in this shape.
  audit?: boolean;
};

/** Apply module toggles from public settings onto role panels. */
export function filterPanelsByModules(
  // Field/property in this shape.
  panels: Panel[],
  // Field/property in this shape.
  modules?: ModuleToggles | null,
// Open multi-line construct.
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
        // Assign value for subsequent use.
        modules.my_work !== false &&
        // Assign value for subsequent use.
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
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  email: string;
  // Field/property in this shape.
  role: Role;
  // Field/property in this shape.
  employeeId: string;
  // Field/property in this shape.
  fullName: string;
  // Field/property in this shape.
  panels?: Panel[];
  // Field/property in this shape.
  actions?: Action[];
  // Field/property in this shape.
  landing?: Panel;
  /** Set for supervisors — count of active sectors they primarily supervise. */
  supervisedSectorCount?: number | null;
};
