import { GrantKind, Role } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { MATRIX_ROLES } from "../../permissions";
import { recordAuditMany } from "../audit";
import {
  getGrantMap,
  invalidateGrantCache,
} from "./cache";
import { normalizePanelsActions } from "./normalize";
import { editableRolesFor, getGrantsForRole } from "./query";

export async function replaceRoleGrants(input: {
  targetRole: Role;
  panels: string[];
  actions: string[];
  actorRole: Role;
  actorEmployeeId: string;
  reason?: string;
}) {
  if (input.targetRole === Role.owner) {
    throw new AppError(400, "validation", "Owner grants cannot be edited");
  }
  if (!MATRIX_ROLES.includes(input.targetRole as Exclude<Role, "owner">)) {
    throw new AppError(400, "validation", `Unknown role: ${input.targetRole}`);
  }

  const editable = editableRolesFor(input.actorRole);
  if (!editable.includes(input.targetRole as Exclude<Role, "owner">)) {
    throw new AppError(
      403,
      "forbidden",
      "You cannot edit grants for this role",
    );
  }

  const next = normalizePanelsActions(input.panels, input.actions);
  const current = await getGrantsForRole(input.targetRole);

  // Guard: at least one non-owner must keep permissions.manage
  if (
    current.actions.includes("permissions.manage") &&
    !next.actions.includes("permissions.manage")
  ) {
    const map = await getGrantMap();
    let othersHave = false;
    for (const role of MATRIX_ROLES) {
      if (role === input.targetRole) continue;
      const g = map.get(role);
      if (g?.actions.includes("permissions.manage")) {
        othersHave = true;
        break;
      }
    }
    if (!othersHave) {
      throw new AppError(
        400,
        "validation",
        "Cannot remove the last permissions.manage grant from non-owner roles",
      );
    }
  }

  const panelSet = new Set(current.panels);
  const actionSet = new Set(current.actions);
  const nextPanelSet = new Set(next.panels);
  const nextActionSet = new Set(next.actions);

  const changes: Array<{
    kind: GrantKind;
    key: string;
    granted: boolean;
  }> = [];

  for (const p of next.panels) {
    if (!panelSet.has(p)) changes.push({ kind: GrantKind.panel, key: p, granted: true });
  }
  for (const p of current.panels) {
    if (!nextPanelSet.has(p)) {
      changes.push({ kind: GrantKind.panel, key: p, granted: false });
    }
  }
  for (const a of next.actions) {
    if (!actionSet.has(a)) changes.push({ kind: GrantKind.action, key: a, granted: true });
  }
  for (const a of current.actions) {
    if (!nextActionSet.has(a)) {
      changes.push({ kind: GrantKind.action, key: a, granted: false });
    }
  }

  await prisma.$transaction(async (tx) => {
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
  });

  invalidateGrantCache();
  return {
    role: input.targetRole,
    panels: next.panels,
    actions: next.actions,
    changes: changes.length,
  };
}
