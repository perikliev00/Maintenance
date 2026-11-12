/**
 * Authoritative panel/action catalogs and default role→panel / landing tables.
 * Imported by both API (`permissions.ts`) and web (`capabilities.ts`).
 * Do not duplicate these arrays elsewhere — extend this module instead.
 *
 * Role keys are plain strings (not Prisma) so the browser can import safely.
 */

/** UI panels the client may show; keys match RoleGrant panel grants. */
export const ALL_PANELS = [
  // Personal work queue for the signed-in employee.
  "mywork",
  // Technician repair board.
  "repairs",
  // Generic home/dashboard panel.
  "home",
  // Room inventory and status board.
  "rooms",
  // Common-area locations board.
  "common",
  // Team/people directory panel.
  "team",
  // Live operations board.
  "live",
  // Daily plan panel.
  "plan",
  // Attendance records panel.
  "attendance",
  // Access cards panel.
  "cards",
  // Cleaning results/inspection outcomes.
  "results",
  // Analytics dashboards.
  "analytics",
  // Cleaning operations panel.
  "cleaning",
  // Audit log panel.
  "audit",
  // Manager control panel.
  "control",
  // Hotel settings panel.
  "settings",
  // Permissions matrix panel.
  "permissions",
  // In-app notifications panel.
  "notifications",
] as const;

// Union of every panel key in ALL_PANELS.
export type Panel = (typeof ALL_PANELS)[number];

/** Fine-grained actions checked by requireAction / canPerform. */
export const ALL_ACTIONS = [
  // Room visibility and mutations.
  "rooms.view",
  "rooms.mark_dirty",
  "rooms.manage",
  "rooms.set_occupancy",
  "rooms.set_service_status",
  // Cleaning task lifecycle actions.
  "cleaning.create",
  "cleaning.start",
  "cleaning.complete",
  "cleaning.inspect",
  "cleaning.reassign",
  "cleaning.review_overdue",
  "cleaning.results_view",
  // Live operations board access.
  "operations.view_live",
  // Maintenance ticket lifecycle actions.
  "tickets.report",
  "tickets.resolve",
  "tickets.assign",
  "tickets.close",
  // People directory and access administration.
  "people.view",
  "people.change_role",
  "people.invite",
  "people.manage_access",
  // Control panel and settings/permissions management.
  "control.access",
  "settings.manage",
  "permissions.manage",
  // Daily plan view/edit.
  "plan.view",
  "plan.manage",
  // Attendance view/ingest/adjustments.
  "attendance.view",
  "attendance.ingest",
  "attendance.request_adjustment",
  "attendance.approve_adjustment",
  // Access card lifecycle.
  "cards.view",
  "cards.issue",
  "cards.revoke",
  // Analytics visibility.
  "analytics.view",
  // Sector and shift administration.
  "sectors.manage",
  "sectors.transfer_cross",
  "shifts.manage",
  // Ticket issue-option catalog management.
  "issue_options.manage",
  // Audit log visibility.
  "audit.view",
  // Background job visibility and manual run.
  "jobs.view",
  "jobs.run",
] as const;

// Union of every action key in ALL_ACTIONS.
export type Action = (typeof ALL_ACTIONS)[number];

/** Non-owner roles that receive default panel/action seed grants. */
export type GrantRole =
  | "reception"
  | "housekeeper"
  | "supervisor"
  | "technician"
  | "manager"
  | "admin";

/** All roles including owner (string union; API maps to Prisma Role). */
export type CatalogRole = GrantRole | "owner";

/** Seed / offline fallback: default panels per role (owner gets all panels). */
export const DEFAULT_PANEL_BY_ROLE: Record<GrantRole, readonly Panel[]> = {
  // Housekeeper focuses on personal work and nearby locations.
  housekeeper: ["mywork", "home", "rooms", "common", "notifications"],
  // Technician adds the repairs board.
  technician: ["mywork", "repairs", "home", "rooms", "common", "notifications"],
  // Reception covers rooms, plan, and cards.
  reception: ["home", "rooms", "common", "plan", "cards", "notifications"],
  // Supervisor sees ops, attendance, analytics, cleaning, repairs.
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
    "notifications",
  ],
  // Manager gets control/settings/permissions plus full ops panels.
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
    "notifications",
  ],
  // Admin is access-focused; no live/control board by default.
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
    "notifications",
  ],
};

/** Default first panel after login when no override is stored. */
export const LANDING_BY_ROLE: Record<CatalogRole, Panel> = {
  // Floor staff land on personal work.
  housekeeper: "mywork",
  technician: "mywork",
  // Front desk lands on rooms.
  reception: "rooms",
  supervisor: "rooms",
  // Leadership lands on control or team.
  manager: "control",
  admin: "team",
  owner: "control",
};
