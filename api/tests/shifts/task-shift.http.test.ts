/**
 * create/reassign assertActiveShiftId HTTP contracts.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient } from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
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
  cleanupSectorsWorld,
  // Execute the next setup or assertion step for this scenario.
  createSectorsWorld,
  // Execute the next setup or assertion step for this scenario.
  resetSectorMemberships,
  // Shape SectorsWorld documents the fixture/response fields this suite touches.
  type SectorsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../sectors/fixtures";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupShiftsWorld,
  // Execute the next setup or assertion step for this scenario.
  createShiftsWorld,
  // Shape ShiftsWorld documents the fixture/response fields this suite touches.
  type ShiftsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: cleaning task shiftId HTTP.
describe("cleaning task shiftId HTTP", () => {
  // Execute the next setup or assertion step for this scenario.
  let sectors: SectorsWorld;
  // Execute the next setup or assertion step for this scenario.
  let shifts: ShiftsWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: import("node:http").Server;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    sectors = await createSectorsWorld(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    shifts = await createShiftsWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Start or stop the in-process API server for this suite.
    await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (shifts) await cleanupShiftsWorld(prisma, shifts);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (sectors) await cleanupSectorsWorld(prisma, sectors);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await resetSectorMemberships(prisma, sectors);
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: {
          // Execute the next setup or assertion step for this scenario.
          in: [
            // Execute the next setup or assertion step for this scenario.
            sectors.loc1Id,
            // Execute the next setup or assertion step for this scenario.
            sectors.loc2Id,
            // Execute the next setup or assertion step for this scenario.
            sectors.loc3Id,
            // Execute the next setup or assertion step for this scenario.
            sectors.loc4Id,
            // Execute the next setup or assertion step for this scenario.
            sectors.loc5Id,
          ],
        },
      },
    });
  });

  // Case: create with unknown shift → 404; no task.
  it("create with unknown shift → 404; no task", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      sectors.manager.email,
      // Execute the next setup or assertion step for this scenario.
      sectors.password,
    );
    // before: synchronize actors so the race window is observable.
    const before = await prisma.cleaningTask.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { locationId: sectors.loc1Id },
    });
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, mgr.token, "/cleaning/tasks", {
      // Execute the next setup or assertion step for this scenario.
      locationId: sectors.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: "2099-11-01",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: sectors.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: "missing-shift-id",
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 404);
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { error?: string }).error, "not_found");
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.cleaningTask.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { locationId: sectors.loc1Id },
      }),
      // Execute the next setup or assertion step for this scenario.
      before,
    );
  });

  // Case: create with inactive shift → 400 invalid_state.
  it("create with inactive shift → 400 invalid_state", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      sectors.manager.email,
      // Execute the next setup or assertion step for this scenario.
      sectors.password,
    );
    // before: synchronize actors so the race window is observable.
    const before = await prisma.cleaningTask.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { locationId: sectors.loc1Id },
    });
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, mgr.token, "/cleaning/tasks", {
      // Execute the next setup or assertion step for this scenario.
      locationId: sectors.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: "2099-11-02",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: sectors.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: shifts.shiftInactiveId,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { error?: string }).error, "invalid_state");
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.cleaningTask.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { locationId: sectors.loc1Id },
      }),
      // Execute the next setup or assertion step for this scenario.
      before,
    );
  });

  // Case: reassign unknown shift → 404; unchanged.
  it("reassign unknown shift → 404; unchanged", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      sectors.manager.email,
      // Execute the next setup or assertion step for this scenario.
      sectors.password,
    );
    // created: seeded entity required before the mutation under test.
    const created = await postJson(api, mgr.token, "/cleaning/tasks", {
      // Execute the next setup or assertion step for this scenario.
      locationId: sectors.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: "2099-11-03",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: sectors.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: shifts.shiftMorningId,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(created.status, 201);
    // Bind task for later setup or assertions in this scope.
    const task = created.body as { id: string; version: number; shiftId: string };
    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      mgr.token,
      // Execute the next setup or assertion step for this scenario.
      `/cleaning/tasks/${task.id}/reassign`,
      {
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: sectors.housekeeper.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "unnamed case",
        // Execute the next setup or assertion step for this scenario.
        shiftId: "missing-shift-id",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 404);
    // row: synchronize actors so the race window is observable.
    const row = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: task.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.shiftId, shifts.shiftMorningId);
  });

  // Case: reassign inactive shift → 400.
  it("reassign inactive shift → 400", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      sectors.manager.email,
      // Execute the next setup or assertion step for this scenario.
      sectors.password,
    );
    // created: seeded entity required before the mutation under test.
    const created = await postJson(api, mgr.token, "/cleaning/tasks", {
      // Execute the next setup or assertion step for this scenario.
      locationId: sectors.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: "2099-11-04",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: sectors.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: shifts.shiftMorningId,
    });
    // Bind task for later setup or assertions in this scope.
    const task = created.body as { id: string; version: number };
    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      mgr.token,
      // Execute the next setup or assertion step for this scenario.
      `/cleaning/tasks/${task.id}/reassign`,
      {
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: sectors.housekeeper.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "unnamed case",
        // Execute the next setup or assertion step for this scenario.
        shiftId: shifts.shiftInactiveId,
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { error?: string }).error, "invalid_state");
  });

  // Case: reassign shiftId null clears.
  it("reassign shiftId null clears", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      sectors.manager.email,
      // Execute the next setup or assertion step for this scenario.
      sectors.password,
    );
    // created: seeded entity required before the mutation under test.
    const created = await postJson(api, mgr.token, "/cleaning/tasks", {
      // Execute the next setup or assertion step for this scenario.
      locationId: sectors.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: "2099-11-05",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: sectors.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: shifts.shiftMorningId,
    });
    // Bind task for later setup or assertions in this scope.
    const task = created.body as { id: string; version: number };
    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      mgr.token,
      // Execute the next setup or assertion step for this scenario.
      `/cleaning/tasks/${task.id}/reassign`,
      {
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: sectors.housekeeper.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "clear",
        // Execute the next setup or assertion step for this scenario.
        shiftId: null,
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
        // Fixture HK is off-roster; this case covers shiftId clearing, not availability.
        forceDespiteAvailability: true,
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // row: synchronize actors so the race window is observable.
    const row = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: task.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.shiftId, null);
  });

  // Case: reassign omit shiftId keeps previous.
  it("reassign omit shiftId keeps previous", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      sectors.manager.email,
      // Execute the next setup or assertion step for this scenario.
      sectors.password,
    );
    // created: seeded entity required before the mutation under test.
    const created = await postJson(api, mgr.token, "/cleaning/tasks", {
      // Execute the next setup or assertion step for this scenario.
      locationId: sectors.loc1Id,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: "2099-11-06",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: sectors.housekeeper.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: shifts.shiftEveningId,
    });
    // Bind task for later setup or assertions in this scope.
    const task = created.body as { id: string; version: number };
    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      mgr.token,
      // Execute the next setup or assertion step for this scenario.
      `/cleaning/tasks/${task.id}/reassign`,
      {
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: sectors.housekeeper.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "omit",
        // Execute the next setup or assertion step for this scenario.
        expectedVersion: task.version,
        // Fixture HK is off-roster; this case covers omit-shiftId keep, not availability.
        forceDespiteAvailability: true,
      },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // row: synchronize actors so the race window is observable.
    const row = await prisma.cleaningTask.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: task.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.shiftId, shifts.shiftEveningId);
  });
});
