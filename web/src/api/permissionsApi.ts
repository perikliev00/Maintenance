/** Role-grant matrix and history for the Permissions panel. */
import type { Action, Panel, Role } from "./capabilities";
// Import dependency used by this module.
import { API_BASE, apiFetch, apiGet, authHeaders, buildQuery, parseJson } from "./http";

// Export type alias for consumers.
export type PermissionMatrix = {
  // Field/property in this shape.
  panels: Panel[];
  // Field/property in this shape.
  actions: Action[];
  // Field/property in this shape.
  roles: Exclude<Role, "owner">[];
  // Field/property in this shape.
  byRole: Record<string, { panels: Panel[]; actions: Action[] }>;
  /** Optimistic concurrency token per matrix role. */
  versions: Record<string, number>;
  // Field/property in this shape.
  editableRoles: Exclude<Role, "owner">[];
  // Field/property in this shape.
  owner: { panels: Panel[]; actions: Action[] };
};

// Export type alias for consumers.
export type PermissionHistoryRow = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  role: Role;
  // Field/property in this shape.
  kind: "panel" | "action";
  // Field/property in this shape.
  key: string;
  // Field/property in this shape.
  granted: boolean;
  // Field/property in this shape.
  reason: string | null;
  // Field/property in this shape.
  createdAt: string;
  // Field/property in this shape.
  actor: { id: string; fullName: string; employeeNumber: string };
};

// Export type alias for consumers.
export type PutRoleGrantsResult = {
  // Field/property in this shape.
  role: Role;
  // Field/property in this shape.
  panels: string[];
  // Field/property in this shape.
  actions: string[];
  // Field/property in this shape.
  changes: number;
  // Field/property in this shape.
  version: number;
};

/** Full role→panel/action matrix including owner grants (read-only reference). */
export async function fetchPermissionMatrix(): Promise<PermissionMatrix> {
  // Return computed result to caller.
  return apiGet("/permissions/matrix");
}

/**
 * Replace all grants for a role in one PUT (not a patch of individual keys).
 * `expectedVersion` must match the matrix version; stale clients get HTTP 409.
 * Optional `reason` is stored on the permission history row.
 */
export async function putRoleGrants(
  // Field/property in this shape.
  role: Role,
  // Field/property in this shape.
  panels: string[],
  // Field/property in this shape.
  actions: string[],
  // Field/property in this shape.
  expectedVersion: number,
  // Field/property in this shape.
  reason?: string,
// Open multi-line construct.
): Promise<PutRoleGrantsResult> {
  // Local constant binding.
  const res = await apiFetch(`${API_BASE}/permissions/roles/${role}`, {
    // Field/property in this shape.
    method: "PUT",
    // Field/property in this shape.
    headers: authHeaders(),
    // Field/property in this shape.
    body: JSON.stringify({ panels, actions, expectedVersion, reason }),
  });
  // Return computed result to caller.
  return parseJson(res);
}

/** Recent grant changes; optional role filter and row limit. */
export async function fetchPermissionHistory(params?: {
  // Field/property in this shape.
  role?: Role;
  // Field/property in this shape.
  limit?: number;
// Open multi-line construct.
}): Promise<PermissionHistoryRow[]> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/permissions/history${buildQuery({
      // Field/property in this shape.
      role: params?.role,
      // Field/property in this shape.
      limit: params?.limit,
    // Continue multi-line list/arguments.
    })}`,
  );
}
