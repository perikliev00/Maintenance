/**
 * Permission change history from audit events (entityType role_grant).
 */
import { GrantKind, Role } from "@prisma/client";
import { MATRIX_ROLES } from "../../permissions";
import { listAuditEvents } from "../audit";

/**
 * Map audit rows back to role/kind/key/granted for the permissions history UI.
 * Prefers `after` payload; falls back to entityId `role:kind:key` parsing.
 */
export async function listPermissionHistory(input: {
  role?: Role;
  limit?: number;
}) {
  // Filter audit stream to role_grant; optional role prefix on entityId.
  const rows = await listAuditEvents({
    entityType: "role_grant",
    // Narrow to one role when the UI filters the history panel.
    entityIdStartsWith: input.role ? `${input.role}:` : undefined,
    limit: input.limit,
  });

  // Shape each audit row into the permissions-history DTO.
  return rows.map((r) => {
    // Prefer structured `after` payload when present.
    const after = (r.after ?? {}) as {
      role?: Role;
      kind?: GrantKind;
      key?: string;
      granted?: boolean;
    };
    // Fallback parse entityId `role:kind:key` for older audit rows.
    const entityParts = r.entityId.split(":");
    // Role: after.role, else first entityId segment if it is a matrix role.
    const role =
      after.role ??
      (entityParts[0] && (MATRIX_ROLES as string[]).includes(entityParts[0])
        ? (entityParts[0] as Role)
        : ("" as Role));
    // Kind: after.kind, else panel/action segment, else default to action.
    const kind =
      after.kind ??
      (entityParts[1] === "panel" || entityParts[1] === "action"
        ? (entityParts[1] as GrantKind)
        : GrantKind.action);
    // Key may itself contain colons — rejoin remaining segments.
    const key = after.key ?? entityParts.slice(2).join(":") ?? r.entityId;
    // Infer grant vs revoke from action when `after.granted` is absent.
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
      // System actor placeholder when the audit row has no employee actor.
      actor: r.actor ?? {
        id: "",
        fullName: "System",
        employeeNumber: "",
      },
    };
  });
}
