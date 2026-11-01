/** Role-grant matrix and history for the Permissions panel. */
import type { Action, Panel, Role } from "./capabilities";
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

export type PermissionMatrix = {
  panels: Panel[];
  actions: Action[];
  roles: Exclude<Role, "owner">[];
  byRole: Record<string, { panels: Panel[]; actions: Action[] }>;
  /** Optimistic concurrency token per matrix role. */
  versions: Record<string, number>;
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

export type PutRoleGrantsResult = {
  role: Role;
  panels: string[];
  actions: string[];
  changes: number;
  version: number;
};

/** Full role→panel/action matrix including owner grants (read-only reference). */
export async function fetchPermissionMatrix(): Promise<PermissionMatrix> {
  const res = await apiFetch(`${API_BASE}/permissions/matrix`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

/**
 * Replace all grants for a role in one PUT (not a patch of individual keys).
 * `expectedVersion` must match the matrix version; stale clients get HTTP 409.
 * Optional `reason` is stored on the permission history row.
 */
export async function putRoleGrants(
  role: Role,
  panels: string[],
  actions: string[],
  expectedVersion: number,
  reason?: string,
): Promise<PutRoleGrantsResult> {
  const res = await apiFetch(`${API_BASE}/permissions/roles/${role}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ panels, actions, expectedVersion, reason }),
  });
  return parseJson(res);
}

/** Recent grant changes; optional role filter and row limit. */
export async function fetchPermissionHistory(params?: {
  role?: Role;
  limit?: number;
}): Promise<PermissionHistoryRow[]> {
  const search = new URLSearchParams();
  if (params?.role) search.set("role", params.role);
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  const res = await apiFetch(
    `${API_BASE}/permissions/history${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}
