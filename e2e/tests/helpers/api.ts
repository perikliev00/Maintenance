import { expect } from "@playwright/test";
import { DEMO_PASSWORD } from "./auth";

/** Direct API origin (Vite proxies /api → this in the browser). */
export const API_ORIGIN =
  process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:4000";

type Json = Record<string, unknown>;

function sessionFromSetCookie(res: Response): string | null {
  const getSetCookie = (
    res.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const lines =
    typeof getSetCookie === "function"
      ? getSetCookie.call(res.headers)
      : ([res.headers.get("set-cookie")].filter(Boolean) as string[]);
  for (const line of lines) {
    const m = /^session=([^;]+)/.exec(line);
    if (m) return decodeURIComponent(m[1]!);
  }
  return null;
}

/** Password login against the API; returns Bearer access token from session cookie. */
export async function apiLogin(
  email: string,
  password = DEMO_PASSWORD,
): Promise<{ token: string; user: Json }> {
  const res = await fetch(`${API_ORIGIN}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.ok, `api login ${email} → ${res.status}`).toBeTruthy();
  const body = (await res.json()) as { user: Json };
  const token = sessionFromSetCookie(res);
  expect(token, `api login ${email}: missing session cookie`).toBeTruthy();
  return { token: token!, user: body.user };
}

async function apiJson(
  token: string,
  method: string,
  pathName: string,
  payload?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_ORIGIN}${pathName}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function apiGet(token: string, pathName: string) {
  return apiJson(token, "GET", pathName);
}

export async function apiPut(
  token: string,
  pathName: string,
  payload: unknown,
) {
  return apiJson(token, "PUT", pathName, payload);
}

export async function apiPatch(
  token: string,
  pathName: string,
  payload: unknown,
) {
  return apiJson(token, "PATCH", pathName, payload);
}

export type RoleGrants = { panels: string[]; actions: string[] };

/** Read one role's grants from the permissions matrix. */
export async function getRoleGrants(
  ownerToken: string,
  role: string,
): Promise<RoleGrants> {
  const res = await apiGet(ownerToken, "/permissions/matrix");
  expect(res.status).toBe(200);
  const byRole = (res.body as { byRole?: Record<string, RoleGrants> }).byRole;
  expect(byRole?.[role], `matrix missing role ${role}`).toBeTruthy();
  return {
    panels: [...(byRole![role].panels ?? [])],
    actions: [...(byRole![role].actions ?? [])],
  };
}

export async function putRoleGrants(
  ownerToken: string,
  role: string,
  grants: RoleGrants,
  reason = "e2e restore",
): Promise<void> {
  const res = await apiPut(ownerToken, `/permissions/roles/${role}`, {
    panels: grants.panels,
    actions: grants.actions,
    reason,
  });
  expect(res.status, `put grants ${role} → ${res.status}`).toBe(200);
}

/** Find a seeded user id by email via /people. */
export async function findUserIdByEmail(
  token: string,
  email: string,
): Promise<string> {
  const res = await apiGet(token, "/people");
  expect(res.status).toBe(200);
  const people = res.body as Array<{ userId?: string | null; email?: string }>;
  const row = people.find(
    (p) => (p.email ?? "").toLowerCase() === email.toLowerCase(),
  );
  expect(row?.userId, `people row for ${email}`).toBeTruthy();
  return row!.userId!;
}

export async function patchUserRole(
  actorToken: string,
  userId: string,
  role: string,
): Promise<void> {
  const res = await apiPatch(actorToken, `/people/${userId}/role`, { role });
  expect(
    res.status,
    `patch role ${userId}→${role} → ${res.status} ${JSON.stringify(res.body)}`,
  ).toBe(200);
}

export async function getModulesSetting(
  token: string,
): Promise<Record<string, boolean>> {
  const res = await apiGet(token, "/settings");
  expect(res.status).toBe(200);
  const modules = (res.body as { modules?: { value?: Record<string, boolean> } })
    .modules?.value;
  expect(modules, "settings.modules.value").toBeTruthy();
  return { ...modules! };
}

export async function patchModulesSetting(
  token: string,
  value: Record<string, boolean>,
  reason = "e2e modules",
): Promise<void> {
  const res = await apiPatch(token, "/settings/modules", { value, reason });
  expect(res.status, `patch modules → ${res.status}`).toBe(200);
}
