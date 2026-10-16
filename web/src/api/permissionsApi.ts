/** Role-grant matrix and history for the Permissions panel. */
import type { Action, Panel, Role } from "./capabilities";
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

export type PermissionMatrix = {
  panels: Panel[];
  actions: Action[];
  roles: Exclude<Role, "owner">[];
  byRole: Record<string, { panels: Panel[]; actions: Action[] }>;
  editableRoles: Exclude<Role, "owner">[];
  owner: { panels: Panel[]; actions: Action[] };
};

export type PermissionHistoryRow = {
  id: string;
  role: Role;
  kind: "panel" | "action";
  key: string;
  granted: boolean;
  reason: string | null;
  createdAt: string;
  actor: { id: string; fullName: string; employeeNumber: string };
};

/** Full role→panel/action matrix including owner grants (read-only reference). */
export async function fetchPermissionMatrix(): Promise<PermissionMatrix> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/permissions/matrix`, {
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/**
 * Replace all grants for a role in one PUT (not a patch of individual keys).
 * Optional `reason` is stored on the permission history row.
 */
export async function putRoleGrants(
  role: Role,
  panels: string[],
  actions: string[],
  reason?: string,
) {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/permissions/roles/${role}`, {
    method: "PUT",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify({ panels, actions, reason }),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Recent grant changes; optional role filter and row limit. */
export async function fetchPermissionHistory(params?: {
  role?: Role;
  limit?: number;
}): Promise<PermissionHistoryRow[]> {
  const search = new URLSearchParams();
  // Branch: conditional gate.
  if (params?.role) search.set("role", params.role);
  // Branch: conditional gate.
  if (params?.limit) search.set("limit", String(params.limit));
  // Optional query suffix.
  const qs = search.toString();
  // Authenticated HTTP request.
  const res = await apiFetch(
    `${API_BASE}/permissions/history${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  // Return value / early exit.
  return parseJson(res);
}
