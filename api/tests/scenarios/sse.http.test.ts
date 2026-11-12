// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, it } from "node:test";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createScopeSmokeFixture, cleanupScopeSmokeFixture, type ScopeSmokeFixture } from "../fixtures";
// HTTP harness to listen an in-process API for request-level tests.
import { listenApp, closeServer } from "../httpHarness";
// Import bindings from ../../src/events/bus.
import { publish } from "../../src/events/bus";
// Import bindings from ../../src/services/authSessions.
import { createSession, revokeSession } from "../../src/services/authSessions";
// Shared test fixtures for seeding users, locations, and domain entities.
import { updateSectorAtHead } from "../sectors/fixtures";

// Execute the next setup or assertion step for this scenario.
let fx: ScopeSmokeFixture;
// Execute the next setup or assertion step for this scenario.
let api: string;
// Execute the next setup or assertion step for this scenario.
let server: Awaited<ReturnType<typeof listenApp>>["server"];

// Local helper until used by cases in this file.
async function until(check: () => boolean, reason: string) {
  // Bind end for later setup or assertions in this scope.
  const end = Date.now() + 5000;
  // Iterate to cover variants or wait until a condition holds.
  while (!check()) {
    // Assert the observed value matches the intended post-condition.
    assert.ok(Date.now() < end, reason);
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 5));
  }
}

// Arrange shared preconditions before cases run.
before(async () => {
  // Refuse to mutate unless connected to the isolated test database.
  await assertTestDatabase(prisma);
  // Override env for isolation, rate-limit disable, or scheduler quieting.
  process.env.E2E_DISABLE_RATE_LIMIT = "1";
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  fx = await createScopeSmokeFixture(prisma);
  // Start or stop the in-process API server for this suite.
  ({ api, server } = await listenApp());
});

// Release servers/DB clients so later suites stay isolated.
after(async () => {
  // Guard optional cleanup or alternate assertion paths.
  if (server) await closeServer(server);
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (fx) await cleanupScopeSmokeFixture(prisma, fx);
  // Disconnect Prisma so the pool does not leak across suites.
  await prisma.$disconnect();
});

