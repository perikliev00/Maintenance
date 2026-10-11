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

export async function fetchPermissionMatrix(): Promise<PermissionMatrix> {
  const res = await apiFetch(`${API_BASE}/permissions/matrix`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function putRoleGrants(
  role: Role,
  panels: string[],
  actions: string[],
  reason?: string,
) {
  const res = await apiFetch(`${API_BASE}/permissions/roles/${role}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ panels, actions, reason }),
  });
  return parseJson(res);
}

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
