/**
 * Full replace of a role's grants (deleteMany + createMany) with audit diffs.
 * Optimistic concurrency via RoleGrantRevision; audit before-state is read
 * under the same transaction lock (never from the TTL grant cache).
 * Refuses to leave zero non-owner roles with permissions.manage.
 */
import { GrantKind, Prisma, Role } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../../events/bus for this service.
import { publish } from "../../events/bus";
// Import module dependency for this service.
import {
  // Run next step: MATRIX_ROLES,
  MATRIX_ROLES,
  // Run next step: isAction,
  isAction,
  // Run next step: isPanel,
  isPanel,
// Run next step: } from "../../permissions";
} from "../../permissions";
// Import module ../audit for this service.
import { recordAuditMany } from "../audit";
// Import module ./cache for this service.
import { invalidateGrantCache } from "./cache";
// Import module ./diff for this service.
import { diffGrantSets } from "./diff";
// Import module ./normalize for this service.
import { normalizePanelsActions } from "./normalize";
// Import type(s) Tx for typing without runtime cost.
import type { Tx } from "../db/types";
// Import module ./query for this service.
import { editableRolesFor } from "./query";

/** Load grants for a role from rows already locked in the transaction. */
async function loadGrantsInTx(tx: Tx, role: Role) {
  // Load rows asynchronously for the next steps.
  const rows = await tx.roleGrant.findMany({ where: { role } });
  // Capture panels for use in this scope.
  const panels: string[] = [];
  // Capture actions for use in this scope.
  const actions: string[] = [];
  // Iterate items to apply the same logic to each entry.
  for (const row of rows) {
    // Branch when this condition holds so the right path runs.
    if (row.kind === GrantKind.panel && isPanel(row.key)) {
      // Branch when this condition holds so the right path runs.
      if (!panels.includes(row.key)) panels.push(row.key);
    }
    // Branch when this condition holds so the right path runs.
    if (row.kind === GrantKind.action && isAction(row.key)) {
      // Branch when this condition holds so the right path runs.
      if (!actions.includes(row.key)) actions.push(row.key);
    }
  }
  // Return the computed result to the caller.
  return { panels, actions };
}

/** Ensure a revision row exists, then lock it FOR UPDATE and return version. */
async function lockRevision(tx: Tx, role: Role): Promise<number> {
  // Wait for the async step before continuing.
  await tx.$executeRaw`
    INSERT INTO "RoleGrantRevision" (role, version, "updatedAt")
    VALUES (CAST(${role} AS "Role"), 1, CURRENT_TIMESTAMP)
    ON CONFLICT (role) DO NOTHING
  `;
  // Load rows asynchronously for the next steps.
  const rows = await tx.$queryRaw<{ version: number }[]>`
    SELECT version FROM "RoleGrantRevision"
    WHERE role = CAST(${role} AS "Role")
    FOR UPDATE
  `;
  // Capture version for use in this scope.
  const version = rows[0]?.version;
  // Branch when this condition holds so the right path runs.
  if (typeof version !== "number") {
    // Abort with an error so callers can react.
    throw new AppError(500, "internal", "Missing role grant revision");
  }
  // Return the computed result to the caller.
  return version;
}

/**
 * Replace target role grants. Owner is immutable; actor must be allowed to edit
 * the target via editableRolesFor. Invalidates grant cache on success.
 */
