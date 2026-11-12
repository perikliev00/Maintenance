/**
 * Available-housekeepers HTTP + reassign availability conflict.
 */
import assert from "node:assert/strict";
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
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
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
  process.env.JWT_SECRET || "test-secret-for-cleaning-availability-http";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: cleaning available-housekeepers HTTP.
describe("cleaning available-housekeepers HTTP", () => {
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

  // Case: lists housekeepers with availability and excludes current assignee.
  it("lists housekeepers with availability and excludes current assignee", async () => {
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
    const { token } = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.manager.email,
      // Execute the next setup or assertion step for this scenario.
      CLN_PASSWORD,
    );
    // res: HTTP response captured for status/body checks.
    const res = await getJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      `/cleaning/available-housekeepers?locationId=${world.locationAId}&taskId=${task.id}`,
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Bind body for later setup or assertions in this scope.
    const body = res.body as {
      // Execute the next setup or assertion step for this scenario.
      housekeepers: Array<{
        // Execute the next setup or assertion step for this scenario.
        employeeId: string;
        // Execute the next setup or assertion step for this scenario.
        availabilityStatus: string;
        // Execute the next setup or assertion step for this scenario.
        assignedTaskCount: number;
      // Execute the next setup or assertion step for this scenario.
      }>;
    };
    // Assert the observed value matches the intended post-condition.
    assert.ok(Array.isArray(body.housekeepers));
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      !body.housekeepers.some((h) => h.employeeId === world.hk1.employeeId),
    );
    // Bind hk2 for later setup or assertions in this scope.
    const hk2 = body.housekeepers.find(
      // Execute the next setup or assertion step for this scenario.
      (h) => h.employeeId === world.hk2.employeeId,
    );
    // Assert the observed value matches the intended post-condition.
    assert.ok(hk2);
    // Assert the observed value matches the intended post-condition.
    assert.equal(hk2.availabilityStatus, "available");
  });

  // Case: rejects ordinary reassign when replacement is off_shift.
  it("rejects ordinary reassign when replacement is off_shift", async () => {
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

    // Remove roster so hk2 becomes off_shift.
    await prisma.employeeShiftRoster.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { employeeId: world.hk2.employeeId },
    });

    // Await async work before asserting or releasing locks.
    const { token } = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      world.manager.email,
      // Execute the next setup or assertion step for this scenario.
      CLN_PASSWORD,
    );
    // blocked: HTTP response captured for status/body checks.
    const blocked = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      `/cleaning/tasks/${task.id}/reassign`,
      {
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "should fail without override",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(blocked.status, 409);
    // Bind blockedBody for later setup or assertions in this scope.
    const blockedBody = blocked.body as { error?: string };
    // Assert the observed value matches the intended post-condition.
    assert.equal(blockedBody.error, "availability_conflict");

    // forced: HTTP response captured for status/body checks.
    const forced = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      `/cleaning/tasks/${task.id}/reassign`,
      {
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "manager override for ops",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
        // Execute the next setup or assertion step for this scenario.
        forceDespiteAvailability: true,
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(forced.status, 200);
  });
});
