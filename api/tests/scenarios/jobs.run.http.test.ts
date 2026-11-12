/**
 * HTTP wiring for POST /jobs/run shared execution lock (audit §3.4).
 * Domain lock coverage lives in executionLock.test.ts; this suite proves the
 * controller returns 409 while the lock is held and succeeds after release.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Execute the next setup or assertion step for this scenario.
  getJson,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  postJson,
// Execute the next setup or assertion step for this scenario.
} from "../httpHarness";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  createCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Shape CleaningWorld documents the fixture/response fields this suite touches.
  type CleaningWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../cleaning/fixtures";
// Import bindings from ../../src/services/jobs/executionLock.
import { runWithJobExecutionLock } from "../../src/services/jobs/executionLock";
// Import bindings from ../../src/services/roleGrants.
import { invalidateGrantCache } from "../../src/services/roleGrants";
// Prisma client types/runtime for DB setup and assertions.
import { GrantKind } from "@prisma/client";

// Suite: POST /jobs/run shared execution lock.
describe("POST /jobs/run shared execution lock", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: CleaningWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Execute the next setup or assertion step for this scenario.
  let ownerToken: string;
  // Execute the next setup or assertion step for this scenario.
  let hkToken: string;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ api, server } = await listenApp());
    // Await async work before asserting or releasing locks.
    ownerToken = (await loginBearer(api, world.owner.email, CLN_PASSWORD)).token;
    // Await async work before asserting or releasing locks.
    hkToken = (await loginBearer(api, world.hk1.email, CLN_PASSWORD)).token;
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupCleaningWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case probes concurrency/isolation: returns 409 while the shared lock is held, then succeeds after release.
  it("returns 409 while the shared lock is held, then succeeds after release", async () => {
    // Execute the next setup or assertion step for this scenario.
    let release!: () => void;
    // Bind held for later setup or assertions in this scope.
    const held = new Promise<void>((resolve) => {
      // Execute the next setup or assertion step for this scenario.
      release = resolve;
    });
    // Bind active for later setup or assertions in this scope.
    const active = runWithJobExecutionLock(async () => {
      // Await async work before asserting or releasing locks.
      await held;
      // Return the arranged value/result to the caller.
      return "held";
    });
    // Let the lock acquire before racing the HTTP trigger.
    await Promise.resolve();

    // blocked: HTTP response captured for status/body checks.
    const blocked = await postJson(api, ownerToken, "/jobs/run", {
      // Session/CSRF step exercising auth lifecycle.
      jobKey: "overdue_sessions",
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Concurrency/isolation step for the race under test.
      (blocked.body as { error?: string }).error,
      // Execute the next setup or assertion step for this scenario.
      "job_already_running",
    );

    // Execute the next setup or assertion step for this scenario.
    release();
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await active, { acquired: true, value: "held" });

    // ok: HTTP response captured for status/body checks.
    const ok = await postJson(api, ownerToken, "/jobs/run", {
      // Session/CSRF step exercising auth lifecycle.
      jobKey: "overdue_sessions",
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    // Assert the observed value matches the intended post-condition.
    assert.equal(typeof ok.body, "object");
    // Assert the observed value matches the intended post-condition.
    assert.ok(ok.body && typeof (ok.body as { flagged?: unknown }).flagged === "number");
  });

  // Case: denies callers without jobs.run.
  it("denies callers without jobs.run", async () => {
    // denied: HTTP response captured for status/body checks.
    const denied = await postJson(api, hkToken, "/jobs/run", {
      // Session/CSRF step exercising auth lifecycle.
      jobKey: "overdue_sessions",
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
  });

  // Case: jobs.view alone cannot POST /jobs/run.
  it("jobs.view alone cannot POST /jobs/run", async () => {
    // Await async work before asserting or releasing locks.
    await prisma.roleGrant.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Fixture field role for the seeded actor/entity.
        role: "housekeeper",
        // Execute the next setup or assertion step for this scenario.
        kind: GrantKind.action,
        // Execute the next setup or assertion step for this scenario.
        key: "jobs.view",
      },
    });
    // Execute the next setup or assertion step for this scenario.
    invalidateGrantCache();
    // Try path where partial failure must not leak suite state.
    try {
      // listed: HTTP response captured for status/body checks.
      const listed = await getJson(api, hkToken, "/jobs/runs?limit=5");
      // Assert HTTP status matches the contract for this path.
      assert.equal(listed.status, 200, JSON.stringify(listed.body));

      // denied: HTTP response captured for status/body checks.
      const denied = await postJson(api, hkToken, "/jobs/run", {
        // Session/CSRF step exercising auth lifecycle.
        jobKey: "overdue_sessions",
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(denied.status, 403, JSON.stringify(denied.body));
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.roleGrant.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Fixture field role for the seeded actor/entity.
          role: "housekeeper",
          // Execute the next setup or assertion step for this scenario.
          kind: GrantKind.action,
          // Execute the next setup or assertion step for this scenario.
          key: "jobs.view",
        },
      });
      // Execute the next setup or assertion step for this scenario.
      invalidateGrantCache();
    }
  });
});
