/**
 * deterministic SSE live-authorization races against PostgreSQL locks.
 * Sleeps only poll for observed waiters; elapsed time never decides winners.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, afterEach, before, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { Prisma, Role } from "@prisma/client";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Import bindings from ../../src/errors.
import { AppError } from "../../src/errors";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupScopeSmokeFixture,
  // Execute the next setup or assertion step for this scenario.
  createScopeSmokeFixture,
  // Shape ScopeSmokeFixture documents the fixture/response fields this suite touches.
  type ScopeSmokeFixture,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../fixtures";
// Shared test fixtures for seeding users, locations, and domain entities.
import { runWhileRowLocked } from "../cleaning/fixtures";
// HTTP harness to listen an in-process API for request-level tests.
import { listenApp, closeServer } from "../httpHarness";
// Import bindings from ../../src/events/bus.
import { publish } from "../../src/events/bus";
// Import module bindings used by this suite.
import {
  // Session/CSRF step exercising auth lifecycle.
  createSession,
  // Session/CSRF step exercising auth lifecycle.
  revokeSession,
// Session/CSRF step exercising auth lifecycle.
} from "../../src/services/authSessions";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  authorizeLiveDelivery,
  // Execute the next setup or assertion step for this scenario.
  resetLiveAuthorizationTestHooks,
  // Execute the next setup or assertion step for this scenario.
  setLiveAuthorizationTestHooks,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/liveAuthorization";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  setSectorLocationsAtHead,
  // Execute the next setup or assertion step for this scenario.
  updateSectorAtHead,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../sectors/fixtures";
// Import bindings from ../../src/services/roleGrants.
import { ensureDefaultRoleGrants } from "../../src/services/roleGrants";
// Type-only import from ../../src/middleware/auth for compile-time contracts.
import type { AuthUser } from "../../src/middleware/auth";
// Type-only import from ../../src/events/bus for compile-time contracts.
import type { LiveEvent } from "../../src/events/bus";
// Type-only import from @prisma/client for compile-time contracts.
import type { Prisma as PrismaTypes } from "@prisma/client";

// Execute the next setup or assertion step for this scenario.
let fx: ScopeSmokeFixture;
// Execute the next setup or assertion step for this scenario.
let api: string;
// Execute the next setup or assertion step for this scenario.
let server: Awaited<ReturnType<typeof listenApp>>["server"];

// Local helper until used by cases in this file.
async function until(check: () => boolean, reason: string) {
  // Bind end for later setup or assertions in this scope.
  const end = Date.now() + 8_000;
  // Iterate to cover variants or wait until a condition holds.
  while (!check()) {
    // Assert the observed value matches the intended post-condition.
    assert.ok(Date.now() < end, reason);
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 5));
  }
}

// Helper authUserFrom: auth/session setup for the scenario.
function authUserFrom(
  // Session/CSRF step exercising auth lifecycle.
  tokens: { sessionId: string },
  // Execute the next setup or assertion step for this scenario.
  user: {
    // Execute the next setup or assertion step for this scenario.
    userId: string;
    // Execute the next setup or assertion step for this scenario.
    employeeId: string;
    // Fixture field email for the seeded actor/entity.
    email: string;
    // Fixture field role for the seeded actor/entity.
    role: Role;
  },
// Execute the next setup or assertion step for this scenario.
): AuthUser {
  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    userId: user.userId,
    // Execute the next setup or assertion step for this scenario.
    employeeId: user.employeeId,
    // Fixture field role for the seeded actor/entity.
    role: user.role,
    // Fixture field email for the seeded actor/entity.
    email: user.email,
    // Session/CSRF step exercising auth lifecycle.
    sid: tokens.sessionId,
  };
}

/** Swap A/B primary supervisors inside an already-locked writer transaction. */
async function swapSupervisorsInTx(tx: PrismaTypes.TransactionClient) {
  // Await async work before asserting or releasing locks.
  await tx.sector.update({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: fx.sectorAId },
    // Execute the next setup or assertion step for this scenario.
    data: { primarySupervisorEmployeeId: fx.supervisorB.employeeId },
  });
  // Await async work before asserting or releasing locks.
  await tx.sector.update({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: fx.sectorBId },
    // Execute the next setup or assertion step for this scenario.
    data: { primarySupervisorEmployeeId: fx.supervisorA.employeeId },
  });
}

// Local helper restoreSupervisors used by cases in this file.
async function restoreSupervisors() {
  // Await async work before asserting or releasing locks.
  await updateSectorAtHead(prisma, fx.sectorAId, {
    // Execute the next setup or assertion step for this scenario.
    primarySupervisorEmployeeId: fx.supervisorA.employeeId,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId: fx.manager.employeeId,
  });
  // Await async work before asserting or releasing locks.
  await updateSectorAtHead(prisma, fx.sectorBId, {
    // Execute the next setup or assertion step for this scenario.
    primarySupervisorEmployeeId: fx.supervisorB.employeeId,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId: fx.manager.employeeId,
  });
}