export async function replaceRoleGrants(input: {
  // Set targetRole on the structure being built.
  targetRole: Role;
  // Set panels on the structure being built.
  panels: string[];
  // Set actions on the structure being built.
  actions: string[];
  // Set expectedVersion on the structure being built.
  expectedVersion: number;
  // Set actorRole on the structure being built.
  actorRole: Role;
  // Set actorEmployeeId on the structure being built.
  actorEmployeeId: string;
  // Run next step: reason?: string;
  reason?: string;
// Run next step: }) {
}) {
  // Owner grants are synthetic/full — never stored or edited via this path.
  if (input.targetRole === Role.owner) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "Owner grants cannot be edited");
  }
  // Branch when this condition holds so the right path runs.
  if (!MATRIX_ROLES.includes(input.targetRole as Exclude<Role, "owner">)) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", `Unknown role: ${input.targetRole}`);
  }

  // Actor role must be allowed to edit this target (owner > manager/admin subset).
  const editable = editableRolesFor(input.actorRole);
  // Branch when this condition holds so the right path runs.
  if (!editable.includes(input.targetRole as Exclude<Role, "owner">)) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 403,
      403,
      // Run next step: "forbidden",
      "forbidden",
      // Run next step: "You cannot edit grants for this role",
      "You cannot edit grants for this role",
    );
  }

  // Branch when this condition holds so the right path runs.
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 400,
      400,
      // Run next step: "validation",
      "validation",
      // Run next step: "expectedVersion must be a positive integer",
      "expectedVersion must be a positive integer",
    );
  }

  // Sanitize unknown keys and keep permissions panel ↔ manage in lockstep.
  const next = normalizePanelsActions(input.panels, input.actions);

  // Stable advisory key so concurrent last-manage removals serialize without
  // deadlocking on RoleGrantRevision(role A) × manage-row(role B) lock order.
  const PERMISSIONS_MANAGE_ADVISORY = 872_014_01;

  // Load result asynchronously for the next steps.
  const result = await prisma.$transaction(async (tx) => {
    // Capture next removes manage for use in this scope.
    const nextRemovesManage = !next.actions.includes("permissions.manage");
    // Branch when this condition holds so the right path runs.
    if (nextRemovesManage) {
      // Load had manage asynchronously for the next steps.
      const hadManage = await tx.roleGrant.findFirst({
        // Set where on the structure being built.
        where: {
          // Set role on the structure being built.
          role: input.targetRole,
          // Set kind on the structure being built.
          kind: GrantKind.action,
          // Set key on the structure being built.
          key: "permissions.manage",
        },
        // Set select on the structure being built.
        select: { role: true },
      });
      // Branch when this condition holds so the right path runs.
      if (hadManage) {
        // Wait for the async step before continuing.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PERMISSIONS_MANAGE_ADVISORY})`;
      }
    }

    // Load current version asynchronously for the next steps.
    const currentVersion = await lockRevision(tx, input.targetRole);
    // Branch when this condition holds so the right path runs.
    if (currentVersion !== input.expectedVersion) {
      // Abort with an error so callers can react.
      throw new AppError(
        // Run next step: 409,
        409,
        // Run next step: "stale_state",
        "stale_state",
        // Run next step: "Permission matrix changed; refresh and try again",
        "Permission matrix changed; refresh and try again",
        // Run next step: {
        {
          // Set role on the structure being built.
          role: input.targetRole,
          // Run next step: currentVersion,
          currentVersion,
          // Set expectedVersion on the structure being built.
          expectedVersion: input.expectedVersion,
        },
      );
    }

    // Serialize writers for this role even when the grant set is empty.
    await tx.$queryRaw`
      SELECT role FROM "RoleGrant"
      WHERE role = CAST(${input.targetRole} AS "Role")
      ORDER BY kind, key
      FOR UPDATE
    `;

    // Authoritative before-state for audit — never the in-process TTL cache.
    const current = await loadGrantsInTx(tx, input.targetRole);
    // Capture changes for use in this scope.
    const changes = diffGrantSets(current, next);

    // Capture removing manage for use in this scope.
    const removingManage =
      // Run next step: current.actions.includes("permissions.manage") &&
      current.actions.includes("permissions.manage") &&
      // Run next step: !next.actions.includes("permissions.manage");
      !next.actions.includes("permissions.manage");

    // Branch when this condition holds so the right path runs.
    if (removingManage) {
      // Under the advisory lock, re-check that another non-owner still has manage.
      const otherRoles = MATRIX_ROLES.filter((r) => r !== input.targetRole);
      // Load others asynchronously for the next steps.
      const others = await tx.roleGrant.findFirst({
        // Set where on the structure being built.
        where: {
          // Set kind on the structure being built.
          kind: GrantKind.action,
          // Set key on the structure being built.
          key: "permissions.manage",
          // Set role on the structure being built.
          role: { in: otherRoles },
        },
        // Set select on the structure being built.
        select: { role: true },
      });
      // Branch when this condition holds so the right path runs.
      if (!others) {
        // Abort with an error so callers can react.
        throw new AppError(
          // Run next step: 400,
          400,
          // Run next step: "validation",
          "validation",
          // Run next step: "Cannot remove the last permissions.manage grant from non-ow…
          "Cannot remove the last permissions.manage grant from non-owner roles",
        );
      }
    }

    // Wait for the async step before continuing.
    await tx.roleGrant.deleteMany({ where: { role: input.targetRole } });
    // Collect data list for later processing.
    const data = [
      // Run next step: ...next.panels.map((key) => ({
      ...next.panels.map((key) => ({
        // Set role on the structure being built.
        role: input.targetRole,
        // Set kind on the structure being built.
        kind: GrantKind.panel,
        // Run next step: key,
        key,
      })),
      // Run next step: ...next.actions.map((key) => ({
      ...next.actions.map((key) => ({
        // Set role on the structure being built.
        role: input.targetRole,
        // Set kind on the structure being built.
        kind: GrantKind.action,
        // Run next step: key,
        key,
      })),
    ];
    // Branch when this condition holds so the right path runs.
    if (data.length) {
      // Wait for the async step before continuing.
      await tx.roleGrant.createMany({ data });
    }

    // Branch when this condition holds so the right path runs.
    if (changes.length) {
      // Wait for the async step before continuing.
      await recordAuditMany(
        // Run next step: changes.map((c) => ({
        changes.map((c) => ({
          // Set actorEmployeeId on the structure being built.
          actorEmployeeId: input.actorEmployeeId,
          // Set action on the structure being built.
          action: c.granted ? "permission.grant" : "permission.revoke",
          // Set entityType on the structure being built.
          entityType: "role_grant",
          // Set entityId on the structure being built.
          entityId: `${input.targetRole}:${c.kind}:${c.key}`,
          // Set reason on the structure being built.
          reason: input.reason,
          // Set before on the structure being built.
          before: { granted: !c.granted },
          // Set after on the structure being built.
          after: {
            // Set role on the structure being built.
            role: input.targetRole,
            // Set kind on the structure being built.
            kind: c.kind,
            // Set key on the structure being built.
            key: c.key,
            // Set granted on the structure being built.
            granted: c.granted,
          },
          // Set summary on the structure being built.
          summary: `${c.granted ? "Granted" : "Revoked"} ${c.kind} ${c.key} for ${input.targetRole}`,
        })),
        // Run next step: tx,
        tx,
      );
    }

    // Load bumped asynchronously for the next steps.
    const bumped = await tx.roleGrantRevision.update({
      // Set where on the structure being built.
      where: { role: input.targetRole },
      // Set data on the structure being built.
      data: { version: { increment: 1 } },
      // Set select on the structure being built.
      select: { version: true },
    });

    // Return the computed result to the caller.
    return {
      // Set role on the structure being built.
      role: input.targetRole,
      // Set panels on the structure being built.
      panels: next.panels,
      // Set actions on the structure being built.
      actions: next.actions,
      // Set changes on the structure being built.
      changes: changes.length,
      // Set version on the structure being built.
      version: bumped.version,
    };
  });

  // Drop TTL cache so subsequent canPerform sees the new grants.
  invalidateGrantCache();
  // Notify open sessions to refresh /auth/me capabilities.
  publish("permissions.changed");
  // Return the computed result to the caller.
  return result;
}
