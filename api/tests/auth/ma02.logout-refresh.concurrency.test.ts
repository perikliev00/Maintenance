/**
 * MA-02 — logout also ends the replacement of the same session during a concurrent refresh.
 * Cookie + CSRF session flow; PostgreSQL User lock orders refresh vs logout.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { orderedDatabaseRace } from "../dbBarrier";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createEmployeeWithUser } from "../fixtures";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, listenApp } from "../httpHarness";
import { lockUsersForLiveAccess } from "../../src/services/liveAccessLocks";
import { hashRefreshToken } from "../../src/services/authSessions";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();
// REPS: repetition count to amplify race windows.
const REPS = 8;
const PASSWORD = "ma02-logout-refresh-pass";

// Shape CookieJar documents the fixture/response fields this suite touches.
type CookieJar = {
  session: string;
  refresh: string;
  csrf: string;
  header: string;
};

// Helper parseCookies: auth/session setup for the scenario.
function parseCookies(res: Response): CookieJar {
  // getSetCookie: session cookie jar for authenticated requests.
  const getSetCookie = (
    res.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const lines =
    typeof getSetCookie === "function"
      ? getSetCookie.call(res.headers)
      : ([res.headers.get("set-cookie")].filter(Boolean) as string[]);
  const jar: Partial<CookieJar> = {};
  for (const line of lines) {
    const m = /^(session|refresh|csrf)=([^;]+)/.exec(line);
    if (!m) continue;
    const key = m[1] as "session" | "refresh" | "csrf";
    jar[key] = decodeURIComponent(m[2]!);
  }
  assert.ok(jar.session, "missing session cookie");
  assert.ok(jar.refresh, "missing refresh cookie");
  assert.ok(jar.csrf, "missing csrf cookie");
  return {
    session: jar.session!,
    refresh: jar.refresh!,
    csrf: jar.csrf!,
    header: `session=${jar.session}; refresh=${jar.refresh}; csrf=${jar.csrf}`,
  };
}

// Suite: MA-02 logout vs concurrent refresh.
describe("MA-02 logout vs concurrent refresh", () => {
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let userId: string;
  let employeeId: string;
  let email: string;

  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    ({ api, server } = await listenApp());
  });

  after(async () => {
    if (server) await closeServer(server);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const stamp = randomUUID();
    email = `ma02-${stamp}@test.local`;
    // created: seeded entity required before the mutation under test.
    const created = await createEmployeeWithUser(prisma, {
      employeeNumber: `MA02-${stamp}`,
      email,
      role: "housekeeper",
      fullName: "MA02 Logout Refresh",
      password: PASSWORD,
    });
    userId = created.userId;
    employeeId = created.employeeId;
  });

  // Helper loginJar: auth/session setup for the scenario.
  async function loginJar(): Promise<CookieJar> {
    const res = await fetch(`${api}/auth/login`, {
      // Configure method for the request/server under test.
      method: "POST",
      // Configure headers for the request/server under test.
      headers: { "Content-Type": "application/json" },
      // Configure body for the request/server under test.
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    assert.equal(res.status, 200, await res.text());
    return parseCookies(res);
  }

  // Helper postAuth: auth/session setup for the scenario.
  async function postAuth(
    pathName: string,
    jar: CookieJar,
  ): Promise<{ status: number; jar: CookieJar | null; body: unknown }> {
    const res = await fetch(`${api}${pathName}`, {
      // Configure method for the request/server under test.
      method: "POST",
      // Configure headers for the request/server under test.
      headers: {
        "Content-Type": "application/json",
        Cookie: jar.header,
        "X-CSRF-Token": jar.csrf,
      },
      // Configure body for the request/server under test.
      body: "{}",
    });
    const body = await res.json().catch(() => null);
    let next: CookieJar | null = null;
    try {
      next = parseCookies(res);
    } catch {
      next = null;
    }
    return { status: res.status, jar: next, body };
  }

  // Local helper meStatus used by cases in this file.
  async function meStatus(accessToken: string): Promise<number> {
    const res = await fetch(`${api}/auth/me`, {
      // Configure headers for the request/server under test.
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.status;
  }

  // Local helper cleanupUser used by cases in this file.
  async function cleanupUser() {
    await prisma.authSession.deleteMany({ where: { userId } });
    await prisma.device.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.employee.deleteMany({ where: { id: employeeId } });
  }

  // Case checks authz/session policy: sequential: logout then refresh does not leave a live replacement.
  it("sequential: logout then refresh does not leave a live replacement", async () => {
    // jar: session cookie jar for authenticated requests.
    const jar = await loginJar();
    const logout = await postAuth("/auth/logout", jar);
    assert.equal(logout.status, 200);
    const refresh = await postAuth("/auth/refresh", jar);
    assert.equal(refresh.status, 401);
    assert.equal(await meStatus(jar.session), 401);
    const active = await prisma.authSession.count({
      where: { userId, revokedAt: null },
    });
    assert.equal(active, 0);
    await cleanupUser();
  });

  // Case: other device session remains valid while this session is logged out.
  it("other device session remains valid while this session is logged out", async () => {
    const a = await loginJar();
    const b = await loginJar();
    assert.equal(await meStatus(a.session), 200);
    assert.equal(await meStatus(b.session), 200);
    const logout = await postAuth("/auth/logout", a);
    assert.equal(logout.status, 200);
    assert.equal(await meStatus(a.session), 401);
    assert.equal(await meStatus(b.session), 200);
    await cleanupUser();
  });

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let rep = 1; rep <= REPS; rep++) {
    // Case checks authz/session policy: refresh wins then logout must kill replacement (rep ${rep}).
    it(`refresh wins then logout must kill replacement (rep ${rep})`, async () => {
      // jar: session cookie jar for authenticated requests.
      const jar = await loginJar();
      const originalHash = hashRefreshToken(jar.refresh);

      const settled = await orderedDatabaseRace(
        prisma,
        (tx) => lockUsersForLiveAccess(tx, [userId]),
        () => postAuth("/auth/refresh", jar),
        () => postAuth("/auth/logout", jar),
      );

      const refreshResult = settled[0]!;
      const logoutResult = settled[1]!;
      assert.equal(refreshResult.status, "fulfilled");
      assert.equal(logoutResult.status, "fulfilled");
      const refresh = refreshResult.value as Awaited<ReturnType<typeof postAuth>>;
      const logout = logoutResult.value as Awaited<ReturnType<typeof postAuth>>;
      assert.equal(refresh.status, 200, JSON.stringify(refresh.body));
      assert.equal(logout.status, 200, JSON.stringify(logout.body));
      assert.ok(refresh.jar, "refresh must issue replacement cookies");

      assert.equal(
        await meStatus(refresh.jar!.session),
        401,
        "replacement access must be revoked after logout",
      );
      assert.equal(await meStatus(jar.session), 401);

      const replay = await postAuth("/auth/refresh", refresh.jar!);
      assert.equal(
        replay.status,
        401,
        "replacement refresh must not mint another session after logout",
      );

      const active = await prisma.authSession.count({
        where: { userId, revokedAt: null },
      });
      assert.equal(active, 0, "no live sessions after logout of rotated chain");

      const original = await prisma.authSession.findUnique({
        where: { refreshTokenHash: originalHash },
      });
      assert.ok(original?.revokedAt);
      await cleanupUser();
    });
  }

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let rep = 1; rep <= REPS; rep++) {
    // Case checks authz/session policy: logout wins then refresh must not leave a live replacement (rep ${rep}).
    it(`logout wins then refresh must not leave a live replacement (rep ${rep})`, async () => {
      // jar: session cookie jar for authenticated requests.
      const jar = await loginJar();

      const settled = await orderedDatabaseRace(
        prisma,
        (tx) => lockUsersForLiveAccess(tx, [userId]),
        () => postAuth("/auth/logout", jar),
        () => postAuth("/auth/refresh", jar),
      );

      const logoutResult = settled[0]!;
      const refreshResult = settled[1]!;
      assert.equal(logoutResult.status, "fulfilled");
      assert.equal(refreshResult.status, "fulfilled");
      const logout = logoutResult.value as Awaited<ReturnType<typeof postAuth>>;
      const refresh = refreshResult.value as Awaited<ReturnType<typeof postAuth>>;
      assert.equal(logout.status, 200);

      if (refresh.status === 200 && refresh.jar) {
        assert.equal(
          await meStatus(refresh.jar.session),
          401,
          "refresh after logout must not yield usable access",
        );
      } else {
        assert.equal(refresh.status, 401);
      }

      const active = await prisma.authSession.count({
        where: { userId, revokedAt: null },
      });
      assert.equal(active, 0);
      await cleanupUser();
    });
  }

  // Case checks idempotent replay safety: idempotent second logout stays ok.
  it("idempotent second logout stays ok", async () => {
    // jar: session cookie jar for authenticated requests.
    const jar = await loginJar();
    assert.equal((await postAuth("/auth/logout", jar)).status, 200);
    assert.equal((await postAuth("/auth/logout", jar)).status, 200);
    await cleanupUser();
  });
});
