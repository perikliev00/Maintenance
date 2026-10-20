/**
 * Full replace of a role's grants (deleteMany + createMany) with audit diffs.
 * Refuses to leave zero non-owner roles with permissions.manage.
 */
import { GrantKind, Role } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { MATRIX_ROLES } from "../../permissions";
import { recordAuditMany } from "../audit";
import {
  invalidateGrantCache,
} from "./cache";
import { normalizePanelsActions } from "./normalize";
import { editableRolesFor, getGrantsForRole } from "./query";

/**
 * Replace target role grants. Owner is immutable; actor must be allowed to edit
 * the target via editableRolesFor. Invalidates grant cache on success.
 */
export async function replaceRoleGrants(input: {
  targetRole: Role;
  panels: string[];
  actions: string[];
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

  // Sanitize unknown keys and keep permissions panel ↔ manage in lockstep.
  const next = normalizePanelsActions(input.panels, input.actions);
  const current = await getGrantsForRole(input.targetRole);

  // Diff current vs next for audit rows (grant / revoke per key).
  const panelSet = new Set(current.panels);
  const actionSet = new Set(current.actions);
  const nextPanelSet = new Set(next.panels);
  const nextActionSet = new Set(next.actions);

  const changes: Array<{
    kind: GrantKind;
    key: string;
    granted: boolean;
  }> = [];

  // Panels newly present → grant audit rows.
  for (const p of next.panels) {
    if (!panelSet.has(p)) changes.push({ kind: GrantKind.panel, key: p, granted: true });
  }
  // Panels removed → revoke audit rows.
  for (const p of current.panels) {
    if (!nextPanelSet.has(p)) {
      changes.push({ kind: GrantKind.panel, key: p, granted: false });
    }
  }
  // Actions newly present → grant audit rows.
  for (const a of next.actions) {
    if (!actionSet.has(a)) changes.push({ kind: GrantKind.action, key: a, granted: true });
  }
  // Actions removed → revoke audit rows.
  for (const a of current.actions) {
    if (!nextActionSet.has(a)) {
      changes.push({ kind: GrantKind.action, key: a, granted: false });
    }
  }

  const removingManage =
    current.actions.includes("permissions.manage") &&
    !next.actions.includes("permissions.manage");

  // Full replace under lock so concurrent last-manage removals cannot race.
  await prisma.$transaction(async (tx) => {
    if (removingManage) {
      // Serialize all permissions.manage grant mutations (composite PK, no id).
      await tx.$queryRaw<{ role: string }[]>`
        SELECT role FROM "RoleGrant"
        WHERE kind = CAST('action' AS "GrantKind")
          AND key = 'permissions.manage'
        ORDER BY role
        FOR UPDATE
      `;
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
    // Build createMany payload from the normalized next set.
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
    // Empty grant set is allowed (except permissions.manage guard above).
    if (data.length) {
      await tx.roleGrant.createMany({ data });
    }
    // One audit event per added/removed key.
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
  });

  // Drop TTL cache so subsequent canPerform sees the new grants.
  invalidateGrantCache();
  return {
    role: input.targetRole,
    panels: next.panels,
    actions: next.actions,
    changes: changes.length,
  };
}
