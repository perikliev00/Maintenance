// Playwright test runner APIs for browser E2E scenarios.
import { expect } from "@playwright/test";
import { DEMO_PASSWORD } from "./auth";

/** Direct API origin (Vite proxies /api → this in the browser). */
export const API_ORIGIN =
  process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:4000";

// Shape Json documents the fixture/response fields this suite touches.
type Json = Record<string, unknown>;

// Helper sessionFromSetCookie: auth/session setup for the scenario.
function sessionFromSetCookie(res: Response): string | null {
  // getSetCookie: session cookie jar for authenticated requests.
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
    // Configure method for the request/server under test.
    method: "POST",
    // Configure headers for the request/server under test.
    headers: { "Content-Type": "application/json" },
    // Configure body for the request/server under test.
    body: JSON.stringify({ email, password }),
  });
  expect(res.ok, `api login ${email} → ${res.status}`).toBeTruthy();
  const body = (await res.json()) as { user: Json };
  const token = sessionFromSetCookie(res);
  expect(token, `api login ${email}: missing session cookie`).toBeTruthy();
  return { token: token!, user: body.user };
}

// Local helper apiJson used by cases in this file.
async function apiJson(
  token: string,
  // Configure method for the request/server under test.
  method: string,
  pathName: string,
  payload?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_ORIGIN}${pathName}`, {
    method,
    // Configure headers for the request/server under test.
    headers: {
      Authorization: `Bearer ${token}`,
      ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    // Configure body for the request/server under test.
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// Export helper apiGet for reuse across related tests.
export async function apiGet(token: string, pathName: string) {
  return apiJson(token, "GET", pathName);
}

// Export helper apiPut for reuse across related tests.
export async function apiPut(
  token: string,
  pathName: string,
  payload: unknown,
) {
  return apiJson(token, "PUT", pathName, payload);
}

// Export helper apiPatch for reuse across related tests.
export async function apiPatch(
  token: string,
  pathName: string,
  payload: unknown,
) {
  return apiJson(token, "PATCH", pathName, payload);
}

// Export helper apiPost for reuse across related tests.
export async function apiPost(
  token: string,
  pathName: string,
  payload?: unknown,
) {
  return apiJson(token, "POST", pathName, payload ?? {});
}

// Export RoleGrants for shared test/setup consumers.
export type RoleGrants = { panels: string[]; actions: string[] };

/** Read one role's grants from the permissions matrix. */
export async function getRoleGrants(
  ownerToken: string,
  role: string,
): Promise<RoleGrants & { version: number }> {
  const res = await apiGet(ownerToken, "/permissions/matrix");
  expect(res.status).toBe(200);
  const body = res.body as {
    byRole?: Record<string, RoleGrants>;
    versions?: Record<string, number>;
  };
  const byRole = body.byRole;
  expect(byRole?.[role], `matrix missing role ${role}`).toBeTruthy();
  const version = body.versions?.[role];
  expect(typeof version, `matrix versions missing ${role}`).toBe("number");
  return {
    panels: [...(byRole![role].panels ?? [])],
    actions: [...(byRole![role].actions ?? [])],
    version: version!,
  };
}

// Export helper putRoleGrants for reuse across related tests.
export async function putRoleGrants(
  ownerToken: string,
  role: string,
  grants: RoleGrants,
  reason = "e2e restore",
): Promise<void> {
  const current = await getRoleGrants(ownerToken, role);
  const res = await apiPut(ownerToken, `/permissions/roles/${role}`, {
    panels: grants.panels,
    actions: grants.actions,
    expectedVersion: current.version,
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

// Export helper patchUserRole for reuse across related tests.
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

// Export helper getModulesSetting for reuse across related tests.
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

// Export helper patchModulesSetting for reuse across related tests.
export async function patchModulesSetting(
  token: string,
  value: Record<string, boolean>,
  reason = "e2e modules",
): Promise<void> {
  // Read current version so restore/setup patches do not 409 against a concurrent UI save.
  const current = await apiGet(token, "/settings");
  expect(current.status).toBe(200);
  const expectedVersion = (
    current.body as { modules?: { version?: number } }
  ).modules?.version;
  const res = await apiPatch(token, "/settings/modules", {
    value,
    reason,
    ...(typeof expectedVersion === "number" ? { expectedVersion } : {}),
  });
  expect(res.status, `patch modules → ${res.status}`).toBe(200);
}
