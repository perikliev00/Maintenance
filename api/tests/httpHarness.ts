/**
 * Shared HTTP test helpers for createApp integration tests.
 *
 * Prefer Bearer Authorization (access token from the session cookie value).
 * createApp() installs requireCsrf: Bearer without a Cookie session skips CSRF;
 * cookie-authenticated browser flows need CSRF header + cookie.
 */
import assert from "node:assert/strict";
// Import bindings from node:http.
import http from "node:http";
// Prisma client types/runtime for DB setup and assertions.
import { GrantKind, PrismaClient, Role } from "@prisma/client";
// Import bindings from ../src/app.
import { createApp } from "../src/app";
// Import bindings from ../src/services/roleGrants.
import { invalidateGrantCache } from "../src/services/roleGrants";

// Export RoleGrantSnapshotRow for shared test/setup consumers.
export type RoleGrantSnapshotRow = {
  // Fixture field role for the seeded actor/entity.
  role: Role;
  // Execute the next setup or assertion step for this scenario.
  kind: GrantKind;
  // Execute the next setup or assertion step for this scenario.
  key: string;
};

// Export helper listenApp for reuse across related tests.
export async function listenApp(): Promise<{
  // Execute the next setup or assertion step for this scenario.
  server: http.Server;
  // Execute the next setup or assertion step for this scenario.
  api: string;
// Execute the next setup or assertion step for this scenario.
}> {
  // app: in-process HTTP server handle for this suite.
  const app = createApp();
  // server: in-process HTTP server handle for this suite.
  const server = http.createServer(app);
  // Await async work before asserting or releasing locks.
  await new Promise<void>((resolve, reject) => {
    // Execute the next setup or assertion step for this scenario.
    server.once("error", reject);
    // Execute the next setup or assertion step for this scenario.
    server.listen(0, "127.0.0.1", () => resolve());
  });
  // Bind addr for later setup or assertions in this scope.
  const addr = server.address();
  // Assert the observed value matches the intended post-condition.
  assert.ok(addr && typeof addr === "object", "server address");
  // Return the arranged value/result to the caller.
  return { server, api: `http://127.0.0.1:${addr.port}` };
}

