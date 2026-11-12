/**
 * Permission change history from audit events (entityType role_grant).
 */
import { GrantKind, Role } from "@prisma/client";
// Import module ../../permissions for this service.
import { MATRIX_ROLES } from "../../permissions";
// Import module ../audit for this service.
import { listAuditEvents } from "../audit";

/**
 * Map audit rows back to role/kind/key/granted for the permissions history UI.
 * Prefers `after` payload; falls back to entityId `role:kind:key` parsing.
 */
export async function listPermissionHistory(input: {
  // Run next step: role?: Role;
  role?: Role;
  // Run next step: limit?: number;
  limit?: number;
// Run next step: }) {
}) {
  // Filter audit stream to role_grant; optional role prefix on entityId.
  const rows = await listAuditEvents({
    // Set entityType on the structure being built.
    entityType: "role_grant",
    // Narrow to one role when the UI filters the history panel.
    entityIdStartsWith: input.role ? `${input.role}:` : undefined,
    // Set limit on the structure being built.
    limit: input.limit,
  });

  // Shape each audit row into the permissions-history DTO.
  return rows.map((r) => {
    // Prefer structured `after` payload when present.
    const after = (r.after ?? {}) as {
      // Run next step: role?: Role;
      role?: Role;
      // Run next step: kind?: GrantKind;
      kind?: GrantKind;
      // Run next step: key?: string;
      key?: string;
      // Run next step: granted?: boolean;
      granted?: boolean;
    };
    // Fallback parse entityId `role:kind:key` for older audit rows.
    const entityParts = r.entityId.split(":");
    // Role: after.role, else first entityId segment if it is a matrix role.
    const role =
      // Run next step: after.role ??
      after.role ??
      // Run next step: (entityParts[0] && (MATRIX_ROLES as string[]).includes(entit…
      (entityParts[0] && (MATRIX_ROLES as string[]).includes(entityParts[0])
        // Complete the ternary or optional chain started above.
        ? (entityParts[0] as Role)
        // Complete the ternary or optional chain started above.
        : ("" as Role));
    // Kind: after.kind, else panel/action segment, else default to action.
    const kind =
      // Run next step: after.kind ??
      after.kind ??
      // Run next step: (entityParts[1] === "panel" || entityParts[1] === "action"
      (entityParts[1] === "panel" || entityParts[1] === "action"
        // Complete the ternary or optional chain started above.
        ? (entityParts[1] as GrantKind)
        // Complete the ternary or optional chain started above.
        : GrantKind.action);
    // Key may itself contain colons — rejoin remaining segments.
    const key = after.key ?? entityParts.slice(2).join(":") ?? r.entityId;
    // Infer grant vs revoke from action when `after.granted` is absent.
    const granted =
      // Run next step: typeof after.granted === "boolean"
      typeof after.granted === "boolean"
        // Complete the ternary or optional chain started above.
        ? after.granted
        // Complete the ternary or optional chain started above.
        : r.action === "permission.grant";
    // Return the computed result to the caller.
    return {
      // Set id on the structure being built.
      id: r.id,
      // Run next step: role,
      role,
      // Run next step: kind,
      kind,
      // Run next step: key,
      key,
      // Run next step: granted,
      granted,
      // Set reason on the structure being built.
      reason: r.reason,
      // Set createdAt on the structure being built.
      createdAt: r.occurredAt,
      // System actor placeholder when the audit row has no employee actor.
      actor: r.actor ?? {
        // Set id on the structure being built.
        id: "",
        // Set fullName on the structure being built.
        fullName: "System",
        // Set employeeNumber on the structure being built.
        employeeNumber: "",
      },
    };
  });
}
