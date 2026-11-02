/**
 * Authoritative panel/action catalogs and default role→panel / landing tables.
 * Imported by both API (`permissions.ts`) and web (`capabilities.ts`).
 * Do not duplicate these arrays elsewhere — extend this module instead.
 *
 * Role keys are plain strings (not Prisma) so the browser can import safely.
 */

/** UI panels the client may show; keys match RoleGrant panel grants. */
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
  "notifications",
] as const;

export type Panel = (typeof ALL_PANELS)[number];

/** Fine-grained actions checked by requireAction / canPerform. */
export const ALL_ACTIONS = [
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
  "attendance.request_adjustment",
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
] as const;

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
  housekeeper: ["mywork", "home", "rooms", "common", "notifications"],
  technician: ["mywork", "repairs", "home", "rooms", "common", "notifications"],
  reception: ["home", "rooms", "common", "plan", "cards", "notifications"],
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
  housekeeper: "mywork",
  technician: "mywork",
  reception: "rooms",
  supervisor: "rooms",
  manager: "control",
  admin: "team",
  owner: "control",
};
