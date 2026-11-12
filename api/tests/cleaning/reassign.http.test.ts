/**
 * reception allow_reception_reassign gate (HTTP).
 */
import assert from "node:assert/strict";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Import bindings from node:path.
import path from "node:path";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient } from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import bindings from ../../src/services/cleaning.
import { createCleaningTask } from "../../src/services/cleaning";
// Import bindings from ../../src/services/roleGrants.
import { ensureDefaultRoleGrants } from "../../src/services/roleGrants";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { withDatabaseBarrier } from "../dbBarrier";
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
  createCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  resetCleaningWork,
  // Execute the next setup or assertion step for this scenario.
  withFlagsPatch,
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
  process.env.JWT_SECRET || "test-secret-for-cleaning-reassign-http";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: cleaning reassign HTTP.
describe("cleaning reassign HTTP", () => {
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

  // Case probes concurrency/isolation: reception blocked by flag; manager succeeds.
  it("reception blocked by flag; manager succeeds", async () => {
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
    await withFlagsPatch(
      // Execute the next setup or assertion step for this scenario.
      world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      { allow_reception_reassign: false },
      // Execute the next setup or assertion step for this scenario.
      async () => {
        // Await async work before asserting or releasing locks.
        const { token: receptionToken } = await loginBearer(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          world.reception.email,
          // Execute the next setup or assertion step for this scenario.
          CLN_PASSWORD,
        );
        // receptionRes: HTTP response captured for status/body checks.
        const receptionRes = await postJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          receptionToken,
          // Execute the next setup or assertion step for this scenario.
          `/cleaning/tasks/${task.id}/reassign`,
          {
            // Execute the next setup or assertion step for this scenario.
            assignedEmployeeId: world.hk2.employeeId,
            // Execute the next setup or assertion step for this scenario.
            reason: "reception attempt",
            // Execute the next setup or assertion step for this scenario.
            expectedVersion: task.version,
          },
        );
        // Assert HTTP status matches the contract for this path.
        assert.equal(receptionRes.status, 403);
        // Bind body for later setup or assertions in this scope.
        const body = receptionRes.body as {
          // Execute the next setup or assertion step for this scenario.
          error?: string;
          // Execute the next setup or assertion step for this scenario.
          message?: string;
        };
        // Assert the observed value matches the intended post-condition.
        assert.equal(body.error, "forbidden");
        // Assert the observed value matches the intended post-condition.
        assert.equal(
          // Execute the next setup or assertion step for this scenario.
          body.message,
          // Execute the next setup or assertion step for this scenario.
          "Reception reassign is disabled in settings",
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
          // Execute the next setup or assertion step for this scenario.
          `/cleaning/tasks/${task.id}/reassign`,
          {
            // Execute the next setup or assertion step for this scenario.
            assignedEmployeeId: world.hk2.employeeId,
            // Execute the next setup or assertion step for this scenario.
            reason: "manager reassign ok",
            // Execute the next setup or assertion step for this scenario.
            expectedVersion: task.version,
          },
        );
        // Assert HTTP status matches the contract for this path.
        assert.equal(managerRes.status, 200);
        // Bind updated for later setup or assertions in this scope.
        const updated = managerRes.body as {
          // Execute the next setup or assertion step for this scenario.
          assignedEmployeeId?: string;
          // Execute the next setup or assertion step for this scenario.
          reassignReason?: string;
        };
        // Assert the observed value matches the intended post-condition.
        assert.equal(updated.assignedEmployeeId, world.hk2.employeeId);
        // Assert the observed value matches the intended post-condition.
        assert.equal(updated.reassignReason, "manager reassign ok");
      },
    );
  });

  // Iterate to cover variants or wait until a condition holds.
  for (const startFirst of [true, false]) {
    // Case: HTTP: ${startFirst ? .
    it(`HTTP: ${startFirst ? "start": "reassign"} first never returns 500`, async () => {
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
      const { token: hkToken } = await loginBearer(api, world.hk1.email, CLN_PASSWORD);
      // Await async work before asserting or releasing locks.
      const { token: managerToken } = await loginBearer(api, world.manager.email, CLN_PASSWORD);
      // Bind start for later setup or assertions in this scope.
      const start = () => postJson(api, hkToken, `/cleaning/tasks/${task.id}/start`, {
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
      });
      // Bind reassign for later setup or assertions in this scope.
      const reassign = () => postJson(api, managerToken, `/cleaning/tasks/${task.id}/reassign`, {
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk2.employeeId,
        // Concurrency/isolation step for the race under test.
        reason: "HTTP lock-order race",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
      });

      // ordered: synchronize actors so the race window is observable.
      const ordered = await withDatabaseBarrier(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Execute the next setup or assertion step for this scenario.
        (tx) => tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE`,
        // Execute the next setup or assertion step for this scenario.
        async (waitFor) => {
          // Bind first for later setup or assertions in this scope.
          const first = (startFirst ? start : reassign)();
          // Await async work before asserting or releasing locks.
          await waitFor(1);
          // Bind second for later setup or assertions in this scope.
          const second = (startFirst ? reassign : start)();
          // Return the arranged value/result to the caller.
          return Promise.all([first, second]);
        },
      );
      // Execute the next setup or assertion step for this scenario.
      const [startResponse, reassignResponse] = startFirst
        ? ordered
        : [ordered[1]!, ordered[0]!];

      // Assert HTTP status matches the contract for this path.
      assert.notEqual(startResponse.status, 500);
      // Assert HTTP status matches the contract for this path.
      assert.notEqual(reassignResponse.status, 500);
      // Assert HTTP status matches the contract for this path.
      assert.equal(startResponse.status, startFirst ? 201 : 409);
      // Assert HTTP status matches the contract for this path.
      assert.equal(reassignResponse.status, startFirst ? 409 : 200);

      // finalTask: synchronize actors so the race window is observable.
      const finalTask = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
      // running: synchronize actors so the race window is observable.
      const running = await prisma.cleaningSession.findFirst({
        // SQL fragment used to observe locks or assert DB state.
        where: { taskId: task.id, status: "running" },
      });
      // Assert the observed value matches the intended post-condition.
      assert.equal(Boolean(running), startFirst);
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        finalTask.assignedEmployeeId,
        // Execute the next setup or assertion step for this scenario.
        startFirst ? world.hk1.employeeId : world.hk2.employeeId,
      );
      // Assert the observed value matches the intended post-condition.
      if (running) assert.equal(running.employeeId, world.hk1.employeeId);
    });
  }
});
