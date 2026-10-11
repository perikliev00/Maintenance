import type { AuthUser, Role } from "./capabilities";
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

export type Person = {
  id: string;
  employeeId: string;
  userId: string | null;
  fullName: string;
  employeeNumber: string;
  email: string | null;
  role: Role | null;
  department: string | null;
  isActive: boolean;
  onboarded: boolean;
  deviceCount: number;
  createdAt: string;
};

export type Invitation = {
  id: string;
  codeHint: string;
  employeeId: string;
  fullName: string;
  employeeNumber: string;
  role: Role;
  email: string;
  status: "issued" | "consumed" | "expired" | "revoked";
  expiresAt: string;
  createdAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  createdBy: { id: string; email: string; fullName: string };
};

export type IssuedInvitation = {
  invitation: Invitation;
  code: string;
  qrPayload: string;
  expiresAt: string;
};

export type DeviceRow = {
  id: string;
  label: string;
  fingerprint: string;
  employeeId: string;
  userId: string;
  fullName: string;
  employeeNumber: string;
  email: string;
  role: Role;
  activatedAt: string;
  lastSeenAt: string;
};

export async function fetchHousekeepers(init?: { signal?: AbortSignal }) {
  const res = await apiFetch(`${API_BASE}/cleaning/employees/housekeepers`, {
    headers: authHeaders(),
    signal: init?.signal,
  });
  return parseJson<Array<{ id: string; fullName: string; employeeNumber: string }>>(res);
}

export async function fetchPeople(params?: {
  q?: string;
  role?: string;
  includeInactive?: boolean;
  notOnboarded?: boolean;
}): Promise<Person[]> {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.role) search.set("role", params.role);
  if (params?.includeInactive) search.set("includeInactive", "true");
  if (params?.notOnboarded) search.set("notOnboarded", "true");
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/people${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function updatePersonRole(userId: string, role: Role): Promise<Person> {
  const res = await apiFetch(`${API_BASE}/people/${userId}/role`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ role }),
  });
  return parseJson(res);
}

export async function issueInvitation(
  body:
    | {
        kind: "new";
        fullName: string;
        employeeNumber: string;
        email: string;
        role: Role;
        department?: string | null;
      }
    | {
        kind: "existing";
        employeeId: string;
        email?: string;
        role?: Role;
      },
): Promise<IssuedInvitation> {
  const res = await apiFetch(`${API_BASE}/invitations`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function fetchInvitations(): Promise<Invitation[]> {
  const res = await apiFetch(`${API_BASE}/invitations`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function revokeInvitation(id: string): Promise<Invitation> {
  const res = await apiFetch(`${API_BASE}/invitations/${id}/revoke`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function redeemInvitation(body: {
  code: string;
  password?: string;
  deviceLabel: string;
  fingerprint: string;
}): Promise<{ user: AuthUser }> {
  const res = await fetch(`${API_BASE}/invitations/redeem`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJson<{ user: AuthUser }>(res);
  localStorage.setItem("user", JSON.stringify(data.user));
  return data;
}

export async function fetchDevices(employeeId?: string): Promise<DeviceRow[]> {
  const search = new URLSearchParams();
  if (employeeId) search.set("employeeId", employeeId);
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/devices${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function revokeDevice(id: string): Promise<{ id: string; revokedAt: string }> {
  const res = await apiFetch(`${API_BASE}/devices/${id}/revoke`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export function deviceFingerprint(): string {
  const key = "device_fingerprint";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const next = `web-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  localStorage.setItem(key, next);
  return next;
}
