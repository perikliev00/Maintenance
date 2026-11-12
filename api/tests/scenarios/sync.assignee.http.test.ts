/**
 * regression — assignee gate parity for /sync/push ticket lifecycle.
 * REST coverage lives in assignee.gate.http.test.ts; this suite proves the
 * offline sync adapters forward canBypassTicketAssignee correctly.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, listenApp, loginBearer, postJson } from "../httpHarness";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  advanceTicketTo,
  // Execute the next setup or assertion step for this scenario.
  cleanupTicketsWorld,
  // Execute the next setup or assertion step for this scenario.
  countTicketEvents,
  // Execute the next setup or assertion step for this scenario.
  createTicketsWorld,
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  reportTicket,
  // Shape TicketsWorld documents the fixture/response fields this suite touches.
  type TicketsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../tickets/fixtures";

// Suite: sync push ticket assignee gate.
describe("sync push ticket assignee gate", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: TicketsWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Execute the next setup or assertion step for this scenario.
  let techAToken: string;
  // Execute the next setup or assertion step for this scenario.
  let techBToken: string;
  // Execute the next setup or assertion step for this scenario.
  let managerToken: string;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createTicketsWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ api, server } = await listenApp());
    // Execute the next setup or assertion step for this scenario.
    techAToken = (
      // Await async work before asserting or releasing locks.
      await loginBearer(api, world.technician.email, CLN_PASSWORD)
    // Execute the next setup or assertion step for this scenario.
    ).token;
    // Execute the next setup or assertion step for this scenario.
    techBToken = (
      // Await async work before asserting or releasing locks.
      await loginBearer(api, world.technician2.email, CLN_PASSWORD)
    // Execute the next setup or assertion step for this scenario.
    ).token;
    // Execute the next setup or assertion step for this scenario.
    managerToken = (
      // Await async work before asserting or releasing locks.
      await loginBearer(api, world.manager.email, CLN_PASSWORD)
    // Execute the next setup or assertion step for this scenario.
    ).token;
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await prisma.ticketEvent.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { ticket: { locationId: world.locationAId } },
    });
    // Await async work before asserting or releasing locks.
    await prisma.maintenanceTicket.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { locationId: world.locationAId },
    });
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
              world.technician.employeeId,
              // Execute the next setup or assertion step for this scenario.
              world.technician2.employeeId,
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
      await cleanupTicketsWorld(prisma, world);
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case checks authz/session policy: foreign technician is forbidden on sync ticket.start; ticket graph unchanged.
  it("foreign technician is forbidden on sync ticket.start; ticket graph unchanged", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "assigned");
    // before: synchronize actors so the race window is observable.
    const before = await prisma.maintenanceTicket.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: ticket.id },
    });
    // eventsBefore: synchronize actors so the race window is observable.
    const eventsBefore = await countTicketEvents(prisma, ticket.id);

    // Bind cmd for later setup or assertions in this scope.
    const cmd = {
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      type: "ticket.start",
      // Execute the next setup or assertion step for this scenario.
      payload: { ticketId: ticket.id },
      // Execute the next setup or assertion step for this scenario.
      clientTime: "2026-01-01T00:00:00Z",
    };
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, techBToken, "/sync/push", {
      // Execute the next setup or assertion step for this scenario.
      commands: [cmd],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Bind result for later setup or assertions in this scope.
    const result = (res.body as { results: Array<{ status: string; message?: string }> }).results[0];
    // Technicians are scoped to assigned_tickets, so a foreign tech is denied
    // at assertCanAccessTicket (same 403 class as REST). Either scope or
    // assignee-gate wording is an acceptable denial; "ok" is not.
    assert.equal(result.status, "forbidden");
    // Assert the observed value matches the intended post-condition.
    assert.match(
      // Execute the next setup or assertion step for this scenario.
      result.message ?? "",
      // Execute the next setup or assertion step for this scenario.
      /assigned to another employee|Outside your permitted data scope/i,
    );

    // after: synchronize actors so the race window is observable.
    const after = await prisma.maintenanceTicket.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: ticket.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(after.status, before.status);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.assigneeId, before.assigneeId);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(after.updatedAt, before.updatedAt);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsBefore);
  });

  // Case: manager bypasses assignee via sync start/wait/resume/resolve.
  it("manager bypasses assignee via sync start/wait/resume/resolve", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "assigned");
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      (await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticket.id } }))
        // Continue the call chain for setup or assertion detail.
        .assigneeId,
      // Execute the next setup or assertion step for this scenario.
      world.technician.employeeId,
    );

    // Bind batch for later setup or assertions in this scope.
    const batch = ["ticket.start", "ticket.wait", "ticket.resume", "ticket.resolve"].map(
      // Execute the next setup or assertion step for this scenario.
      (type) => ({
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        type,
        // Execute the next setup or assertion step for this scenario.
        payload: {
          // Execute the next setup or assertion step for this scenario.
          ticketId: ticket.id,
          // Continue the call chain for setup or assertion detail.
          ...(type === "ticket.wait" ? { reason: "parts" } : {}),
          // Continue the call chain for setup or assertion detail.
          ...(type === "ticket.resolve"
            ? { resolutionNotes: "manager offline resolve" }
            : {}),
        },
        // Execute the next setup or assertion step for this scenario.
        clientTime: "2026-01-01T00:00:00Z",
      }),
    );

    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, managerToken, "/sync/push", {
      // Execute the next setup or assertion step for this scenario.
      commands: batch,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Bind results for later setup or assertions in this scope.
    const results = (res.body as { results: Array<{ status: string; data?: { status: string } }> })
      // Continue the call chain for setup or assertion detail.
      .results;
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      results.map((r) => r.status),
      // Execute the next setup or assertion step for this scenario.
      ["ok", "ok", "ok", "ok"],
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      results.map((r) => r.data?.status),
      // Execute the next setup or assertion step for this scenario.
      ["in_progress", "waiting", "in_progress", "resolved"],
    );

    // final: synchronize actors so the race window is observable.
    const final = await prisma.maintenanceTicket.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: ticket.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(final.status, "resolved");
    // Assert the observed value matches the intended post-condition.
    assert.equal(final.assigneeId, world.technician.employeeId);

    // lifecycleEvents: synchronize actors so the race window is observable.
    const lifecycleEvents = await prisma.ticketEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { ticketId: ticket.id, commandId: { in: batch.map((c) => c.commandId) } },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { occurredAt: "asc" },
    });
    // Assert collection size matches the expected post-condition.
    assert.equal(lifecycleEvents.length, 4);
  });

  // Case: assignee can still progress own ticket via sync (non-bypass control).
  it("assignee can still progress own ticket via sync (non-bypass control)", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "assigned");
    // Bind cmd for later setup or assertions in this scope.
    const cmd = {
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      type: "ticket.start",
      // Execute the next setup or assertion step for this scenario.
      payload: { ticketId: ticket.id },
      // Execute the next setup or assertion step for this scenario.
      clientTime: "2026-01-01T00:00:00Z",
    };
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, techAToken, "/sync/push", { commands: [cmd] });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      (res.body as { results: Array<{ status: string; data?: { status: string } }> })
        // Continue the call chain for setup or assertion detail.
        .results[0].status,
      // Execute the next setup or assertion step for this scenario.
      "ok",
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      (await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticket.id } }))
        // Continue the call chain for setup or assertion detail.
        .status,
      // Execute the next setup or assertion step for this scenario.
      "in_progress",
    );
  });
});