// Case checks authz/session policy: real open SSE authorizes sector changes and revoke/expiry before delivery, without waiting for heartbeat.
it("real open SSE authorizes sector changes and revoke/expiry before delivery, without waiting for heartbeat", async (t) => {
  // Execute the next setup or assertion step for this scenario.
  t.mock.timers.enable({ apis: ["setInterval"] });
  // Execute the next setup or assertion step for this scenario.
  const controllers: AbortController[] = [];
  // Execute the next setup or assertion step for this scenario.
  const pumps: Promise<void>[] = [];
  // Try path where partial failure must not leak suite state.
  try {
    // Iterate to cover variants or wait until a condition holds.
    for (const invalidation of ["revoke", "expiry"] as const) {
      // tokens: credential/token material for auth flows.
      const tokens = await createSession({ userId: fx.supervisorA.userId });
      // Bind controller for later setup or assertions in this scope.
      const controller = new AbortController();
      // Execute the next setup or assertion step for this scenario.
      controllers.push(controller);
      // response: HTTP response captured for status/body checks.
      const response = await fetch(`${api}/events/stream`, {
        // Configure headers for the request/server under test.
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
        // Execute the next setup or assertion step for this scenario.
        signal: controller.signal,
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(response.status, 200);
      // Assert the observed value matches the intended post-condition.
      assert.match(response.headers.get("content-type")!, /text\/event-stream/);
      // Bind text for later setup or assertions in this scope.
      let text = "";
      // Bind closed for later setup or assertions in this scope.
      let closed = false;
      // Bind reader for later setup or assertions in this scope.
      const reader = response.body!.getReader();
      // Bind decoder for later setup or assertions in this scope.
      const decoder = new TextDecoder();
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
            text += decoder.decode(result.value, { stream: true });
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
      // Execute the next setup or assertion step for this scenario.
      pumps.push(pump);
      // Await async work before asserting or releasing locks.
      await until(() => text.includes("event: connected"), "initial connected frame");
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (invalidation === "revoke") {
        // Execute the next setup or assertion step for this scenario.
        publish("location.changed", { locationId: fx.locBId });
        // Execute the next setup or assertion step for this scenario.
        publish("location.changed", { locationId: fx.locAId });
        // Await async work before asserting or releasing locks.
        await until(() => text.includes(fx.locAId), "allowed event must arrive");
        // Assert the observed value matches the intended post-condition.
        assert.equal(text.includes(fx.locBId), false);
        // Production writers take User FOR UPDATE before scope flips.
        await updateSectorAtHead(prisma, fx.sectorAId, {
          // Execute the next setup or assertion step for this scenario.
          primarySupervisorEmployeeId: fx.supervisorB.employeeId,
          // Execute the next setup or assertion step for this scenario.
          actorEmployeeId: fx.manager.employeeId,
        });
        // Await async work before asserting or releasing locks.
        await updateSectorAtHead(prisma, fx.sectorBId, {
          // Execute the next setup or assertion step for this scenario.
          primarySupervisorEmployeeId: fx.supervisorA.employeeId,
          // Execute the next setup or assertion step for this scenario.
          actorEmployeeId: fx.manager.employeeId,
        });
        // Bind index for later setup or assertions in this scope.
        const index = text.length;
        // Execute the next setup or assertion step for this scenario.
        publish("location.changed", { locationId: fx.locAId });
        // Execute the next setup or assertion step for this scenario.
        publish("location.changed", { locationId: fx.locBId });
        // Await async work before asserting or releasing locks.
        await until(() => text.slice(index).includes(fx.locBId), "new sector event must arrive");
        // Assert the observed value matches the intended post-condition.
        assert.equal(text.slice(index).includes(fx.locAId), false);
        // Await async work before asserting or releasing locks.
        await revokeSession(tokens.sessionId);
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
      // Execute the next setup or assertion step for this scenario.
      } else {
        // Expire under the same User FOR UPDATE protocol as revokeSession.
        await prisma.$transaction(async (tx) => {
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
        });
      }
      // Bind beforeRevoke for later setup or assertions in this scope.
      const beforeRevoke = text.length;
      // Execute the next setup or assertion step for this scenario.
      publish("people.changed");
      // Execute the next setup or assertion step for this scenario.
      publish("location.changed", { locationId: fx.locBId });
      // Await async work before asserting or releasing locks.
      await until(() => closed, "revoked/expired stream must reach EOF before delivery");
      // Assert the observed value matches the intended post-condition.
      assert.match(text, /event: revoked/);
      // Assert the observed value matches the intended post-condition.
      assert.match(text, /session_revoked/);
      // Assert the observed value matches the intended post-condition.
      assert.equal(text.slice(beforeRevoke).includes("event: people.changed"), false);
      // Assert the observed value matches the intended post-condition.
      assert.equal(text.slice(beforeRevoke).includes("event: location.changed"), false);
      // Assert the observed value matches the intended post-condition.
      assert.equal(text.includes(": ping"), false, "no heartbeat fired during pre-delivery checks");
      // Bind end for later setup or assertions in this scope.
      const end = text.length;
      // Execute the next setup or assertion step for this scenario.
      publish("location.changed", { locationId: fx.locBId });
      // Assert collection size matches the expected post-condition.
      assert.equal(text.length, end);
    }
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Iterate to cover variants or wait until a condition holds.
    for (const c of controllers) c.abort();
    // Run actors together to expose races and serialization bugs.
    await Promise.allSettled(pumps);
    // Execute the next setup or assertion step for this scenario.
    t.mock.timers.reset();
  }
});

// Case: idle revoked and expired streams still close at heartbeat.
it("idle revoked and expired streams still close at heartbeat", async (t) => {
  // Execute the next setup or assertion step for this scenario.
  t.mock.timers.enable({ apis: ["setInterval"] });
  // Try path where partial failure must not leak suite state.
  try {
    // Iterate to cover variants or wait until a condition holds.
    for (const invalidation of ["revoke", "expiry"] as const) {
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
            text += new TextDecoder().decode(result.value);
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
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (invalidation === "revoke") {
          // Await async work before asserting or releasing locks.
          await revokeSession(tokens.sessionId);
        // Execute the next setup or assertion step for this scenario.
        } else {
          // Await async work before asserting or releasing locks.
          await prisma.$transaction(async (tx) => {
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
          });
        }
        // Execute the next setup or assertion step for this scenario.
        t.mock.timers.tick(25000);
        // Await async work before asserting or releasing locks.
        await until(() => closed, "idle stream must close at heartbeat");
        // Assert the observed value matches the intended post-condition.
        assert.match(text, /event: revoked/);
      // Execute the next setup or assertion step for this scenario.
      } finally {
        // Execute the next setup or assertion step for this scenario.
        controller.abort();
        // Await async work before asserting or releasing locks.
        await pump;
      }
    }
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Execute the next setup or assertion step for this scenario.
    t.mock.timers.reset();
  }
});
