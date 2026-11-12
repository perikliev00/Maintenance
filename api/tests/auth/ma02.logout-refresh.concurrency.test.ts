/**
 * MA-02 — logout also ends the replacement of the same session during a concurrent refresh.
 * Cookie + CSRF session flow; PostgreSQL User lock orders refresh vs logout.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient } from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { orderedDatabaseRace } from "../dbBarrier";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createEmployeeWithUser } from "../fixtures";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, listenApp } from "../httpHarness";
// Import bindings from ../../src/services/liveAccessLocks.
import { lockUsersForLiveAccess } from "../../src/services/liveAccessLocks";
// Import bindings from ../../src/services/authSessions.
import { hashRefreshToken } from "../../src/services/authSessions";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();
// REPS: repetition count to amplify race windows.
const REPS = 8;
// PASSWORD: credential/token material for auth flows.
const PASSWORD = "ma02-logout-refresh-pass";

// Shape CookieJar documents the fixture/response fields this suite touches.
type CookieJar = {
  // Session/CSRF step exercising auth lifecycle.
  session: string;
  // Session/CSRF step exercising auth lifecycle.
  refresh: string;
  // Session/CSRF step exercising auth lifecycle.
  csrf: string;
  // Execute the next setup or assertion step for this scenario.
  header: string;
};

// Helper parseCookies: auth/session setup for the scenario.
function parseCookies(res: Response): CookieJar {
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
  // Session/CSRF step exercising auth lifecycle.
  const jar: Partial<CookieJar> = {};
  // Iterate to cover variants or wait until a condition holds.
  for (const line of lines) {
    // Bind m for later setup or assertions in this scope.
    const m = /^(session|refresh|csrf)=([^;]+)/.exec(line);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (!m) continue;
    // Bind key for later setup or assertions in this scope.
    const key = m[1] as "session" | "refresh" | "csrf";
    // Execute the next setup or assertion step for this scenario.
    jar[key] = decodeURIComponent(m[2]!);
  }
  // Assert the observed value matches the intended post-condition.
  assert.ok(jar.session, "missing session cookie");
  // Assert the observed value matches the intended post-condition.
  assert.ok(jar.refresh, "missing refresh cookie");
  // Assert the observed value matches the intended post-condition.
  assert.ok(jar.csrf, "missing csrf cookie");
  // Return the arranged value/result to the caller.
  return {
    // Session/CSRF step exercising auth lifecycle.
    session: jar.session!,
    // Session/CSRF step exercising auth lifecycle.
    refresh: jar.refresh!,
    // Session/CSRF step exercising auth lifecycle.
    csrf: jar.csrf!,
    // Session/CSRF step exercising auth lifecycle.
    header: `session=${jar.session}; refresh=${jar.refresh}; csrf=${jar.csrf}`,
  };
}

// Suite: MA-02 logout vs concurrent refresh.
describe("MA-02 logout vs concurrent refresh", () => {
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Execute the next setup or assertion step for this scenario.
  let userId: string;
  // Execute the next setup or assertion step for this scenario.
  let employeeId: string;
  // Execute the next setup or assertion step for this scenario.
  let email: string;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    // Start or stop the in-process API server for this suite.
    ({ api, server } = await listenApp());
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = randomUUID();
    // Execute the next setup or assertion step for this scenario.
    email = `ma02-${stamp}@test.local`;
    // created: seeded entity required before the mutation under test.
    const created = await createEmployeeWithUser(prisma, {
      // Fixture field employeeNumber for the seeded actor/entity.
      employeeNumber: `MA02-${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      email,
      // Fixture field role for the seeded actor/entity.
      role: "housekeeper",
      // Fixture field fullName for the seeded actor/entity.
      fullName: "MA02 Logout Refresh",
      // Fixture field password for the seeded actor/entity.
      password: PASSWORD,
    });
    // Execute the next setup or assertion step for this scenario.
    userId = created.userId;
    // Execute the next setup or assertion step for this scenario.
    employeeId = created.employeeId;
  });

  // Helper loginJar: auth/session setup for the scenario.
  async function loginJar(): Promise<CookieJar> {
    // res: HTTP response captured for status/body checks.
    const res = await fetch(`${api}/auth/login`, {
      // Configure method for the request/server under test.
      method: "POST",
      // Configure headers for the request/server under test.
      headers: { "Content-Type": "application/json" },
      // Configure body for the request/server under test.
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200, await res.text());
    // Return the arranged value/result to the caller.
    return parseCookies(res);
  }

  // Helper postAuth: auth/session setup for the scenario.
  async function postAuth(
    // Execute the next setup or assertion step for this scenario.
    pathName: string,
    // Session/CSRF step exercising auth lifecycle.
    jar: CookieJar,
  // Session/CSRF step exercising auth lifecycle.
  ): Promise<{ status: number; jar: CookieJar | null; body: unknown }> {
    // res: HTTP response captured for status/body checks.
    const res = await fetch(`${api}${pathName}`, {
      // Configure method for the request/server under test.
      method: "POST",
      // Configure headers for the request/server under test.
      headers: {
        // Execute the next setup or assertion step for this scenario.
        "Content-Type": "application/json",
        // Session/CSRF step exercising auth lifecycle.
        Cookie: jar.header,
        // Session/CSRF step exercising auth lifecycle.
        "X-CSRF-Token": jar.csrf,
      },
      // Configure body for the request/server under test.
      body: "{}",
    });
    // body: synchronize actors so the race window is observable.
    const body = await res.json().catch(() => null);
    // Session/CSRF step exercising auth lifecycle.
    let next: CookieJar | null = null;
    // Try path where partial failure must not leak suite state.
    try {
      // Session/CSRF step exercising auth lifecycle.
      next = parseCookies(res);
    // Execute the next setup or assertion step for this scenario.
    } catch {
      // Execute the next setup or assertion step for this scenario.
      next = null;
    }
    // Return the arranged value/result to the caller.
    return { status: res.status, jar: next, body };
  }

  // Local helper meStatus used by cases in this file.
  async function meStatus(accessToken: string): Promise<number> {
    // res: HTTP response captured for status/body checks.
    const res = await fetch(`${api}/auth/me`, {
      // Configure headers for the request/server under test.
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // Return the arranged value/result to the caller.
    return res.status;
  }

  // Local helper cleanupUser used by cases in this file.
  async function cleanupUser() {
    // Await async work before asserting or releasing locks.
    await prisma.authSession.deleteMany({ where: { userId } });
    // Await async work before asserting or releasing locks.
    await prisma.device.deleteMany({ where: { userId } });
    // Await async work before asserting or releasing locks.
    await prisma.user.deleteMany({ where: { id: userId } });
    // Await async work before asserting or releasing locks.
    await prisma.employee.deleteMany({ where: { id: employeeId } });
  }

  // Case checks authz/session policy: sequential: logout then refresh does not leave a live replacement.
  it("sequential: logout then refresh does not leave a live replacement", async () => {
    // jar: session cookie jar for authenticated requests.
    const jar = await loginJar();
    // logout: HTTP response captured for status/body checks.
    const logout = await postAuth("/auth/logout", jar);
    // Assert HTTP status matches the contract for this path.
    assert.equal(logout.status, 200);
    // refresh: HTTP response captured for status/body checks.
    const refresh = await postAuth("/auth/refresh", jar);
    // Assert HTTP status matches the contract for this path.
    assert.equal(refresh.status, 401);
    // Assert the observed value matches the intended post-condition.
    assert.equal(await meStatus(jar.session), 401);
    // active: synchronize actors so the race window is observable.
    const active = await prisma.authSession.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { userId, revokedAt: null },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(active, 0);
    // Await async work before asserting or releasing locks.
    await cleanupUser();
  });

  // Case: other device session remains valid while this session is logged out.
  it("other device session remains valid while this session is logged out", async () => {
    // a: synchronize actors so the race window is observable.
    const a = await loginJar();
    // b: synchronize actors so the race window is observable.
    const b = await loginJar();
    // Assert the observed value matches the intended post-condition.
    assert.equal(await meStatus(a.session), 200);
    // Assert the observed value matches the intended post-condition.
    assert.equal(await meStatus(b.session), 200);
    // logout: HTTP response captured for status/body checks.
    const logout = await postAuth("/auth/logout", a);
    // Assert HTTP status matches the contract for this path.
    assert.equal(logout.status, 200);
    // Assert the observed value matches the intended post-condition.
    assert.equal(await meStatus(a.session), 401);
    // Assert the observed value matches the intended post-condition.
    assert.equal(await meStatus(b.session), 200);
    // Await async work before asserting or releasing locks.
    await cleanupUser();
  });

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let rep = 1; rep <= REPS; rep++) {
    // Case checks authz/session policy: refresh wins then logout must kill replacement (rep ${rep}).
    it(`refresh wins then logout must kill replacement (rep ${rep})`, async () => {
      // jar: session cookie jar for authenticated requests.
      const jar = await loginJar();
      // Bind originalHash for later setup or assertions in this scope.
      const originalHash = hashRefreshToken(jar.refresh);

      // settled: synchronize actors so the race window is observable.
      const settled = await orderedDatabaseRace(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Concurrency/isolation step for the race under test.
        (tx) => lockUsersForLiveAccess(tx, [userId]),
        // Session/CSRF step exercising auth lifecycle.
        () => postAuth("/auth/refresh", jar),
        // Session/CSRF step exercising auth lifecycle.
        () => postAuth("/auth/logout", jar),
      );

      // Bind refreshResult for later setup or assertions in this scope.
      const refreshResult = settled[0]!;
      // Bind logoutResult for later setup or assertions in this scope.
      const logoutResult = settled[1]!;
      // Assert HTTP status matches the contract for this path.
      assert.equal(refreshResult.status, "fulfilled");
      // Assert HTTP status matches the contract for this path.
      assert.equal(logoutResult.status, "fulfilled");
      // Bind refresh for later setup or assertions in this scope.
      const refresh = refreshResult.value as Awaited<ReturnType<typeof postAuth>>;
      // Bind logout for later setup or assertions in this scope.
      const logout = logoutResult.value as Awaited<ReturnType<typeof postAuth>>;
      // Assert HTTP status matches the contract for this path.
      assert.equal(refresh.status, 200, JSON.stringify(refresh.body));
      // Assert HTTP status matches the contract for this path.
      assert.equal(logout.status, 200, JSON.stringify(logout.body));
      // Assert the observed value matches the intended post-condition.
      assert.ok(refresh.jar, "refresh must issue replacement cookies");

      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Await async work before asserting or releasing locks.
        await meStatus(refresh.jar!.session),
        // Execute the next setup or assertion step for this scenario.
        401,
        // Session/CSRF step exercising auth lifecycle.
        "replacement access must be revoked after logout",
      );
      // Assert the observed value matches the intended post-condition.
      assert.equal(await meStatus(jar.session), 401);

      // replay: HTTP response captured for status/body checks.
      const replay = await postAuth("/auth/refresh", refresh.jar!);
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Delivery/replay step for async notification paths.
        replay.status,
        // Execute the next setup or assertion step for this scenario.
        401,
        // Session/CSRF step exercising auth lifecycle.
        "replacement refresh must not mint another session after logout",
      );

      // active: synchronize actors so the race window is observable.
      const active = await prisma.authSession.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { userId, revokedAt: null },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(active, 0, "no live sessions after logout of rotated chain");

      // original: synchronize actors so the race window is observable.
      const original = await prisma.authSession.findUnique({
        // SQL fragment used to observe locks or assert DB state.
        where: { refreshTokenHash: originalHash },
      });
      // Assert the observed value matches the intended post-condition.
      assert.ok(original?.revokedAt);
      // Await async work before asserting or releasing locks.
      await cleanupUser();
    });
  }

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let rep = 1; rep <= REPS; rep++) {
    // Case checks authz/session policy: logout wins then refresh must not leave a live replacement (rep ${rep}).
    it(`logout wins then refresh must not leave a live replacement (rep ${rep})`, async () => {
      // jar: session cookie jar for authenticated requests.
      const jar = await loginJar();

      // settled: synchronize actors so the race window is observable.
      const settled = await orderedDatabaseRace(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Concurrency/isolation step for the race under test.
        (tx) => lockUsersForLiveAccess(tx, [userId]),
        // Session/CSRF step exercising auth lifecycle.
        () => postAuth("/auth/logout", jar),
        // Session/CSRF step exercising auth lifecycle.
        () => postAuth("/auth/refresh", jar),
      );

      // Bind logoutResult for later setup or assertions in this scope.
      const logoutResult = settled[0]!;
      // Bind refreshResult for later setup or assertions in this scope.
      const refreshResult = settled[1]!;
      // Assert HTTP status matches the contract for this path.
      assert.equal(logoutResult.status, "fulfilled");
      // Assert HTTP status matches the contract for this path.
      assert.equal(refreshResult.status, "fulfilled");
      // Bind logout for later setup or assertions in this scope.
      const logout = logoutResult.value as Awaited<ReturnType<typeof postAuth>>;
      // Bind refresh for later setup or assertions in this scope.
      const refresh = refreshResult.value as Awaited<ReturnType<typeof postAuth>>;
      // Assert HTTP status matches the contract for this path.
      assert.equal(logout.status, 200);

      // Guard optional cleanup or alternate assertion paths.
      if (refresh.status === 200 && refresh.jar) {
        // Assert the observed value matches the intended post-condition.
        assert.equal(
          // Await async work before asserting or releasing locks.
          await meStatus(refresh.jar.session),
          // Execute the next setup or assertion step for this scenario.
          401,
          // Session/CSRF step exercising auth lifecycle.
          "refresh after logout must not yield usable access",
        );
      // Execute the next setup or assertion step for this scenario.
      } else {
        // Assert HTTP status matches the contract for this path.
        assert.equal(refresh.status, 401);
      }

      // active: synchronize actors so the race window is observable.
      const active = await prisma.authSession.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { userId, revokedAt: null },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(active, 0);
      // Await async work before asserting or releasing locks.
      await cleanupUser();
    });
  }

  // Case checks idempotent replay safety: idempotent second logout stays ok.
  it("idempotent second logout stays ok", async () => {
    // jar: session cookie jar for authenticated requests.
    const jar = await loginJar();
    // Assert HTTP status matches the contract for this path.
    assert.equal((await postAuth("/auth/logout", jar)).status, 200);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await postAuth("/auth/logout", jar)).status, 200);
    // Await async work before asserting or releasing locks.
    await cleanupUser();
  });
});
