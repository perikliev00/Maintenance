/**
 * One-shot DB defaults for settings, role grants, catalog grant seeds, and SLA.
 * No Express, routes, or HTTP readiness flags — safe for bootstrap.ts and index.ts.
 */
import { GrantKind } from "@prisma/client";
import { ensureDefaultSettings } from "../services/settings";
import {
  applyCatalogGrantSeed,
  ensureDefaultRoleGrants,
} from "../services/roleGrants";
import { ensureDefaultSlaPolicies } from "../services/slaPolicies";

/**
 * Required, idempotent defaults. Callers that expose /health/ready must mark
 * bootstrap complete only after this resolves (see index.ts).
 */
export async function initializeRequiredDefaults() {
  await ensureDefaultSettings();
  await ensureDefaultRoleGrants();
  await applyCatalogGrantSeed("grants.sectors.transfer_cross.v1", [
    { role: "manager", kind: GrantKind.action, key: "sectors.transfer_cross" },
    { role: "admin", kind: GrantKind.action, key: "sectors.transfer_cross" },
  ]);
  // FEAT-001: one-shot seed grants.panels.notifications.v1 so existing installs
  // get the Notifications panel via RoleGrant (presence = allow). After AppliedDataSeed
  // records the id, admin revokes stay revoked — this seed does not re-insert.
  await applyCatalogGrantSeed("grants.panels.notifications.v1", [
    { role: "housekeeper", kind: GrantKind.panel, key: "notifications" },
    { role: "technician", kind: GrantKind.panel, key: "notifications" },
    { role: "reception", kind: GrantKind.panel, key: "notifications" },
    { role: "supervisor", kind: GrantKind.panel, key: "notifications" },
    { role: "manager", kind: GrantKind.panel, key: "notifications" },
    { role: "admin", kind: GrantKind.panel, key: "notifications" },
  ]);
  // SEC-002: assignee bypass (canBypassAssignee) is separate from cleaning.start /
  // cleaning.complete grants. Manager/admin may bypass assignment but still need
  // these action keys on the RoleGrant matrix to start or complete cleaning.
  await applyCatalogGrantSeed("grants.actions.cleaning.start_complete.manager_admin.v1", [
    { role: "manager", kind: GrantKind.action, key: "cleaning.start" },
    { role: "manager", kind: GrantKind.action, key: "cleaning.complete" },
    { role: "admin", kind: GrantKind.action, key: "cleaning.start" },
    { role: "admin", kind: GrantKind.action, key: "cleaning.complete" },
  ]);
  await applyCatalogGrantSeed("grants.actions.people.manage_access.v1", [
    { role: "manager", kind: GrantKind.action, key: "people.manage_access" },
    { role: "admin", kind: GrantKind.action, key: "people.manage_access" },
  ]);
  // NEW-05: jobs.view covers run history (GET); jobs.run covers manual POST /jobs/run.
  await applyCatalogGrantSeed("grants.actions.jobs.run.manager_admin.v1", [
    { role: "manager", kind: GrantKind.action, key: "jobs.run" },
    { role: "admin", kind: GrantKind.action, key: "jobs.run" },
  ]);
  await ensureDefaultSlaPolicies();
}
