// Playwright test runner APIs for browser E2E scenarios.
import { expect } from "@playwright/test";
// Import bindings from ./auth.
import { DEMO_PASSWORD } from "./auth";

/** Direct API origin (Vite proxies /api → this in the browser). */
export const API_ORIGIN =
  // Override env for isolation, rate-limit disable, or scheduler quieting.
  process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:4000";

// Shape Json documents the fixture/response fields this suite touches.
type Json = Record<string, unknown>;

// Helper sessionFromSetCookie: auth/session setup for the scenario.
function sessionFromSetCookie(res: Response): string | null {
  // getSetCookie: session cookie jar for authenticated requests.
  const getSetCookie = (
    // Session/CSRF step exercising auth lifecycle.
    res.headers as Headers & { getSetCookie?: () => string[] }
  // Session/CSRF step exercising auth lifecycle.
  ).getSetCookie;
  // Bind lines for later setup or assertions in this scope.
  const lines =
    // Session/CSRF step exercising auth lifecycle.
    typeof getSetCookie === "function"
      ? getSetCookie.call(res.headers)
      : ([res.headers.get("set-cookie")].filter(Boolean) as string[]);
  // Iterate to cover variants or wait until a condition holds.
  for (const line of lines) {
    // Bind m for later setup or assertions in this scope.
    const m = /^session=([^;]+)/.exec(line);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (m) return decodeURIComponent(m[1]!);
  }
  // Return the arranged value/result to the caller.
  return null;
}

/** Password login against the API; returns Bearer access token from session cookie. */
export async function apiLogin(
  // Fixture field email for the seeded actor/entity.
  email: string,
  // Execute the next setup or assertion step for this scenario.
  password = DEMO_PASSWORD,
// Execute the next setup or assertion step for this scenario.
): Promise<{ token: string; user: Json }> {
  // res: HTTP response captured for status/body checks.
  const res = await fetch(`${API_ORIGIN}/auth/login`, {
    // Configure method for the request/server under test.
    method: "POST",
    // Configure headers for the request/server under test.
    headers: { "Content-Type": "application/json" },
    // Configure body for the request/server under test.
    body: JSON.stringify({ email, password }),
  });
  // Assert response/page reached the expected status.
  expect(res.ok, `api login ${email} → ${res.status}`).toBeTruthy();
  // body: synchronize actors so the race window is observable.
  const body = (await res.json()) as { user: Json };
  // token: credential/token material for auth flows.
  const token = sessionFromSetCookie(res);
  // Assert browser/UI outcome matches the scenario intent.
  expect(token, `api login ${email}: missing session cookie`).toBeTruthy();
  // Return the arranged value/result to the caller.
  return { token: token!, user: body.user };
}

