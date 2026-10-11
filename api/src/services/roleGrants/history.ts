import { GrantKind, Role } from "@prisma/client";
import { MATRIX_ROLES } from "../../permissions";
import { listAuditEvents } from "../audit";

export async function listPermissionHistory(input: {
  role?: Role;
  limit?: number;
}) {
  const rows = await listAuditEvents({
    entityType: "role_grant",
    entityIdStartsWith: input.role ? `${input.role}:` : undefined,
    limit: input.limit,
  });

  return rows.map((r) => {
    const after = (r.after ?? {}) as {
      role?: Role;
      kind?: GrantKind;
      key?: string;
      granted?: boolean;
    };
    const entityParts = r.entityId.split(":");
    const role =
      after.role ??
      (entityParts[0] && (MATRIX_ROLES as string[]).includes(entityParts[0])
        ? (entityParts[0] as Role)
        : ("" as Role));
    const kind =
      after.kind ??
      (entityParts[1] === "panel" || entityParts[1] === "action"
        ? (entityParts[1] as GrantKind)
        : GrantKind.action);
    const key = after.key ?? entityParts.slice(2).join(":") ?? r.entityId;
    const granted =
      typeof after.granted === "boolean"
        ? after.granted
        : r.action === "permission.grant";
    return {
      id: r.id,
      role,
      kind,
      key,
      granted,
      reason: r.reason,
      createdAt: r.occurredAt,
      actor: r.actor ?? {
        id: "",
        fullName: "System",
        employeeNumber: "",
      },
    };
  });
}
