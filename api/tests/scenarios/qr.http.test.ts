/**
 * Legacy filename kept so scenario runners that list `qr` still pick up the
 * remaining sync ownership regression (room QR HTTP coverage was removed).
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, it } from "node:test";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  createScopeSmokeFixture,
  // Execute the next setup or assertion step for this scenario.
  cleanupScopeSmokeFixture,
  // Shape ScopeSmokeFixture documents the fixture/response fields this suite touches.
  type ScopeSmokeFixture,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../fixtures";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, listenApp, loginBearer, postJson } from "../httpHarness";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";

// Execute the next setup or assertion step for this scenario.
let fx: ScopeSmokeFixture;
// Execute the next setup or assertion step for this scenario.
let api: string;
// Execute the next setup or assertion step for this scenario.
let server: Awaited<ReturnType<typeof listenApp>>["server"];
// Execute the next setup or assertion step for this scenario.
let token: string;

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
  // Await async work before asserting or releasing locks.
  token = (await loginBearer(api, fx.supervisorA.email, fx.password)).token;
});

// Release servers/DB clients so later suites stay isolated.
after(async () => {
  // Guard optional cleanup or alternate assertion paths.
  if (server) await closeServer(server);
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (fx) {
    // Await async work before asserting or releasing locks.
    await prisma.syncRun.deleteMany({ where: { userId: fx.supervisorA.userId } });
    // Await async work before asserting or releasing locks.
    await cleanupScopeSmokeFixture(prisma, fx);
  }
  // Disconnect Prisma so the pool does not leak across suites.
  await prisma.$disconnect();
});

// Case: sync recomputes supervisor sector ownership even when expectedVersion is current.
it("sync recomputes supervisor sector ownership even when expectedVersion is current", async () => {
  // Losing supervision is actual access loss. Moving a room alone retains the
  // task's sector snapshot and supervisors intentionally bypass its assignee.
  await prisma.cleaningTask.update({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: fx.taskAId },
    // Execute the next setup or assertion step for this scenario.
    data: { hotelDate: new Date("2026-01-01") },
  });
  // before: synchronize actors so the race window is observable.
  const before = await prisma.cleaningTask.findUniqueOrThrow({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: fx.taskAId },
  });
  // location: synchronize actors so the race window is observable.
  const location = await prisma.location.findUniqueOrThrow({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: fx.locAId },
  });
  // sector: synchronize actors so the race window is observable.
  const sector = await prisma.sector.findUniqueOrThrow({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: fx.sectorAId },
  });
  // Await async work before asserting or releasing locks.
  await prisma.sector.update({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: sector.id },
    // Execute the next setup or assertion step for this scenario.
    data: { primarySupervisorEmployeeId: fx.supervisorB.employeeId },
  });
  // Try path where partial failure must not leak suite state.
  try {
    // Bind cmd for later setup or assertions in this scope.
    const cmd = {
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      type: "cleaning.start",
      // Execute the next setup or assertion step for this scenario.
      payload: { taskId: before.id, expectedVersion: before.version },
    };
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, token, "/sync/push", { commands: [cmd] });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Assert HTTP status matches the contract for this path.
    assert.equal((res.body as any).results[0].status, "conflict");
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as any).results[0].code, "assignee_conflict");
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Await async work before asserting or releasing locks.
      await prisma.cleaningTask.findUniqueOrThrow({ where: { id: before.id } }),
      // Execute the next setup or assertion step for this scenario.
      before,
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Await async work before asserting or releasing locks.
      await prisma.location.findUniqueOrThrow({ where: { id: location.id } }),
      // Execute the next setup or assertion step for this scenario.
      location,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await prisma.cleaningSession.count({ where: { taskId: before.id } }),
      0,
    );
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Await async work before asserting or releasing locks.
    await prisma.sector.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: sector.id },
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        primarySupervisorEmployeeId: sector.primarySupervisorEmployeeId,
      },
    });
  }
});
