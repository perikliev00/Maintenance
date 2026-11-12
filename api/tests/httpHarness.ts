/**
 * Shared HTTP test helpers for createApp integration tests.
 *
 * Prefer Bearer Authorization (access token from the session cookie value).
 * createApp() installs requireCsrf: Bearer without a Cookie session skips CSRF;
 * cookie-authenticated browser flows need CSRF header + cookie.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { GrantKind, PrismaClient, Role } from "@prisma/client";
import { createApp } from "../src/app";
import { invalidateGrantCache } from "../src/services/roleGrants";

// Export RoleGrantSnapshotRow for shared test/setup consumers.
export type RoleGrantSnapshotRow = {
  role: Role;
  kind: GrantKind;
  key: string;
};

// Export helper listenApp for reuse across related tests.
export async function listenApp(): Promise<{
  server: http.Server;
  api: string;
}> {
  // app: in-process HTTP server handle for this suite.
  const app = createApp();
  // server: in-process HTTP server handle for this suite.
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object", "server address");
  return { server, api: `http://127.0.0.1:${addr.port}` };
}

// Export helper closeServer for reuse across related tests.
export async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

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

/** Login and return the access token from the session Set-Cookie (Bearer-ready). */
export async function loginBearer(
  api: string,
  email: string,
  password: string,
): Promise<{ token: string; user: { id?: string; employeeId: string; role: Role } }> {
  const res = await fetch(`${api}/auth/login`, {
    // Configure method for the request/server under test.
    method: "POST",
    // Configure headers for the request/server under test.
    headers: { "Content-Type": "application/json" },
    // Configure body for the request/server under test.
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.ok, true, `login ${email} → ${res.status}`);
  const body = (await res.json()) as {
    user: { id?: string; employeeId: string; role: Role };
  };
  const token = sessionFromSetCookie(res);
  assert.ok(token, `login ${email}: missing session cookie`);
  return { token, user: body.user };
}

// Export helper requestJson for reuse across related tests.
export async function requestJson(
  api: string,
  token: string,
  // Configure method for the request/server under test.
  method: string,
  pathName: string,
  payload?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${api}${pathName}`, {
    method,
    // Configure headers for the request/server under test.
    headers: {
      Authorization: `Bearer ${token}`,
      ...(payload !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    // Configure body for the request/server under test.
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// Export helper getJson for reuse across related tests.
export async function getJson(
  api: string,
  token: string,
  pathName: string,
) {
  return requestJson(api, token, "GET", pathName);
}

// Export helper postJson for reuse across related tests.
export async function postJson(
  api: string,
  token: string,
  pathName: string,
  payload: unknown,
) {
  return requestJson(api, token, "POST", pathName, payload);
}

// Export helper putJson for reuse across related tests.
export async function putJson(
  api: string,
  token: string,
  pathName: string,
  payload: unknown,
) {
  return requestJson(api, token, "PUT", pathName, payload);
}

/** Read current RoleGrantRevision version for a matrix role. */
export async function getRoleGrantVersion(
  api: string,
  token: string,
  role: string,
): Promise<number> {
  const matrix = await getJson(api, token, "/permissions/matrix");
  assert.equal(matrix.status, 200, `matrix → ${matrix.status}`);
  const versions = (matrix.body as { versions?: Record<string, number> })
    .versions;
  const version = versions?.[role];
  assert.ok(
    typeof version === "number",
    `matrix versions missing ${role}: ${JSON.stringify(versions)}`,
  );
  return version;
}

/**
 * PUT /permissions/roles/:role with the current expectedVersion from the matrix.
 * Pass `expectedVersion` to override (stale-client / concurrency tests).
 */
export async function putRoleGrantsJson(
  api: string,
  token: string,
  role: string,
  // Configure body for the request/server under test.
  body: {
    panels: string[];
    actions: string[];
    reason?: string;
    expectedVersion?: number;
  },
) {
  const expectedVersion =
    body.expectedVersion ?? (await getRoleGrantVersion(api, token, role));
  return putJson(api, token, `/permissions/roles/${role}`, {
    panels: body.panels,
    actions: body.actions,
    reason: body.reason,
    expectedVersion,
  });
}

// Export helper patchJson for reuse across related tests.
export async function patchJson(
  api: string,
  token: string,
  pathName: string,
  payload: unknown,
) {
  return requestJson(api, token, "PATCH", pathName, payload);
}

/** Snapshot RoleGrant rows for the given roles (shared-DB isolation). */
export async function snapshotRoleGrants(
  prisma: PrismaClient,
  roles: Role[],
): Promise<RoleGrantSnapshotRow[]> {
  const rows = await prisma.roleGrant.findMany({
    where: { role: { in: roles } },
    select: { role: true, kind: true, key: true },
  });
  return rows.map((r) => ({ role: r.role, kind: r.kind, key: r.key }));
}

/** Replace RoleGrant rows for roles with a prior snapshot; invalidate cache. */
export async function restoreRoleGrants(
  prisma: PrismaClient,
  roles: Role[],
  snapshot: RoleGrantSnapshotRow[],
): Promise<void> {
  // Bump RoleGrantRevision in the same transaction so other API processes'
  // stamp-gated caches reload instead of serving pre-restore rows for up to TTL.
  await prisma.$transaction(async (tx) => {
    await tx.roleGrant.deleteMany({ where: { role: { in: roles } } });
    if (snapshot.length) {
      await tx.roleGrant.createMany({
        data: snapshot.map((r) => ({
          role: r.role,
          kind: r.kind,
          key: r.key,
        })),
      });
    }
    if (roles.length) {
      await tx.roleGrantRevision.updateMany({
        where: { role: { in: roles } },
        data: { version: { increment: 1 } },
      });
    }
  });
  invalidateGrantCache();
}