// Arrange shared preconditions before cases run.
before(async () => {
  // Refuse to mutate unless connected to the isolated test database.
  await assertTestDatabase(prisma);
  // Override env for isolation, rate-limit disable, or scheduler quieting.
  process.env.E2E_DISABLE_RATE_LIMIT = "1";
  // Await async work before asserting or releasing locks.
  await ensureDefaultRoleGrants();
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  fx = await createScopeSmokeFixture(prisma);
  // Start or stop the in-process API server for this suite.
  ({ api, server } = await listenApp());
});

// Release servers/DB clients so later suites stay isolated.
afterEach(async () => {
  // Execute the next setup or assertion step for this scenario.
  resetLiveAuthorizationTestHooks();
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (fx) {
    // Await async work before asserting or releasing locks.
    await prisma.sector.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: fx.sectorAId },
      // Execute the next setup or assertion step for this scenario.
      data: { primarySupervisorEmployeeId: fx.supervisorA.employeeId },
    });
    // Await async work before asserting or releasing locks.
    await prisma.sector.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: fx.sectorBId },
      // Execute the next setup or assertion step for this scenario.
      data: { primarySupervisorEmployeeId: fx.supervisorB.employeeId },
    });
    // Await async work before asserting or releasing locks.
    await prisma.user.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: fx.supervisorA.userId },
      // Execute the next setup or assertion step for this scenario.
      data: { role: Role.supervisor, isActive: true },
    });
    // Await async work before asserting or releasing locks.
    await prisma.sectorLocation.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { locationId: { in: [fx.locAId, fx.locBId] } },
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await prisma.sectorLocation.createMany({
      // Execute the next setup or assertion step for this scenario.
      data: [
        // Execute the next setup or assertion step for this scenario.
        { sectorId: fx.sectorAId, locationId: fx.locAId },
        // Execute the next setup or assertion step for this scenario.
        { sectorId: fx.sectorBId, locationId: fx.locBId },
      ],
    });
  }
});

// Release servers/DB clients so later suites stay isolated.
after(async () => {
  // Execute the next setup or assertion step for this scenario.
  resetLiveAuthorizationTestHooks();
  // Guard optional cleanup or alternate assertion paths.
  if (server) await closeServer(server);
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (fx) await cleanupScopeSmokeFixture(prisma, fx);
  // Disconnect Prisma so the pool does not leak across suites.
  await prisma.$disconnect();
});

