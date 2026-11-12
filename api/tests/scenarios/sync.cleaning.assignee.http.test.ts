/**
 * cleaning sync assignee bypass parity with HTTP.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { GrantKind, Role, SessionStatus } from "@prisma/client";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Import bindings from ../../src/services/cleaning.
import { createCleaningTask } from "../../src/services/cleaning";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import bindings from ../../src/services/roleGrants.
import { invalidateGrantCache } from "../../src/services/roleGrants";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, listenApp, loginBearer, postJson } from "../httpHarness";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  createAndStartToday,
  // Execute the next setup or assertion step for this scenario.
  createCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  resetCleaningWork,
  // Shape CleaningWorld documents the fixture/response fields this suite touches.
  type CleaningWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../cleaning/fixtures";

// Suite: sync push cleaning assignee gate.
describe("sync push cleaning assignee gate", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: CleaningWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Execute the next setup or assertion step for this scenario.
  let hk1Token: string;
  // Execute the next setup or assertion step for this scenario.
  let hk2Token: string;
  // Execute the next setup or assertion step for this scenario.
  let managerToken: string;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    // Iterate to cover variants or wait until a condition holds.
    for (const key of ["cleaning.start", "cleaning.complete"] as const) {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await prisma.roleGrant.upsert({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          role_kind_key: { role: Role.manager, kind: GrantKind.action, key },
        },
        // Execute the next setup or assertion step for this scenario.
        create: { role: Role.manager, kind: GrantKind.action, key },
        // SQL fragment used to observe locks or assert DB state.
        update: {},
      });
    }
    // Execute the next setup or assertion step for this scenario.
    invalidateGrantCache();
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ api, server } = await listenApp());
    // Await async work before asserting or releasing locks.
    hk1Token = (await loginBearer(api, world.hk1.email, CLN_PASSWORD)).token;
    // Await async work before asserting or releasing locks.
    hk2Token = (await loginBearer(api, world.hk2.email, CLN_PASSWORD)).token;
    // Await async work before asserting or releasing locks.
    managerToken = (await loginBearer(api, world.manager.email, CLN_PASSWORD))
      // Continue the call chain for setup or assertion detail.
      .token;
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await resetCleaningWork(prisma, world);
    // Await async work before asserting or releasing locks.
    await prisma.syncRun.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        user: {
          // Execute the next setup or assertion step for this scenario.
          employeeId: {
            // Execute the next setup or assertion step for this scenario.
            in: [
              // Execute the next setup or assertion step for this scenario.
              world.hk1.employeeId,
              // Execute the next setup or assertion step for this scenario.
              world.hk2.employeeId,
              // Execute the next setup or assertion step for this scenario.
              world.manager.employeeId,
            ],
          },
        },
      },
    });
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) {
      // Await async work before asserting or releasing locks.
      await prisma.syncRun.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { user: { employeeId: { in: world.employeeIds } } },
      });
      // Await async work before asserting or releasing locks.
      await cleanupCleaningWorld(prisma, world);
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case checks authz/session policy: foreign housekeeper is forbidden on sync cleaning.start.
  it("foreign housekeeper is forbidden on sync cleaning.start", async () => {
    // today: synchronize actors so the race window is observable.
    const today = await hotelTodayYmd();
    // task: seeded entity required before the mutation under test.
    const task = await createCleaningTask({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: today,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
    });
    // Bind cmd for later setup or assertions in this scope.
    const cmd = {
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      type: "cleaning.start",
      // Execute the next setup or assertion step for this scenario.
      payload: { taskId: task.id, expectedVersion: task.version },
      // Execute the next setup or assertion step for this scenario.
      clientTime: "2026-01-01T00:00:00Z",
    };
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, hk2Token, "/sync/push", { commands: [cmd] });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Bind result for later setup or assertions in this scope.
    const result = (
      // Execute the next setup or assertion step for this scenario.
      res.body as { results: Array<{ status: string; message?: string }> }
    // Execute the next setup or assertion step for this scenario.
    ).results[0];
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      result.status === "forbidden" || result.status === "conflict",
      // Execute the next setup or assertion step for this scenario.
      `expected deny, got ${JSON.stringify(result)}`,
    );

    // after: synchronize actors so the race window is observable.
    const after = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: task.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(after.status, "assigned");
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.assignedEmployeeId, world.hk1.employeeId);
  });

  // Case: manager bypasses session owner via sync cleaning.complete.
  it("manager bypasses session owner via sync cleaning.complete", async () => {
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    const { started } = await createAndStartToday(
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      world.hk1.employeeId,
    );
    // Bind completeCmd for later setup or assertions in this scope.
    const completeCmd = {
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      type: "cleaning.complete",
      // Execute the next setup or assertion step for this scenario.
      payload: {
        // Session/CSRF step exercising auth lifecycle.
        sessionId: started.session.id,
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: started.task.version,
      },
      // Execute the next setup or assertion step for this scenario.
      clientTime: "2026-01-01T00:00:01Z",
    };
    // completeRes: HTTP response captured for status/body checks.
    const completeRes = await postJson(api, managerToken, "/sync/push", {
      // Execute the next setup or assertion step for this scenario.
      commands: [completeCmd],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(completeRes.status, 200, JSON.stringify(completeRes.body));
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      (completeRes.body as { results: Array<{ status: string }> }).results[0]
        // Continue the call chain for setup or assertion detail.
        .status,
      // Execute the next setup or assertion step for this scenario.
      "ok",
      // Execute the next setup or assertion step for this scenario.
      JSON.stringify(completeRes.body),
    );

    // session: session cookie jar for authenticated requests.
    const session = await prisma.cleaningSession.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: started.session.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(session.status, SessionStatus.completed);
    // Assert the observed value matches the intended post-condition.
    assert.equal(session.employeeId, world.hk1.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(session.completeActorEmployeeId, world.manager.employeeId);
  });

  // Case: assignee can still progress own task via sync (non-bypass control).
  it("assignee can still progress own task via sync (non-bypass control)", async () => {
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    const { started } = await createAndStartToday(
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      world.hk1.employeeId,
    );
    // Bind cmd for later setup or assertions in this scope.
    const cmd = {
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      type: "cleaning.complete",
      // Execute the next setup or assertion step for this scenario.
      payload: {
        // Session/CSRF step exercising auth lifecycle.
        sessionId: started.session.id,
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: started.task.version,
      },
      // Execute the next setup or assertion step for this scenario.
      clientTime: "2026-01-01T00:00:00Z",
    };
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, hk1Token, "/sync/push", { commands: [cmd] });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      (res.body as { results: Array<{ status: string }> }).results[0].status,
      // Execute the next setup or assertion step for this scenario.
      "ok",
    );
    // session: session cookie jar for authenticated requests.
    const session = await prisma.cleaningSession.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: started.session.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(session.status, SessionStatus.completed);
  });
});
