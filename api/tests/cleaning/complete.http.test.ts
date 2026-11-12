/**
 * HTTP — cleaning assignee bypass aligned with tickets .
 * Deny foreign housekeeper; allow manager complete bypass; assignee can complete own.
 */
import assert from "node:assert/strict";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Import bindings from node:path.
import path from "node:path";
// Prisma client types/runtime for DB setup and assertions.
import { GrantKind, PrismaClient, Role, SessionStatus } from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import bindings from ../../src/services/cleaning.
import { createCleaningTask } from "../../src/services/cleaning";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  ensureDefaultRoleGrants,
  // Execute the next setup or assertion step for this scenario.
  invalidateGrantCache,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/roleGrants";
// Import module bindings used by this suite.
import {
  // Start or stop the in-process API server for this suite.
  closeServer,
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
} from "./fixtures";

// Execute the next setup or assertion step for this scenario.
dotenv.config({
  // Execute the next setup or assertion step for this scenario.
  path: path.resolve(__dirname, "../../.env"),
  // Execute the next setup or assertion step for this scenario.
  override: true,
});
// Override env for isolation, rate-limit disable, or scheduler quieting.
process.env.JWT_SECRET =
  // Override env for isolation, rate-limit disable, or scheduler quieting.
  process.env.JWT_SECRET || "test-secret-for-cleaning-complete-http";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: cleaning complete HTTP.
describe("cleaning complete HTTP", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: CleaningWorld;
  // Execute the next setup or assertion step for this scenario.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Bind api for later setup or assertions in this scope.
  let api = "";

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Await async work before asserting or releasing locks.
    await ensureDefaultRoleGrants();
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
    // listened: synchronize actors so the race window is observable.
    const listened = await listenApp();
    // Execute the next setup or assertion step for this scenario.
    server = listened.server;
    // Execute the next setup or assertion step for this scenario.
    api = listened.api;
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

  // Case: -http: foreign HK denied; manager bypasses complete; assignee completes own.
  it("-http: foreign HK denied; manager bypasses complete; assignee completes own", async () => {
    // Await async work before asserting or releasing locks.
    await resetCleaningWork(prisma, world);
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

    // Await async work before asserting or releasing locks.
    const { token: hk2Token } = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.hk2.email,
      // Execute the next setup or assertion step for this scenario.
      CLN_PASSWORD,
    );
    // foreignStart: HTTP response captured for status/body checks.
    const foreignStart = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      hk2Token,
      // Execute the next setup or assertion step for this scenario.
      `/cleaning/tasks/${task.id}/start`,
      // Execute the next setup or assertion step for this scenario.
      { commandId: randomUUID(), expectedVersion: task.version },
    );
    // Scope denial (403) or assignee_conflict (409) are both valid deny paths.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      foreignStart.status === 403 || foreignStart.status === 409,
      // Execute the next setup or assertion step for this scenario.
      JSON.stringify(foreignStart.body),
    );

    // Await async work before asserting or releasing locks.
    await resetCleaningWork(prisma, world);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    const { started } = await createAndStartToday(
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      world.hk1.employeeId,
    );

    // Await async work before asserting or releasing locks.
    const { token: managerToken } = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.manager.email,
      // Execute the next setup or assertion step for this scenario.
      CLN_PASSWORD,
    );
    // managerRes: HTTP response captured for status/body checks.
    const managerRes = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      managerToken,
      // Session/CSRF step exercising auth lifecycle.
      `/cleaning/sessions/${started.session.id}/complete`,
      {
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: started.task.version,
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(managerRes.status, 200, JSON.stringify(managerRes.body));
    // Bind managerBody for later setup or assertions in this scope.
    const managerBody = managerRes.body as {
      // Session/CSRF step exercising auth lifecycle.
      session?: { employeeId?: string; completeActorEmployeeId?: string };
    };
    // Assert the observed value matches the intended post-condition.
    assert.equal(managerBody.session?.employeeId, world.hk1.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Session/CSRF step exercising auth lifecycle.
      managerBody.session?.completeActorEmployeeId,
      // Execute the next setup or assertion step for this scenario.
      world.manager.employeeId,
    );

    // Await async work before asserting or releasing locks.
    await resetCleaningWork(prisma, world);
    // own: seeded entity required before the mutation under test.
    const own = await createAndStartToday(
      // Execute the next setup or assertion step for this scenario.
      world,
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      world.hk1.employeeId,
    );
    // Await async work before asserting or releasing locks.
    const { token: hk1Token } = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.hk1.email,
      // Execute the next setup or assertion step for this scenario.
      CLN_PASSWORD,
    );
    // ownRes: HTTP response captured for status/body checks.
    const ownRes = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      hk1Token,
      // Session/CSRF step exercising auth lifecycle.
      `/cleaning/sessions/${own.started.session.id}/complete`,
      {
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: own.started.task.version,
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(ownRes.status, 200, JSON.stringify(ownRes.body));
    // done: synchronize actors so the race window is observable.
    const done = await prisma.cleaningSession.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: own.started.session.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(done.status, SessionStatus.completed);
  });
});
