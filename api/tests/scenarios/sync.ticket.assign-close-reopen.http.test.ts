/**
 * P4-T01 — offline sync ticket.assign / close / reopen.
 * Authz mirrors HTTP: assign→tickets.assign, close→tickets.close,
 * reopen→tickets.resolve. Wrong-state → conflict (not 500).
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, listenApp, loginBearer, postJson } from "../httpHarness";
import {
  advanceTicketTo,
  cleanupTicketsWorld,
  createTicketsWorld,
  CLN_PASSWORD,
  reportTicket,
  // Shape TicketsWorld documents the fixture/response fields this suite touches.
  type TicketsWorld,
} from "../tickets/fixtures";

// Suite: sync push ticket.assign / close / reopen.
describe("sync push ticket.assign / close / reopen", () => {
  let world: TicketsWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let techToken: string;
  let managerToken: string;

  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    world = await createTicketsWorld(prisma);
    ({ api, server } = await listenApp());
    techToken = (
      await loginBearer(api, world.technician.email, CLN_PASSWORD)
    ).token;
    managerToken = (
      await loginBearer(api, world.manager.email, CLN_PASSWORD)
    ).token;
  });

  beforeEach(async () => {
    await prisma.ticketEvent.deleteMany({
      where: { ticket: { locationId: world.locationAId } },
    });
    await prisma.ticketReopenEvent.deleteMany({
      where: { ticket: { locationId: world.locationAId } },
    });
    await prisma.maintenanceTicket.deleteMany({
      where: { locationId: world.locationAId },
    });
    await prisma.syncRun.deleteMany({
      where: {
        user: {
          employeeId: {
            in: [world.technician.employeeId, world.manager.employeeId],
          },
        },
      },
    });
  });

  after(async () => {
    if (server) await closeServer(server);
    if (world) {
      await prisma.syncRun.deleteMany({
        where: { user: { employeeId: { in: world.employeeIds } } },
      });
      await cleanupTicketsWorld(prisma, world);
    }
    await prisma.$disconnect();
  });

  // Case checks authz/session policy: technician is forbidden on sync ticket.assign.
  it("technician is forbidden on sync ticket.assign", async () => {
    const { ticket } = await reportTicket(prisma, world);
    const before = await prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    const res = await postJson(api, techToken, "/sync/push", {
      commands: [
        {
          commandId: randomUUID(),
          type: "ticket.assign",
          payload: {
            ticketId: ticket.id,
            assigneeId: world.technician.employeeId,
          },
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const result = (
      res.body as { results: Array<{ status: string; message?: string }> }
    ).results[0]!;
    assert.equal(result.status, "forbidden");
    assert.match(result.message ?? "", /tickets\.assign/i);
    const after = await prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    assert.equal(after.status, before.status);
    assert.equal(after.assigneeId, before.assigneeId);
  });

  // Case: manager assign → resolve → close → reopen via sync.
  it("manager assign → resolve → close → reopen via sync", async () => {
    const { ticket } = await reportTicket(prisma, world);
    assert.equal(ticket.status, "new");

    const assignId = randomUUID();
    const assignRes = await postJson(api, managerToken, "/sync/push", {
      commands: [
        {
          commandId: assignId,
          type: "ticket.assign",
          payload: {
            ticketId: ticket.id,
            assigneeId: world.technician.employeeId,
          },
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));
    assert.equal(
      (assignRes.body as { results: Array<{ status: string }> }).results[0]!
        .status,
      "ok",
    );
    assert.equal(
      (
        await prisma.maintenanceTicket.findUniqueOrThrow({
          where: { id: ticket.id },
        })
      ).status,
      "assigned",
    );

    // Idempotent replay of the same assign commandId.
    const replay = await postJson(api, managerToken, "/sync/push", {
      commands: [
        {
          commandId: assignId,
          type: "ticket.assign",
          payload: {
            ticketId: ticket.id,
            assigneeId: world.technician.employeeId,
          },
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    assert.equal(
      (replay.body as { results: Array<{ status: string }> }).results[0]!
        .status,
      "ok",
    );

    // Mid-lifecycle to resolved via sync (manager bypass).
    const mid = [
      "ticket.start",
      "ticket.resolve",
    ].map((type) => ({
      commandId: randomUUID(),
      type,
      payload: {
        ticketId: ticket.id,
        ...(type === "ticket.resolve"
          ? { resolutionNotes: "offline resolve before close" }
          : {}),
      },
      clientTime: "2026-01-01T00:00:00Z",
    }));
    const midRes = await postJson(api, managerToken, "/sync/push", {
      commands: mid,
    });
    assert.equal(midRes.status, 200, JSON.stringify(midRes.body));
    assert.deepEqual(
      (midRes.body as { results: Array<{ status: string }> }).results.map(
        (r) => r.status,
      ),
      ["ok", "ok"],
    );

    const closeId = randomUUID();
    const closeRes = await postJson(api, managerToken, "/sync/push", {
      commands: [
        {
          commandId: closeId,
          type: "ticket.close",
          payload: { ticketId: ticket.id },
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    assert.equal(closeRes.status, 200, JSON.stringify(closeRes.body));
    assert.equal(
      (closeRes.body as { results: Array<{ status: string }> }).results[0]!
        .status,
      "ok",
    );
    assert.equal(
      (
        await prisma.maintenanceTicket.findUniqueOrThrow({
          where: { id: ticket.id },
        })
      ).status,
      "closed",
    );

    const reopenId = randomUUID();
    const reopenRes = await postJson(api, managerToken, "/sync/push", {
      commands: [
        {
          commandId: reopenId,
          type: "ticket.reopen",
          payload: { ticketId: ticket.id, reason: "regression" },
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    assert.equal(reopenRes.status, 200, JSON.stringify(reopenRes.body));
    assert.equal(
      (reopenRes.body as { results: Array<{ status: string }> }).results[0]!
        .status,
      "ok",
    );
    const final = await prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    assert.equal(final.status, "in_progress");
  });

  // Case: sync close on non-resolved returns conflict (not 500).
  it("sync close on non-resolved returns conflict (not 500)", async () => {
    const { ticket } = await reportTicket(prisma, world);
    await advanceTicketTo(world, ticket.id, "assigned");
    const res = await postJson(api, managerToken, "/sync/push", {
      commands: [
        {
          commandId: randomUUID(),
          type: "ticket.close",
          payload: { ticketId: ticket.id },
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const result = (
      res.body as {
        results: Array<{ status: string; code?: string; message?: string }>;
      }
    ).results[0]!;
    assert.equal(result.status, "conflict");
    assert.equal(result.code, "invalid_state");
    assert.match(result.message ?? "", /Cannot close ticket/i);
  });

  // Case checks authz/session policy: technician is forbidden on sync ticket.close.
  it("technician is forbidden on sync ticket.close", async () => {
    const { ticket } = await reportTicket(prisma, world);
    await advanceTicketTo(world, ticket.id, "in_progress");
    // Resolve as assignee so status is resolved without needing close grant.
    const resolveRes = await postJson(api, techToken, "/sync/push", {
      commands: [
        {
          commandId: randomUUID(),
          type: "ticket.resolve",
          payload: { ticketId: ticket.id, resolutionNotes: "done" },
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    assert.equal(
      (resolveRes.body as { results: Array<{ status: string }> }).results[0]!
        .status,
      "ok",
    );

    const res = await postJson(api, techToken, "/sync/push", {
      commands: [
        {
          commandId: randomUUID(),
          type: "ticket.close",
          payload: { ticketId: ticket.id },
          clientTime: "2026-01-01T00:00:00Z",
        },
      ],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const result = (
      res.body as { results: Array<{ status: string; message?: string }> }
    ).results[0]!;
    assert.equal(result.status, "forbidden");
    assert.match(result.message ?? "", /tickets\.close/i);
  });
});