// Export helper closeServer for reuse across related tests.
export async function closeServer(server: http.Server): Promise<void> {
  // Await async work before asserting or releasing locks.
  await new Promise<void>((resolve, reject) => {
    // Execute the next setup or assertion step for this scenario.
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

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

/** Login and return the access token from the session Set-Cookie (Bearer-ready). */
export async function loginBearer(
  // Execute the next setup or assertion step for this scenario.
  api: string,
  // Fixture field email for the seeded actor/entity.
  email: string,
  // Fixture field password for the seeded actor/entity.
  password: string,
// Execute the next setup or assertion step for this scenario.
): Promise<{ token: string; user: { id?: string; employeeId: string; role: Role } }> {
  // res: HTTP response captured for status/body checks.
  const res = await fetch(`${api}/auth/login`, {
    // Configure method for the request/server under test.
    method: "POST",
    // Configure headers for the request/server under test.
    headers: { "Content-Type": "application/json" },
    // Configure body for the request/server under test.
    body: JSON.stringify({ email, password }),
  });
  // Assert HTTP status matches the contract for this path.
  assert.equal(res.ok, true, `login ${email} → ${res.status}`);
  // body: synchronize actors so the race window is observable.
  const body = (await res.json()) as {
    // Execute the next setup or assertion step for this scenario.
    user: { id?: string; employeeId: string; role: Role };
  };
  // token: credential/token material for auth flows.
  const token = sessionFromSetCookie(res);
  // Assert the observed value matches the intended post-condition.
  assert.ok(token, `login ${email}: missing session cookie`);
  // Return the arranged value/result to the caller.
  return { token, user: body.user };
}

// Export helper requestJson for reuse across related tests.
export async function requestJson(
  // Execute the next setup or assertion step for this scenario.
  api: string,
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
  const res = await fetch(`${api}${pathName}`, {
    // Execute the next setup or assertion step for this scenario.
    method,
    // Configure headers for the request/server under test.
    headers: {
      // Execute the next setup or assertion step for this scenario.
      Authorization: `Bearer ${token}`,
      // Continue the call chain for setup or assertion detail.
      ...(payload !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    // Configure body for the request/server under test.
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  // body: synchronize actors so the race window is observable.
  const body = await res.json().catch(() => null);
  // Return the arranged value/result to the caller.
  return { status: res.status, body };
}

// Export helper getJson for reuse across related tests.
export async function getJson(
  // Execute the next setup or assertion step for this scenario.
  api: string,
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  pathName: string,
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return requestJson(api, token, "GET", pathName);
}

// Export helper postJson for reuse across related tests.
export async function postJson(
  // Execute the next setup or assertion step for this scenario.
  api: string,
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  pathName: string,
  // Execute the next setup or assertion step for this scenario.
  payload: unknown,
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return requestJson(api, token, "POST", pathName, payload);
}

// Export helper putJson for reuse across related tests.
export async function putJson(
  // Execute the next setup or assertion step for this scenario.
  api: string,
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  pathName: string,
  // Execute the next setup or assertion step for this scenario.
  payload: unknown,
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return requestJson(api, token, "PUT", pathName, payload);
}

/** Read current RoleGrantRevision version for a matrix role. */
export async function getRoleGrantVersion(
  // Execute the next setup or assertion step for this scenario.
  api: string,
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Fixture field role for the seeded actor/entity.
  role: string,
// Execute the next setup or assertion step for this scenario.
): Promise<number> {
  // matrix: HTTP response captured for status/body checks.
  const matrix = await getJson(api, token, "/permissions/matrix");
  // Assert HTTP status matches the contract for this path.
  assert.equal(matrix.status, 200, `matrix → ${matrix.status}`);
  // Bind versions for later setup or assertions in this scope.
  const versions = (matrix.body as { versions?: Record<string, number> })
    // Continue the call chain for setup or assertion detail.
    .versions;
  // Bind version for later setup or assertions in this scope.
  const version = versions?.[role];
  // Assert the observed value matches the intended post-condition.
  assert.ok(
    // Execute the next setup or assertion step for this scenario.
    typeof version === "number",
    // Execute the next setup or assertion step for this scenario.
    `matrix versions missing ${role}: ${JSON.stringify(versions)}`,
  );
  // Return the arranged value/result to the caller.
  return version;
}

/**
 * PUT /permissions/roles/:role with the current expectedVersion from the matrix.
 * Pass `expectedVersion` to override (stale-client / concurrency tests).
 */
export async function putRoleGrantsJson(
  // Execute the next setup or assertion step for this scenario.
  api: string,
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Fixture field role for the seeded actor/entity.
  role: string,
  // Configure body for the request/server under test.
  body: {
    // Execute the next setup or assertion step for this scenario.
    panels: string[];
    // Execute the next setup or assertion step for this scenario.
    actions: string[];
    // Execute the next setup or assertion step for this scenario.
    reason?: string;
    // Execute the next setup or assertion step for this scenario.
    expectedVersion?: number;
  },
// Execute the next setup or assertion step for this scenario.
) {
  // Bind expectedVersion for later setup or assertions in this scope.
  const expectedVersion =
    // Await async work before asserting or releasing locks.
    body.expectedVersion ?? (await getRoleGrantVersion(api, token, role));
  // Return the arranged value/result to the caller.
  return putJson(api, token, `/permissions/roles/${role}`, {
    // Execute the next setup or assertion step for this scenario.
    panels: body.panels,
    // Execute the next setup or assertion step for this scenario.
    actions: body.actions,
    // Execute the next setup or assertion step for this scenario.
    reason: body.reason,
    // Execute the next setup or assertion step for this scenario.
    expectedVersion,
  });
}

// Export helper patchJson for reuse across related tests.
export async function patchJson(
  // Execute the next setup or assertion step for this scenario.
  api: string,
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  pathName: string,
  // Execute the next setup or assertion step for this scenario.
  payload: unknown,
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return requestJson(api, token, "PATCH", pathName, payload);
}

/** Snapshot RoleGrant rows for the given roles (shared-DB isolation). */
export async function snapshotRoleGrants(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  roles: Role[],
// Execute the next setup or assertion step for this scenario.
): Promise<RoleGrantSnapshotRow[]> {
  // rows: synchronize actors so the race window is observable.
  const rows = await prisma.roleGrant.findMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { role: { in: roles } },
    // SQL fragment used to observe locks or assert DB state.
    select: { role: true, kind: true, key: true },
  });
  // Return the arranged value/result to the caller.
  return rows.map((r) => ({ role: r.role, kind: r.kind, key: r.key }));
}

/** Replace RoleGrant rows for roles with a prior snapshot; invalidate cache. */
export async function restoreRoleGrants(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  roles: Role[],
  // Execute the next setup or assertion step for this scenario.
  snapshot: RoleGrantSnapshotRow[],
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Bump RoleGrantRevision in the same transaction so other API processes'
  // stamp-gated caches reload instead of serving pre-restore rows for up to TTL.
  await prisma.$transaction(async (tx) => {
    // Await async work before asserting or releasing locks.
    await tx.roleGrant.deleteMany({ where: { role: { in: roles } } });
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (snapshot.length) {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await tx.roleGrant.createMany({
        // Execute the next setup or assertion step for this scenario.
        data: snapshot.map((r) => ({
          // Fixture field role for the seeded actor/entity.
          role: r.role,
          // Execute the next setup or assertion step for this scenario.
          kind: r.kind,
          // Execute the next setup or assertion step for this scenario.
          key: r.key,
        })),
      });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (roles.length) {
      // Await async work before asserting or releasing locks.
      await tx.roleGrantRevision.updateMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { role: { in: roles } },
        // Execute the next setup or assertion step for this scenario.
        data: { version: { increment: 1 } },
      });
    }
  });
  // Execute the next setup or assertion step for this scenario.
  invalidateGrantCache();
}