// Local helper apiJson used by cases in this file.
async function apiJson(
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Configure method for the request/server under test.
  method: string,
  // Execute the next setup or assertion step for this scenario.
  pathName: string,
  // Execute the next setup or assertion step for this scenario.
  payload?: unknown,
// Execute the next setup or assertion step for this scenario.
): Promise<{ status: number; body: unknown }> {
  // res: HTTP response captured for status/body checks.
  const res = await fetch(`${API_ORIGIN}${pathName}`, {
    // Execute the next setup or assertion step for this scenario.
    method,
    // Configure headers for the request/server under test.
    headers: {
      // Execute the next setup or assertion step for this scenario.
      Authorization: `Bearer ${token}`,
      // Continue the call chain for setup or assertion detail.
      ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    // Configure body for the request/server under test.
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  // body: synchronize actors so the race window is observable.
  const body = await res.json().catch(() => null);
  // Return the arranged value/result to the caller.
  return { status: res.status, body };
}

// Export helper apiGet for reuse across related tests.
export async function apiGet(token: string, pathName: string) {
  // Return the arranged value/result to the caller.
  return apiJson(token, "GET", pathName);
}

// Export helper apiPut for reuse across related tests.
export async function apiPut(
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  pathName: string,
  // Execute the next setup or assertion step for this scenario.
  payload: unknown,
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return apiJson(token, "PUT", pathName, payload);
}

// Export helper apiPatch for reuse across related tests.
export async function apiPatch(
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  pathName: string,
  // Execute the next setup or assertion step for this scenario.
  payload: unknown,
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return apiJson(token, "PATCH", pathName, payload);
}

// Export helper apiPost for reuse across related tests.
export async function apiPost(
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  pathName: string,
  // Execute the next setup or assertion step for this scenario.
  payload?: unknown,
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return apiJson(token, "POST", pathName, payload ?? {});
}

// Export RoleGrants for shared test/setup consumers.
export type RoleGrants = { panels: string[]; actions: string[] };

/** Read one role's grants from the permissions matrix. */
export async function getRoleGrants(
  // Execute the next setup or assertion step for this scenario.
  ownerToken: string,
  // Fixture field role for the seeded actor/entity.
  role: string,
// Execute the next setup or assertion step for this scenario.
): Promise<RoleGrants & { version: number }> {
  // res: HTTP response captured for status/body checks.
  const res = await apiGet(ownerToken, "/permissions/matrix");
  // Assert response/page reached the expected status.
  expect(res.status).toBe(200);
  // Bind body for later setup or assertions in this scope.
  const body = res.body as {
    // Execute the next setup or assertion step for this scenario.
    byRole?: Record<string, RoleGrants>;
    // Execute the next setup or assertion step for this scenario.
    versions?: Record<string, number>;
  };
  // Bind byRole for later setup or assertions in this scope.
  const byRole = body.byRole;
  // Assert browser/UI outcome matches the scenario intent.
  expect(byRole?.[role], `matrix missing role ${role}`).toBeTruthy();
  // Bind version for later setup or assertions in this scope.
  const version = body.versions?.[role];
  // Assert browser/UI outcome matches the scenario intent.
  expect(typeof version, `matrix versions missing ${role}`).toBe("number");
  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    panels: [...(byRole![role].panels ?? [])],
    // Execute the next setup or assertion step for this scenario.
    actions: [...(byRole![role].actions ?? [])],
    // Execute the next setup or assertion step for this scenario.
    version: version!,
  };
}

// Export helper putRoleGrants for reuse across related tests.
export async function putRoleGrants(
  // Execute the next setup or assertion step for this scenario.
  ownerToken: string,
  // Fixture field role for the seeded actor/entity.
  role: string,
  // Execute the next setup or assertion step for this scenario.
  grants: RoleGrants,
  // Execute the next setup or assertion step for this scenario.
  reason = "e2e restore",
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // current: HTTP response captured for status/body checks.
  const current = await getRoleGrants(ownerToken, role);
  // res: HTTP response captured for status/body checks.
  const res = await apiPut(ownerToken, `/permissions/roles/${role}`, {
    // Execute the next setup or assertion step for this scenario.
    panels: grants.panels,
    // Execute the next setup or assertion step for this scenario.
    actions: grants.actions,
    // Execute the next setup or assertion step for this scenario.
    expectedVersion: current.version,
    // Execute the next setup or assertion step for this scenario.
    reason,
  });
  // Assert response/page reached the expected status.
  expect(res.status, `put grants ${role} → ${res.status}`).toBe(200);
}

/** Find a seeded user id by email via /people. */
export async function findUserIdByEmail(
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Fixture field email for the seeded actor/entity.
  email: string,
// Execute the next setup or assertion step for this scenario.
): Promise<string> {
  // res: HTTP response captured for status/body checks.
  const res = await apiGet(token, "/people");
  // Assert response/page reached the expected status.
  expect(res.status).toBe(200);
  // Bind people for later setup or assertions in this scope.
  const people = res.body as Array<{ userId?: string | null; email?: string }>;
  // Bind row for later setup or assertions in this scope.
  const row = people.find(
    // Execute the next setup or assertion step for this scenario.
    (p) => (p.email ?? "").toLowerCase() === email.toLowerCase(),
  );
  // Assert browser/UI outcome matches the scenario intent.
  expect(row?.userId, `people row for ${email}`).toBeTruthy();
  // Return the arranged value/result to the caller.
  return row!.userId!;
}

// Export helper patchUserRole for reuse across related tests.
export async function patchUserRole(
  // Execute the next setup or assertion step for this scenario.
  actorToken: string,
  // Execute the next setup or assertion step for this scenario.
  userId: string,
  // Fixture field role for the seeded actor/entity.
  role: string,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // res: HTTP response captured for status/body checks.
  const res = await apiPatch(actorToken, `/people/${userId}/role`, { role });
  // Assert browser/UI outcome matches the scenario intent.
  expect(
    // Execute the next setup or assertion step for this scenario.
    res.status,
    // Execute the next setup or assertion step for this scenario.
    `patch role ${userId}→${role} → ${res.status} ${JSON.stringify(res.body)}`,
  // Execute the next setup or assertion step for this scenario.
  ).toBe(200);
}

// Export helper getModulesSetting for reuse across related tests.
export async function getModulesSetting(
  // Execute the next setup or assertion step for this scenario.
  token: string,
// Execute the next setup or assertion step for this scenario.
): Promise<Record<string, boolean>> {
  // res: HTTP response captured for status/body checks.
  const res = await apiGet(token, "/settings");
  // Assert response/page reached the expected status.
  expect(res.status).toBe(200);
  // Bind modules for later setup or assertions in this scope.
  const modules = (res.body as { modules?: { value?: Record<string, boolean> } })
    // Continue the call chain for setup or assertion detail.
    .modules?.value;
  // Assert browser/UI outcome matches the scenario intent.
  expect(modules, "settings.modules.value").toBeTruthy();
  // Return the arranged value/result to the caller.
  return { ...modules! };
}

// Export helper patchModulesSetting for reuse across related tests.
export async function patchModulesSetting(
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  value: Record<string, boolean>,
  // Execute the next setup or assertion step for this scenario.
  reason = "e2e modules",
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Read current version so restore/setup patches do not 409 against a concurrent UI save.
  const current = await apiGet(token, "/settings");
  // Assert response/page reached the expected status.
  expect(current.status).toBe(200);
  // Bind expectedVersion for later setup or assertions in this scope.
  const expectedVersion = (
    // Execute the next setup or assertion step for this scenario.
    current.body as { modules?: { version?: number } }
  // Execute the next setup or assertion step for this scenario.
  ).modules?.version;
  // res: HTTP response captured for status/body checks.
  const res = await apiPatch(token, "/settings/modules", {
    // Execute the next setup or assertion step for this scenario.
    value,
    // Execute the next setup or assertion step for this scenario.
    reason,
    // Continue the call chain for setup or assertion detail.
    ...(typeof expectedVersion === "number" ? { expectedVersion } : {}),
  });
  // Assert response/page reached the expected status.
  expect(res.status, `patch modules → ${res.status}`).toBe(200);
}
