/**
 * P4-T01 — offline sync ticket.assign / close / reopen.
 * Authz mirrors HTTP: assign→tickets.assign, close→tickets.close,
 * reopen→tickets.resolve. Wrong-state → conflict (not 500).
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
  createTicketsWorld,
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  reportTicket,
  // Shape TicketsWorld documents the fixture/response fields this suite touches.
  type TicketsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../tickets/fixtures";

// Suite: sync push ticket.assign / close / reopen.
describe("sync push ticket.assign / close / reopen", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: TicketsWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Execute the next setup or assertion step for this scenario.
  let techToken: string;
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
    techToken = (
      // Await async work before asserting or releasing locks.
      await loginBearer(api, world.technician.email, CLN_PASSWORD)
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
    await prisma.ticketReopenEvent.deleteMany({
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
            in: [world.technician.employeeId, world.manager.employeeId],
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

  // Case checks authz/session policy: technician is forbidden on sync ticket.assign.
  it("technician is forbidden on sync ticket.assign", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // before: synchronize actors so the race window is observable.
    const before = await prisma.maintenanceTicket.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: ticket.id },
    });
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, techToken, "/sync/push", {
      // Execute the next setup or assertion step for this scenario.
      commands: [
        {
          // Execute the next setup or assertion step for this scenario.
          commandId: randomUUID(),
          // Execute the next setup or assertion step for this scenario.
          type: "ticket.assign",
          // Execute the next setup or assertion step for this scenario.
          payload: {
            // Execute the next setup or assertion step for this scenario.
            ticketId: ticket.id,
            // Execute the next setup or assertion step for this scenario.
            assigneeId: world.technician.employeeId,
          },
          // Execute the next setup or assertion step for this scenario.
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Bind result for later setup or assertions in this scope.
    const result = (
      // Execute the next setup or assertion step for this scenario.
      res.body as { results: Array<{ status: string; message?: string }> }
    // Execute the next setup or assertion step for this scenario.
    ).results[0]!;
    // Assert HTTP status matches the contract for this path.
    assert.equal(result.status, "forbidden");
    // Assert the observed value matches the intended post-condition.
    assert.match(result.message ?? "", /tickets\.assign/i);
    // after: synchronize actors so the race window is observable.
    const after = await prisma.maintenanceTicket.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: ticket.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(after.status, before.status);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.assigneeId, before.assigneeId);
  });

  // Case: manager assign → resolve → close → reopen via sync.
  it("manager assign → resolve → close → reopen via sync", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // Assert HTTP status matches the contract for this path.
    assert.equal(ticket.status, "new");

    // assignId: unique stamp so parallel runs do not collide.
    const assignId = randomUUID();
    // assignRes: HTTP response captured for status/body checks.
    const assignRes = await postJson(api, managerToken, "/sync/push", {
      // Execute the next setup or assertion step for this scenario.
      commands: [
        {
          // Execute the next setup or assertion step for this scenario.
          commandId: assignId,
          // Execute the next setup or assertion step for this scenario.
          type: "ticket.assign",
          // Execute the next setup or assertion step for this scenario.
          payload: {
            // Execute the next setup or assertion step for this scenario.
            ticketId: ticket.id,
            // Execute the next setup or assertion step for this scenario.
            assigneeId: world.technician.employeeId,
          },
          // Execute the next setup or assertion step for this scenario.
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      (assignRes.body as { results: Array<{ status: string }> }).results[0]!
        // Continue the call chain for setup or assertion detail.
        .status,
      // Execute the next setup or assertion step for this scenario.
      "ok",
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      (
        // Await async work before asserting or releasing locks.
        await prisma.maintenanceTicket.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: ticket.id },
        })
      // Execute the next setup or assertion step for this scenario.
      ).status,
      // Execute the next setup or assertion step for this scenario.
      "assigned",
    );

    // Idempotent replay of the same assign commandId.
    const replay = await postJson(api, managerToken, "/sync/push", {
      // Execute the next setup or assertion step for this scenario.
      commands: [
        {
          // Execute the next setup or assertion step for this scenario.
          commandId: assignId,
          // Execute the next setup or assertion step for this scenario.
          type: "ticket.assign",
          // Execute the next setup or assertion step for this scenario.
          payload: {
            // Execute the next setup or assertion step for this scenario.
            ticketId: ticket.id,
            // Execute the next setup or assertion step for this scenario.
            assigneeId: world.technician.employeeId,
          },
          // Execute the next setup or assertion step for this scenario.
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Delivery/replay step for async notification paths.
      (replay.body as { results: Array<{ status: string }> }).results[0]!
        // Continue the call chain for setup or assertion detail.
        .status,
      // Execute the next setup or assertion step for this scenario.
      "ok",
    );

    // Mid-lifecycle to resolved via sync (manager bypass).
    const mid = [
      // Execute the next setup or assertion step for this scenario.
      "ticket.start",
      // Execute the next setup or assertion step for this scenario.
      "ticket.resolve",
    // Execute the next setup or assertion step for this scenario.
    ].map((type) => ({
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      type,
      // Execute the next setup or assertion step for this scenario.
      payload: {
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Continue the call chain for setup or assertion detail.
        ...(type === "ticket.resolve"
          ? { resolutionNotes: "offline resolve before close" }
          : {}),
      },
      // Execute the next setup or assertion step for this scenario.
      clientTime: "2026-01-01T00:00:00Z",
    }));
    // midRes: HTTP response captured for status/body checks.
    const midRes = await postJson(api, managerToken, "/sync/push", {
      // Execute the next setup or assertion step for this scenario.
      commands: mid,
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(midRes.status, 200, JSON.stringify(midRes.body));
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      (midRes.body as { results: Array<{ status: string }> }).results.map(
        // Execute the next setup or assertion step for this scenario.
        (r) => r.status,
      ),
      // Execute the next setup or assertion step for this scenario.
      ["ok", "ok"],
    );

    // closeId: unique stamp so parallel runs do not collide.
    const closeId = randomUUID();
    // closeRes: HTTP response captured for status/body checks.
    const closeRes = await postJson(api, managerToken, "/sync/push", {
      // Execute the next setup or assertion step for this scenario.
      commands: [
        {
          // Execute the next setup or assertion step for this scenario.
          commandId: closeId,
          // Execute the next setup or assertion step for this scenario.
          type: "ticket.close",
          // Execute the next setup or assertion step for this scenario.
          payload: { ticketId: ticket.id },
          // Execute the next setup or assertion step for this scenario.
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(closeRes.status, 200, JSON.stringify(closeRes.body));
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      (closeRes.body as { results: Array<{ status: string }> }).results[0]!
        // Continue the call chain for setup or assertion detail.
        .status,
      // Execute the next setup or assertion step for this scenario.
      "ok",
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      (
        // Await async work before asserting or releasing locks.
        await prisma.maintenanceTicket.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: ticket.id },
        })
      // Execute the next setup or assertion step for this scenario.
      ).status,
      // Execute the next setup or assertion step for this scenario.
      "closed",
    );

    // reopenId: unique stamp so parallel runs do not collide.
    const reopenId = randomUUID();
    // reopenRes: HTTP response captured for status/body checks.
    const reopenRes = await postJson(api, managerToken, "/sync/push", {
      // Execute the next setup or assertion step for this scenario.
      commands: [
        {
          // Execute the next setup or assertion step for this scenario.
          commandId: reopenId,
          // Execute the next setup or assertion step for this scenario.
          type: "ticket.reopen",
          // Execute the next setup or assertion step for this scenario.
          payload: { ticketId: ticket.id, reason: "regression" },
          // Execute the next setup or assertion step for this scenario.
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(reopenRes.status, 200, JSON.stringify(reopenRes.body));
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      (reopenRes.body as { results: Array<{ status: string }> }).results[0]!
        // Continue the call chain for setup or assertion detail.
        .status,
      // Execute the next setup or assertion step for this scenario.
      "ok",
    );
    // final: synchronize actors so the race window is observable.
    const final = await prisma.maintenanceTicket.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: ticket.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(final.status, "in_progress");
  });

  // Case: sync close on non-resolved returns conflict (not 500).
  it("sync close on non-resolved returns conflict (not 500)", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "assigned");
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, managerToken, "/sync/push", {
      // Execute the next setup or assertion step for this scenario.
      commands: [
        {
          // Execute the next setup or assertion step for this scenario.
          commandId: randomUUID(),
          // Execute the next setup or assertion step for this scenario.
          type: "ticket.close",
          // Execute the next setup or assertion step for this scenario.
          payload: { ticketId: ticket.id },
          // Execute the next setup or assertion step for this scenario.
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Bind result for later setup or assertions in this scope.
    const result = (
      // Execute the next setup or assertion step for this scenario.
      res.body as {
        // Execute the next setup or assertion step for this scenario.
        results: Array<{ status: string; code?: string; message?: string }>;
      }
    // Execute the next setup or assertion step for this scenario.
    ).results[0]!;
    // Assert HTTP status matches the contract for this path.
    assert.equal(result.status, "conflict");
    // Assert the observed value matches the intended post-condition.
    assert.equal(result.code, "invalid_state");
    // Assert the observed value matches the intended post-condition.
    assert.match(result.message ?? "", /Cannot close ticket/i);
  });

  // Case checks authz/session policy: technician is forbidden on sync ticket.close.
  it("technician is forbidden on sync ticket.close", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "in_progress");
    // Resolve as assignee so status is resolved without needing close grant.
    const resolveRes = await postJson(api, techToken, "/sync/push", {
      // Execute the next setup or assertion step for this scenario.
      commands: [
        {
          // Execute the next setup or assertion step for this scenario.
          commandId: randomUUID(),
          // Execute the next setup or assertion step for this scenario.
          type: "ticket.resolve",
          // Execute the next setup or assertion step for this scenario.
          payload: { ticketId: ticket.id, resolutionNotes: "done" },
          // Execute the next setup or assertion step for this scenario.
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      (resolveRes.body as { results: Array<{ status: string }> }).results[0]!
        // Continue the call chain for setup or assertion detail.
        .status,
      // Execute the next setup or assertion step for this scenario.
      "ok",
    );

    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, techToken, "/sync/push", {
      // Execute the next setup or assertion step for this scenario.
      commands: [
        {
          // Execute the next setup or assertion step for this scenario.
          commandId: randomUUID(),
          // Execute the next setup or assertion step for this scenario.
          type: "ticket.close",
          // Execute the next setup or assertion step for this scenario.
          payload: { ticketId: ticket.id },
          // Execute the next setup or assertion step for this scenario.
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Bind result for later setup or assertions in this scope.
    const result = (
      // Execute the next setup or assertion step for this scenario.
      res.body as { results: Array<{ status: string; message?: string }> }
    // Execute the next setup or assertion step for this scenario.
    ).results[0]!;
    // Assert HTTP status matches the contract for this path.
    assert.equal(result.status, "forbidden");
    // Assert the observed value matches the intended post-condition.
    assert.match(result.message ?? "", /tickets\.close/i);
  });
});