// Suite: SSE authorization serialization.
describe("SSE authorization serialization", () => {
  // Case: 1+2: access change commits before delivery → event not delivered.
  it("1+2: access change commits before delivery → event not delivered", async () => {
    // tokens: credential/token material for auth flows.
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    // Bind user for later setup or assertions in this scope.
    const user = authUserFrom(tokens, fx.supervisorA);
    // Execute the next setup or assertion step for this scenario.
    const event: LiveEvent = {
      // Execute the next setup or assertion step for this scenario.
      type: "location.changed",
      // Execute the next setup or assertion step for this scenario.
      locationId: fx.locAId,
      // Execute the next setup or assertion step for this scenario.
      at: new Date().toISOString(),
    };
    // Bind delivered for later setup or assertions in this scope.
    let delivered = false;

    // Holder locks both supervisors and stages the scope flip; delivery waits
    // on FOR SHARE until that writer commits.
    const result = await runWhileRowLocked({
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Concurrency/isolation step for the race under test.
      acquireLock: async (tx) => {
        // Await async work before asserting or releasing locks.
        await tx.$executeRaw`
          SELECT id FROM "User"
          WHERE id IN (${Prisma.join([fx.supervisorA.userId, fx.supervisorB.userId])})
          ORDER BY id FOR UPDATE
        `;
        // Await async work before asserting or releasing locks.
        await swapSupervisorsInTx(tx);
      },
      // Concurrency/isolation step for the race under test.
      startRace: () =>
        // Execute the next setup or assertion step for this scenario.
        authorizeLiveDelivery(user, event, () => {
          // Execute the next setup or assertion step for this scenario.
          delivered = true;
        }),
      // Concurrency/isolation step for the race under test.
      whileBlocked: async () => undefined,
    });

    // Assert the observed value matches the intended post-condition.
    assert.equal(result.delivered, false);
    // Assert the observed value matches the intended post-condition.
    assert.equal(delivered, false);
    // Await async work before asserting or releasing locks.
    await restoreSupervisors();
  });

  // Case: 3: delivery linearized before sector revoke → frame written, then scope flips.
  it("3: delivery linearized before sector revoke → frame written, then scope flips", async () => {
    // tokens: credential/token material for auth flows.
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    // Bind user for later setup or assertions in this scope.
    const user = authUserFrom(tokens, fx.supervisorA);
    // Execute the next setup or assertion step for this scenario.
    const event: LiveEvent = {
      // Execute the next setup or assertion step for this scenario.
      type: "location.changed",
      // Execute the next setup or assertion step for this scenario.
      locationId: fx.locAId,
      // Execute the next setup or assertion step for this scenario.
      at: new Date().toISOString(),
    };
    // Bind delivered for later setup or assertions in this scope.
    let delivered = false;
    // Execute the next setup or assertion step for this scenario.
    let releaseHook!: () => void;
    // Execute the next setup or assertion step for this scenario.
    let enteredHook!: () => void;
    // Bind inHook for later setup or assertions in this scope.
    const inHook = new Promise<void>((resolve) => {
      // Execute the next setup or assertion step for this scenario.
      enteredHook = resolve;
    });
    // Bind gate for later setup or assertions in this scope.
    const gate = new Promise<void>((resolve) => {
      // Execute the next setup or assertion step for this scenario.
      releaseHook = resolve;
    });

    // Execute the next setup or assertion step for this scenario.
    setLiveAuthorizationTestHooks({
      // Execute the next setup or assertion step for this scenario.
      afterScopeResolved: async () => {
        // Execute the next setup or assertion step for this scenario.
        enteredHook();
        // Await async work before asserting or releasing locks.
        await gate;
      },
    });

    // Bind delivery for later setup or assertions in this scope.
    const delivery = authorizeLiveDelivery(user, event, () => {
      // Execute the next setup or assertion step for this scenario.
      delivered = true;
    });
    // Await async work before asserting or releasing locks.
    await inHook;

    // Delivery holds User FOR SHARE. Writer must wait — prove via lock waiters.
    const writer = updateSectorAtHead(prisma, fx.sectorAId, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: fx.supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: fx.manager.employeeId,
    });
    // Fire-and-await side effect required before the next assertion.
    void writer.catch(() => undefined);

    // deadline: bound how long the wait/poll may run.
    const deadline = Date.now() + 8_000;
    // writerWaiting: repetition count to amplify race windows.
    let writerWaiting = false;
    // Repeat/poll to widen the race window or wait for lock waiters.
    while (Date.now() < deadline) {
      // Await async work before asserting or releasing locks.
      const [row] = await prisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND pid <> pg_backend_pid()
      `;
      // Conditional path for setup, cleanup, or alternate outcomes.
      if ((row?.count ?? 0) >= 1) {
        // Execute the next setup or assertion step for this scenario.
        writerWaiting = true;
        // Execute the next setup or assertion step for this scenario.
        break;
      }
      // Brief yield so lock waiters/UI can settle before asserting.
      await new Promise((r) => setTimeout(r, 10));
    }
    // Assert the observed value matches the intended post-condition.
    assert.equal(writerWaiting, true, "sector writer must wait on User FOR SHARE");

    // Execute the next setup or assertion step for this scenario.
    releaseHook();
    // result: synchronize actors so the race window is observable.
    const result = await delivery;
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.delivered, true);
    // Assert the observed value matches the intended post-condition.
    assert.equal(delivered, true);
    // Await async work before asserting or releasing locks.
    await writer;

    // Bind second for later setup or assertions in this scope.
    let second = false;
    // refused: synchronize actors so the race window is observable.
    const refused = await authorizeLiveDelivery(user, event, () => {
      // Execute the next setup or assertion step for this scenario.
      second = true;
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(refused.delivered, false);
    // Assert the observed value matches the intended post-condition.
    assert.equal(second, false);

    // Await async work before asserting or releasing locks.
    await restoreSupervisors();
  });

  // Case checks authz/session policy: 4: logout/revoke during event processing → no delivery + stream closes.
  it("4: logout/revoke during event processing → no delivery + stream closes", async () => {
    // tokens: credential/token material for auth flows.
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    // Bind user for later setup or assertions in this scope.
    const user = authUserFrom(tokens, fx.supervisorA);
    // Execute the next setup or assertion step for this scenario.
    const event: LiveEvent = {
      // Execute the next setup or assertion step for this scenario.
      type: "people.changed",
      // Execute the next setup or assertion step for this scenario.
      at: new Date().toISOString(),
    };
    // Bind delivered for later setup or assertions in this scope.
    let delivered = false;

    // Revoke staged under User FOR UPDATE; delivery blocks on FOR SHARE.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Concurrency/isolation step for the race under test.
        runWhileRowLocked({
          // Execute the next setup or assertion step for this scenario.
          prisma,
          // Concurrency/isolation step for the race under test.
          acquireLock: async (tx) => {
            // Await async work before asserting or releasing locks.
            await tx.$executeRaw`
              SELECT id FROM "User" WHERE id = ${fx.supervisorA.userId} FOR UPDATE
            `;
            // Await async work before asserting or releasing locks.
            await tx.authSession.updateMany({
              // SQL fragment used to observe locks or assert DB state.
              where: { id: tokens.sessionId, revokedAt: null },
              // Execute the next setup or assertion step for this scenario.
              data: { revokedAt: new Date() },
            });
          },
          // Concurrency/isolation step for the race under test.
          startRace: () =>
            // Execute the next setup or assertion step for this scenario.
            authorizeLiveDelivery(user, event, () => {
              // Execute the next setup or assertion step for this scenario.
              delivered = true;
            }),
          // Concurrency/isolation step for the race under test.
          whileBlocked: async () => undefined,
        }),
      // Session/CSRF step exercising auth lifecycle.
      /Session revoked|unauthorized/i,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(delivered, false);

    // Open stream with a fresh session, then revoke via the production path.
    const live = await createSession({ userId: fx.supervisorA.userId });
    // Bind controller for later setup or assertions in this scope.
    const controller = new AbortController();
    // response: HTTP response captured for status/body checks.
    const response = await fetch(`${api}/events/stream`, {
      // Configure headers for the request/server under test.
      headers: { Authorization: `Bearer ${live.accessToken}` },
      // Execute the next setup or assertion step for this scenario.
      signal: controller.signal,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(response.status, 200);
    // Bind text for later setup or assertions in this scope.
    let text = "";
    // Bind closed for later setup or assertions in this scope.
    let closed = false;
    // Bind reader for later setup or assertions in this scope.
    const reader = response.body!.getReader();
    // Bind pump for later setup or assertions in this scope.
    const pump = (async () => {
      // Try path where partial failure must not leak suite state.
      try {
        // Iterate to cover variants or wait until a condition holds.
        while (true) {
          // result: synchronize actors so the race window is observable.
          const result = await reader.read();
          // Conditional path for setup, cleanup, or alternate outcomes.
          if (result.done) break;
          // Execute the next setup or assertion step for this scenario.
          text += new TextDecoder().decode(result.value, { stream: true });
        }
      // Execute the next setup or assertion step for this scenario.
      } catch (err) {
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (!controller.signal.aborted) throw err;
      // Execute the next setup or assertion step for this scenario.
      } finally {
        // Execute the next setup or assertion step for this scenario.
        closed = true;
        // Concurrency/isolation step for the race under test.
        reader.releaseLock();
      }
    })();

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await until(() => text.includes("event: connected"), "connected");
      // Bind before for later setup or assertions in this scope.
      const before = text.length;
      // Await async work before asserting or releasing locks.
      await revokeSession(live.sessionId);
      // Execute the next setup or assertion step for this scenario.
      publish("people.changed");
      // Await async work before asserting or releasing locks.
      await until(() => closed, "stream must close after revokeSession");
      // Assert the observed value matches the intended post-condition.
      assert.match(text, /event: revoked/);
      // Assert the observed value matches the intended post-condition.
      assert.equal(text.slice(before).includes("event: people.changed"), false);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Execute the next setup or assertion step for this scenario.
      controller.abort();
      // Await async work before asserting or releasing locks.
      await pump;
    }
  });

  // Case: 5: session expiry during processing → no delivery.
  it("5: session expiry during processing → no delivery", async () => {
    // tokens: credential/token material for auth flows.
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    // Bind user for later setup or assertions in this scope.
    const user = authUserFrom(tokens, fx.supervisorA);
    // Execute the next setup or assertion step for this scenario.
    const event: LiveEvent = {
      // Execute the next setup or assertion step for this scenario.
      type: "people.changed",
      // Execute the next setup or assertion step for this scenario.
      at: new Date().toISOString(),
    };
    // Bind delivered for later setup or assertions in this scope.
    let delivered = false;

    // Await async work before asserting or releasing locks.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Concurrency/isolation step for the race under test.
        runWhileRowLocked({
          // Execute the next setup or assertion step for this scenario.
          prisma,
          // Concurrency/isolation step for the race under test.
          acquireLock: async (tx) => {
            // Await async work before asserting or releasing locks.
            await tx.$executeRaw`
              SELECT id FROM "User" WHERE id = ${fx.supervisorA.userId} FOR UPDATE
            `;
            // Await async work before asserting or releasing locks.
            await tx.authSession.update({
              // SQL fragment used to observe locks or assert DB state.
              where: { id: tokens.sessionId },
              // Execute the next setup or assertion step for this scenario.
              data: { expiresAt: new Date(Date.now() - 1) },
            });
          },
          // Concurrency/isolation step for the race under test.
          startRace: () =>
            // Execute the next setup or assertion step for this scenario.
            authorizeLiveDelivery(user, event, () => {
              // Execute the next setup or assertion step for this scenario.
              delivered = true;
            }),
          // Concurrency/isolation step for the race under test.
          whileBlocked: async () => undefined,
        }),
      // Session/CSRF step exercising auth lifecycle.
      /Session expired|unauthorized/i,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(delivered, false);
  });

  // Case probes concurrency/isolation: 6: concurrent events + sector change — only in-scope deliveries.
  it("6: concurrent events + sector change — only in-scope deliveries", async () => {
    // tokens: credential/token material for auth flows.
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    // Bind user for later setup or assertions in this scope.
    const user = authUserFrom(tokens, fx.supervisorA);
    // Execute the next setup or assertion step for this scenario.
    const seen: string[] = [];

    // results: synchronize actors so the race window is observable.
    const results = await runWhileRowLocked({
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Concurrency/isolation step for the race under test.
      acquireLock: async (tx) => {
        // Await async work before asserting or releasing locks.
        await tx.$executeRaw`
          SELECT id FROM "User"
          WHERE id IN (${Prisma.join([fx.supervisorA.userId, fx.supervisorB.userId])})
          ORDER BY id FOR UPDATE
        `;
        // Await async work before asserting or releasing locks.
        await swapSupervisorsInTx(tx);
      },
      // Concurrency/isolation step for the race under test.
      startRace: async () => {
        // Run actors together to expose races and serialization bugs.
        const [ra, rb] = await Promise.all([
          // Execute the next setup or assertion step for this scenario.
          authorizeLiveDelivery(
            // Execute the next setup or assertion step for this scenario.
            user,
            {
              // Execute the next setup or assertion step for this scenario.
              type: "location.changed",
              // Execute the next setup or assertion step for this scenario.
              locationId: fx.locAId,
              // Execute the next setup or assertion step for this scenario.
              at: new Date().toISOString(),
            },
            // Execute the next setup or assertion step for this scenario.
            (e) => seen.push(e.locationId ?? "a"),
          ),
          // Execute the next setup or assertion step for this scenario.
          authorizeLiveDelivery(
            // Execute the next setup or assertion step for this scenario.
            user,
            {
              // Execute the next setup or assertion step for this scenario.
              type: "location.changed",
              // Execute the next setup or assertion step for this scenario.
              locationId: fx.locBId,
              // Execute the next setup or assertion step for this scenario.
              at: new Date().toISOString(),
            },
            // Execute the next setup or assertion step for this scenario.
            (e) => seen.push(e.locationId ?? "b"),
          ),
        ]);
        // Return the arranged value/result to the caller.
        return { ra, rb };
      },
      // Concurrency/isolation step for the race under test.
      whileBlocked: async () => undefined,
    });

    // Assert the observed value matches the intended post-condition.
    assert.equal(results.ra.delivered, false);
    // Assert the observed value matches the intended post-condition.
    assert.equal(results.rb.delivered, true);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(seen, [fx.locBId]);
  });

  // Case: 7: role change without client reconnect closes stream before further frames.
  it("7: role change without client reconnect closes stream before further frames", async () => {
    // tokens: credential/token material for auth flows.
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    // Bind controller for later setup or assertions in this scope.
    const controller = new AbortController();
    // response: HTTP response captured for status/body checks.
    const response = await fetch(`${api}/events/stream`, {
      // Configure headers for the request/server under test.
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      // Execute the next setup or assertion step for this scenario.
      signal: controller.signal,
    });
    // Bind text for later setup or assertions in this scope.
    let text = "";
    // Bind closed for later setup or assertions in this scope.
    let closed = false;
    // Bind reader for later setup or assertions in this scope.
    const reader = response.body!.getReader();
    // Bind pump for later setup or assertions in this scope.
    const pump = (async () => {
      // Try path where partial failure must not leak suite state.
      try {
        // Iterate to cover variants or wait until a condition holds.
        while (true) {
          // result: synchronize actors so the race window is observable.
          const result = await reader.read();
          // Conditional path for setup, cleanup, or alternate outcomes.
          if (result.done) break;
          // Execute the next setup or assertion step for this scenario.
          text += new TextDecoder().decode(result.value, { stream: true });
        }
      // Execute the next setup or assertion step for this scenario.
      } catch (err) {
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (!controller.signal.aborted) throw err;
      // Execute the next setup or assertion step for this scenario.
      } finally {
        // Execute the next setup or assertion step for this scenario.
        closed = true;
        // Concurrency/isolation step for the race under test.
        reader.releaseLock();
      }
    })();

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await until(() => text.includes("event: connected"), "connected");
      // Bind before for later setup or assertions in this scope.
      const before = text.length;
      // login: seeded entity required before the mutation under test.
      const login = await createSession({ userId: fx.manager.userId });
      // roleRes: HTTP response captured for status/body checks.
      const roleRes = await fetch(
        // Execute the next setup or assertion step for this scenario.
        `${api}/people/${fx.supervisorA.userId}/role`,
        {
          // Configure method for the request/server under test.
          method: "PATCH",
          // Configure headers for the request/server under test.
          headers: {
            // Session/CSRF step exercising auth lifecycle.
            Authorization: `Bearer ${login.accessToken}`,
            // Execute the next setup or assertion step for this scenario.
            "Content-Type": "application/json",
          },
          // Configure body for the request/server under test.
          body: JSON.stringify({ role: Role.housekeeper }),
        },
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(roleRes.status, 200);
      // Execute the next setup or assertion step for this scenario.
      publish("people.changed");
      // Execute the next setup or assertion step for this scenario.
      publish("location.changed", { locationId: fx.locAId });
      // Await async work before asserting or releasing locks.
      await until(() => closed, "role change must revoke open SSE");
      // Assert the observed value matches the intended post-condition.
      assert.match(text, /event: revoked/);
      // Assert the observed value matches the intended post-condition.
      assert.equal(text.slice(before).includes("event: people.changed"), false);
      // Assert the observed value matches the intended post-condition.
      assert.equal(text.slice(before).includes(fx.locAId), false);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Execute the next setup or assertion step for this scenario.
      controller.abort();
      // Await async work before asserting or releasing locks.
      await pump;
      // Await async work before asserting or releasing locks.
      await prisma.user.update({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: fx.supervisorA.userId },
        // Execute the next setup or assertion step for this scenario.
        data: { role: Role.supervisor },
      });
    }
  });

  // Case: 8: valid subscriber keeps receiving in-scope events.
  it("8: valid subscriber keeps receiving in-scope events", async () => {
    // tokens: credential/token material for auth flows.
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    // Bind controller for later setup or assertions in this scope.
    const controller = new AbortController();
    // response: HTTP response captured for status/body checks.
    const response = await fetch(`${api}/events/stream`, {
      // Configure headers for the request/server under test.
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      // Execute the next setup or assertion step for this scenario.
      signal: controller.signal,
    });
    // Bind text for later setup or assertions in this scope.
    let text = "";
    // Bind reader for later setup or assertions in this scope.
    const reader = response.body!.getReader();
    // Bind pump for later setup or assertions in this scope.
    const pump = (async () => {
      // Try path where partial failure must not leak suite state.
      try {
        // Iterate to cover variants or wait until a condition holds.
        while (true) {
          // result: synchronize actors so the race window is observable.
          const result = await reader.read();
          // Conditional path for setup, cleanup, or alternate outcomes.
          if (result.done) break;
          // Execute the next setup or assertion step for this scenario.
          text += new TextDecoder().decode(result.value, { stream: true });
        }
      // Execute the next setup or assertion step for this scenario.
      } catch (err) {
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (!controller.signal.aborted) throw err;
      // Execute the next setup or assertion step for this scenario.
      } finally {
        // Concurrency/isolation step for the race under test.
        reader.releaseLock();
      }
    })();

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await until(() => text.includes("event: connected"), "connected");
      // Execute the next setup or assertion step for this scenario.
      publish("location.changed", { locationId: fx.locBId });
      // Execute the next setup or assertion step for this scenario.
      publish("location.changed", { locationId: fx.locAId });
      // Await async work before asserting or releasing locks.
      await until(() => text.includes(fx.locAId), "in-scope event");
      // Assert the observed value matches the intended post-condition.
      assert.equal(text.includes(fx.locBId), false);
      // mid: unique stamp so parallel runs do not collide.
      const mid = text.length;
      // Execute the next setup or assertion step for this scenario.
      publish("settings.changed");
      // Await async work before asserting or releasing locks.
      await until(
        // Execute the next setup or assertion step for this scenario.
        () => text.slice(mid).includes("event: settings.changed"),
        // Execute the next setup or assertion step for this scenario.
        "global invalidate still delivered",
      );
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Execute the next setup or assertion step for this scenario.
      controller.abort();
      // Await async work before asserting or releasing locks.
      await pump;
    }
  });

  // Case: 9: no deliveries after stream termination.
  it("9: no deliveries after stream termination", async () => {
    // tokens: credential/token material for auth flows.
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    // Bind controller for later setup or assertions in this scope.
    const controller = new AbortController();
    // response: HTTP response captured for status/body checks.
    const response = await fetch(`${api}/events/stream`, {
      // Configure headers for the request/server under test.
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      // Execute the next setup or assertion step for this scenario.
      signal: controller.signal,
    });
    // Bind text for later setup or assertions in this scope.
    let text = "";
    // Bind closed for later setup or assertions in this scope.
    let closed = false;
    // Bind reader for later setup or assertions in this scope.
    const reader = response.body!.getReader();
    // Bind pump for later setup or assertions in this scope.
    const pump = (async () => {
      // Try path where partial failure must not leak suite state.
      try {
        // Iterate to cover variants or wait until a condition holds.
        while (true) {
          // result: synchronize actors so the race window is observable.
          const result = await reader.read();
          // Conditional path for setup, cleanup, or alternate outcomes.
          if (result.done) break;
          // Execute the next setup or assertion step for this scenario.
          text += new TextDecoder().decode(result.value, { stream: true });
        }
      // Execute the next setup or assertion step for this scenario.
      } catch (err) {
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (!controller.signal.aborted) throw err;
      // Execute the next setup or assertion step for this scenario.
      } finally {
        // Execute the next setup or assertion step for this scenario.
        closed = true;
        // Concurrency/isolation step for the race under test.
        reader.releaseLock();
      }
    })();

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await until(() => text.includes("event: connected"), "connected");
      // Await async work before asserting or releasing locks.
      await revokeSession(tokens.sessionId);
      // Execute the next setup or assertion step for this scenario.
      publish("people.changed");
      // Await async work before asserting or releasing locks.
      await until(() => closed, "EOF after revoke");
      // Bind end for later setup or assertions in this scope.
      const end = text.length;
      // Execute the next setup or assertion step for this scenario.
      publish("location.changed", { locationId: fx.locAId });
      // Execute the next setup or assertion step for this scenario.
      publish("people.changed");
      // Brief settle only to catch late writes; length must stay fixed.
      await new Promise((r) => setTimeout(r, 50));
      // Assert collection size matches the expected post-condition.
      assert.equal(text.length, end);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Execute the next setup or assertion step for this scenario.
      controller.abort();
      // Await async work before asserting or releasing locks.
      await pump;
    }
  });

  // Case probes concurrency/isolation: 10: no deadlock — delivery, updateSector, and setSectorLocations complete.
  it("10: no deadlock — delivery, updateSector, and setSectorLocations complete", async () => {
    // tokens: credential/token material for auth flows.
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    // Bind user for later setup or assertions in this scope.
    const user = authUserFrom(tokens, fx.supervisorA);
    // Execute the next setup or assertion step for this scenario.
    const event: LiveEvent = {
      // Execute the next setup or assertion step for this scenario.
      type: "location.changed",
      // Execute the next setup or assertion step for this scenario.
      locationId: fx.locAId,
      // Execute the next setup or assertion step for this scenario.
      at: new Date().toISOString(),
    };

    // Bind delivery for later setup or assertions in this scope.
    const delivery = authorizeLiveDelivery(user, event, () => undefined);
    // writer: repetition count to amplify race windows.
    const writer = updateSectorAtHead(prisma, fx.sectorAId, {
      // Execute the next setup or assertion step for this scenario.
      nameBg: `Sector A ${Date.now()}`,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: fx.manager.employeeId,
    });
    // Bind swap for later setup or assertions in this scope.
    const swap = updateSectorAtHead(prisma, fx.sectorAId, {
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: fx.supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: fx.manager.employeeId,
    });
    // Bind membership for later setup or assertions in this scope.
    const membership = setSectorLocationsAtHead(prisma, fx.sectorBId, [fx.locBId], {
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: fx.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      scope: {
        // Execute the next setup or assertion step for this scenario.
        kind: "all",
        // Execute the next setup or assertion step for this scenario.
        sectorIds: [],
        // Execute the next setup or assertion step for this scenario.
        employeeId: fx.manager.employeeId,
        // Fixture field role for the seeded actor/entity.
        role: Role.manager,
      },
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: true,
    });

    // settled: capture concurrent outcomes for race assertions.
    const settled = await Promise.allSettled([
      // Execute the next setup or assertion step for this scenario.
      delivery,
      // Execute the next setup or assertion step for this scenario.
      writer,
      // Execute the next setup or assertion step for this scenario.
      swap,
      // Execute the next setup or assertion step for this scenario.
      membership,
    ]);
    // Delivery + cross-sector membership must complete; concurrent same-sector
    // writers may lose expectedVersion CAS (409) but must not hang.
    assert.equal(settled[0]!.status, "fulfilled", "delivery");
    // Assert HTTP status matches the contract for this path.
    assert.equal(settled[3]!.status, "fulfilled", "membership");
    // Bind sectorWrites for later setup or assertions in this scope.
    const sectorWrites = [settled[1]!, settled[2]!];
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      sectorWrites.some((s) => s.status === "fulfilled"),
      // Execute the next setup or assertion step for this scenario.
      "at least one sectorA writer must succeed",
    );
    // Iterate to cover variants or wait until a condition holds.
    for (const s of sectorWrites) {
      // Guard optional cleanup or alternate assertion paths.
      if (s.status === "fulfilled") continue;
      // Bind err for later setup or assertions in this scope.
      const err = s.reason;
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        err instanceof AppError &&
          // Execute the next setup or assertion step for this scenario.
          err.status === 409 &&
          // Execute the next setup or assertion step for this scenario.
          err.code === "version_conflict",
        // Execute the next setup or assertion step for this scenario.
        `unexpected sector write failure: ${String(err)}`,
      );
    }

    // Restore membership + supervisors for fixture reuse.
    await setSectorLocationsAtHead(prisma, fx.sectorAId, [fx.locAId], {
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: fx.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      scope: {
        // Execute the next setup or assertion step for this scenario.
        kind: "all",
        // Execute the next setup or assertion step for this scenario.
        sectorIds: [],
        // Execute the next setup or assertion step for this scenario.
        employeeId: fx.manager.employeeId,
        // Fixture field role for the seeded actor/entity.
        role: Role.manager,
      },
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: true,
    });
    // Await async work before asserting or releasing locks.
    await setSectorLocationsAtHead(prisma, fx.sectorBId, [fx.locBId], {
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: fx.manager.employeeId,
      // Execute the next setup or assertion step for this scenario.
      scope: {
        // Execute the next setup or assertion step for this scenario.
        kind: "all",
        // Execute the next setup or assertion step for this scenario.
        sectorIds: [],
        // Execute the next setup or assertion step for this scenario.
        employeeId: fx.manager.employeeId,
        // Fixture field role for the seeded actor/entity.
        role: Role.manager,
      },
      // Delivery/replay step for async notification paths.
      allowCrossSectorTransfer: true,
    });
    // Await async work before asserting or releasing locks.
    await restoreSupervisors();
  });

  // Case: membership move commits before delivery → location event refused.
  it("membership move commits before delivery → location event refused", async () => {
    // tokens: credential/token material for auth flows.
    const tokens = await createSession({ userId: fx.supervisorA.userId });
    // Bind user for later setup or assertions in this scope.
    const user = authUserFrom(tokens, fx.supervisorA);
    // Execute the next setup or assertion step for this scenario.
    const event: LiveEvent = {
      // Execute the next setup or assertion step for this scenario.
      type: "location.changed",
      // Execute the next setup or assertion step for this scenario.
      locationId: fx.locAId,
      // Execute the next setup or assertion step for this scenario.
      at: new Date().toISOString(),
    };
    // Bind delivered for later setup or assertions in this scope.
    let delivered = false;

    // Membership writers take Sector FOR NO KEY UPDATE; SSE takes Sector FOR SHARE.
    const result = await runWhileRowLocked({
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Concurrency/isolation step for the race under test.
      acquireLock: async (tx) => {
        // Await async work before asserting or releasing locks.
        await tx.$executeRaw`
          SELECT id FROM "Sector"
          WHERE id IN (${Prisma.join([fx.sectorAId, fx.sectorBId])})
          ORDER BY id FOR NO KEY UPDATE
        `;
        // Await async work before asserting or releasing locks.
        await tx.sectorLocation.deleteMany({ where: { locationId: fx.locAId } });
        // Await async work before asserting or releasing locks.
        await tx.sectorLocation.create({
          // Execute the next setup or assertion step for this scenario.
          data: { sectorId: fx.sectorBId, locationId: fx.locAId },
        });
      },
      // Concurrency/isolation step for the race under test.
      startRace: () =>
        // Execute the next setup or assertion step for this scenario.
        authorizeLiveDelivery(user, event, () => {
          // Execute the next setup or assertion step for this scenario.
          delivered = true;
        }),
      // Concurrency/isolation step for the race under test.
      whileBlocked: async () => undefined,
    });

    // Assert the observed value matches the intended post-condition.
    assert.equal(result.delivered, false);
    // Assert the observed value matches the intended post-condition.
    assert.equal(delivered, false);
  });
});
