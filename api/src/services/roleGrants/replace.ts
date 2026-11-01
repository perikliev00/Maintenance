/**
 * Full replace of a role's grants (deleteMany + createMany) with audit diffs.
 * Optimistic concurrency via RoleGrantRevision; audit before-state is read
 * under the same transaction lock (never from the TTL grant cache).
 * Refuses to leave zero non-owner roles with permissions.manage.
 */
import { GrantKind, Prisma, Role } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import {
  MATRIX_ROLES,
  isAction,
  isPanel,
} from "../../permissions";
import { recordAuditMany } from "../audit";
import { invalidateGrantCache } from "./cache";
import { diffGrantSets } from "./diff";
import { normalizePanelsActions } from "./normalize";
import { editableRolesFor } from "./query";

type Tx = Prisma.TransactionClient;

/** Load grants for a role from rows already locked in the transaction. */
async function loadGrantsInTx(tx: Tx, role: Role) {
  const rows = await tx.roleGrant.findMany({ where: { role } });
  const panels: string[] = [];
  const actions: string[] = [];
  for (const row of rows) {
    if (row.kind === GrantKind.panel && isPanel(row.key)) {
      if (!panels.includes(row.key)) panels.push(row.key);
    }
    if (row.kind === GrantKind.action && isAction(row.key)) {
      if (!actions.includes(row.key)) actions.push(row.key);
    }
  }
  return { panels, actions };
}

/** Ensure a revision row exists, then lock it FOR UPDATE and return version. */
async function lockRevision(tx: Tx, role: Role): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO "RoleGrantRevision" (role, version, "updatedAt")
    VALUES (CAST(${role} AS "Role"), 1, CURRENT_TIMESTAMP)
    ON CONFLICT (role) DO NOTHING
  `;
  const rows = await tx.$queryRaw<{ version: number }[]>`
    SELECT version FROM "RoleGrantRevision"
    WHERE role = CAST(${role} AS "Role")
    FOR UPDATE
  `;
  const version = rows[0]?.version;
  if (typeof version !== "number") {
    throw new AppError(500, "internal", "Missing role grant revision");
  }
  return version;
}

/**
 * Replace target role grants. Owner is immutable; actor must be allowed to edit
 * the target via editableRolesFor. Invalidates grant cache on success.
 */
export async function replaceRoleGrants(input: {
  targetRole: Role;
  panels: string[];
  actions: string[];
  expectedVersion: number;
  actorRole: Role;
  actorEmployeeId: string;
  reason?: string;
}) {
  // Owner grants are synthetic/full — never stored or edited via this path.
  if (input.targetRole === Role.owner) {
    throw new AppError(400, "validation", "Owner grants cannot be edited");
  }
  if (!MATRIX_ROLES.includes(input.targetRole as Exclude<Role, "owner">)) {
    throw new AppError(400, "validation", `Unknown role: ${input.targetRole}`);
  }

  // Actor role must be allowed to edit this target (owner > manager/admin subset).
  const editable = editableRolesFor(input.actorRole);
  if (!editable.includes(input.targetRole as Exclude<Role, "owner">)) {
    throw new AppError(
      403,
      "forbidden",
      "You cannot edit grants for this role",
    );
  }

  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new AppError(
      400,
      "validation",
      "expectedVersion must be a positive integer",
    );
  }

  // Sanitize unknown keys and keep permissions panel ↔ manage in lockstep.
  const next = normalizePanelsActions(input.panels, input.actions);

  // Stable advisory key so concurrent last-manage removals serialize without
  // deadlocking on RoleGrantRevision(role A) × manage-row(role B) lock order.
  const PERMISSIONS_MANAGE_ADVISORY = 872_014_01;

  const result = await prisma.$transaction(async (tx) => {
    const nextRemovesManage = !next.actions.includes("permissions.manage");
    if (nextRemovesManage) {
      const hadManage = await tx.roleGrant.findFirst({
        where: {
          role: input.targetRole,
          kind: GrantKind.action,
          key: "permissions.manage",
        },
        select: { role: true },
      });
      if (hadManage) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PERMISSIONS_MANAGE_ADVISORY})`;
      }
    }

    const currentVersion = await lockRevision(tx, input.targetRole);
    if (currentVersion !== input.expectedVersion) {
      throw new AppError(
        409,
        "stale_state",
        "Permission matrix changed; refresh and try again",
        {
          role: input.targetRole,
          currentVersion,
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
    const changes = diffGrantSets(current, next);

    const removingManage =
      current.actions.includes("permissions.manage") &&
      !next.actions.includes("permissions.manage");

    if (removingManage) {
      // Under the advisory lock, re-check that another non-owner still has manage.
      const otherRoles = MATRIX_ROLES.filter((r) => r !== input.targetRole);
      const others = await tx.roleGrant.findFirst({
        where: {
          kind: GrantKind.action,
          key: "permissions.manage",
          role: { in: otherRoles },
        },
        select: { role: true },
      });
      if (!others) {
        throw new AppError(
          400,
          "validation",
          "Cannot remove the last permissions.manage grant from non-owner roles",
        );
      }
    }

    await tx.roleGrant.deleteMany({ where: { role: input.targetRole } });
    const data = [
      ...next.panels.map((key) => ({
        role: input.targetRole,
        kind: GrantKind.panel,
        key,
      })),
      ...next.actions.map((key) => ({
        role: input.targetRole,
        kind: GrantKind.action,
        key,
      })),
    ];
    if (data.length) {
      await tx.roleGrant.createMany({ data });
    }

    if (changes.length) {
      await recordAuditMany(
        changes.map((c) => ({
          actorEmployeeId: input.actorEmployeeId,
          action: c.granted ? "permission.grant" : "permission.revoke",
          entityType: "role_grant",
          entityId: `${input.targetRole}:${c.kind}:${c.key}`,
          reason: input.reason,
          before: { granted: !c.granted },
          after: {
            role: input.targetRole,
            kind: c.kind,
            key: c.key,
            granted: c.granted,
          },
          summary: `${c.granted ? "Granted" : "Revoked"} ${c.kind} ${c.key} for ${input.targetRole}`,
        })),
        tx,
      );
    }

    const bumped = await tx.roleGrantRevision.update({
      where: { role: input.targetRole },
      data: { version: { increment: 1 } },
      select: { version: true },
    });

    return {
      role: input.targetRole,
      panels: next.panels,
      actions: next.actions,
      changes: changes.length,
      version: bumped.version,
    };
  });

  // Drop TTL cache so subsequent canPerform sees the new grants.
  invalidateGrantCache();
  // Notify open sessions to refresh /auth/me capabilities.
  publish("permissions.changed");
  return result;
}
