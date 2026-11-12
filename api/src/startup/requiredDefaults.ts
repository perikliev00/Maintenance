/**
 * One-shot DB defaults for settings, role grants, catalog grant seeds, and SLA.
 * No Express, routes, or HTTP readiness flags — safe for bootstrap.ts and index.ts.
 */
import { GrantKind } from "@prisma/client";
// Import module dependency from ../services/settings.
import { ensureDefaultSettings } from "../services/settings";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  applyCatalogGrantSeed,
  // Support the surrounding logic for this step.
  ensureDefaultRoleGrants,
// Support the surrounding logic for this step.
} from "../services/roleGrants";
// Import module dependency from ../services/slaPolicies.
import { ensureDefaultSlaPolicies } from "../services/slaPolicies";

/**
 * Required, idempotent defaults. Callers that expose /health/ready must mark
 * bootstrap complete only after this resolves (see index.ts).
 */
export async function initializeRequiredDefaults() {
  // Wait for an async operation before continuing.
  await ensureDefaultSettings();
  // Wait for an async operation before continuing.
  await ensureDefaultRoleGrants();
  // Wait for an async operation before continuing.
  await applyCatalogGrantSeed("grants.sectors.transfer_cross.v1", [
    // Support the surrounding logic for this step.
    { role: "manager", kind: GrantKind.action, key: "sectors.transfer_cross" },
    // Support the surrounding logic for this step.
    { role: "admin", kind: GrantKind.action, key: "sectors.transfer_cross" },
  ]);
  // FEAT-001: one-shot seed grants.panels.notifications.v1 so existing installs
  // get the Notifications panel via RoleGrant (presence = allow). After AppliedDataSeed
  // records the id, admin revokes stay revoked — this seed does not re-insert.
  await applyCatalogGrantSeed("grants.panels.notifications.v1", [
    // Support the surrounding logic for this step.
    { role: "housekeeper", kind: GrantKind.panel, key: "notifications" },
    // Support the surrounding logic for this step.
    { role: "technician", kind: GrantKind.panel, key: "notifications" },
    // Support the surrounding logic for this step.
    { role: "reception", kind: GrantKind.panel, key: "notifications" },
    // Support the surrounding logic for this step.
    { role: "supervisor", kind: GrantKind.panel, key: "notifications" },
    // Support the surrounding logic for this step.
    { role: "manager", kind: GrantKind.panel, key: "notifications" },
    // Support the surrounding logic for this step.
    { role: "admin", kind: GrantKind.panel, key: "notifications" },
  ]);
  // SEC-002: assignee bypass (canBypassAssignee) is separate from cleaning.start /
  // cleaning.complete grants. Manager/admin may bypass assignment but still need
  // these action keys on the RoleGrant matrix to start or complete cleaning.
  await applyCatalogGrantSeed("grants.actions.cleaning.start_complete.manager_admin.v1", [
    // Support the surrounding logic for this step.
    { role: "manager", kind: GrantKind.action, key: "cleaning.start" },
    // Support the surrounding logic for this step.
    { role: "manager", kind: GrantKind.action, key: "cleaning.complete" },
    // Support the surrounding logic for this step.
    { role: "admin", kind: GrantKind.action, key: "cleaning.start" },
    // Support the surrounding logic for this step.
    { role: "admin", kind: GrantKind.action, key: "cleaning.complete" },
  ]);
  // Wait for an async operation before continuing.
  await applyCatalogGrantSeed("grants.actions.people.manage_access.v1", [
    // Support the surrounding logic for this step.
    { role: "manager", kind: GrantKind.action, key: "people.manage_access" },
    // Support the surrounding logic for this step.
    { role: "admin", kind: GrantKind.action, key: "people.manage_access" },
  ]);
  // NEW-05: jobs.view covers run history (GET); jobs.run covers manual POST /jobs/run.
  await applyCatalogGrantSeed("grants.actions.jobs.run.manager_admin.v1", [
    // Support the surrounding logic for this step.
    { role: "manager", kind: GrantKind.action, key: "jobs.run" },
    // Support the surrounding logic for this step.
    { role: "admin", kind: GrantKind.action, key: "jobs.run" },
  ]);
  // Wait for an async operation before continuing.
  await ensureDefaultSlaPolicies();
}
