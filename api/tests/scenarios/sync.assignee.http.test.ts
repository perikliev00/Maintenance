/**
 * AUDIT-003 regression — assignee gate parity for /sync/push ticket lifecycle.
 * REST coverage lives in assignee.gate.http.test.ts; this suite proves the
 * offline sync adapters forward canBypassTicketAssignee correctly.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { prisma } from "../../src/db";
import { assertTestDatabase } from "../assertTestDatabase";
import { closeServer, listenApp, loginBearer, postJson } from "../httpHarness";
import {
  advanceTicketTo,
  cleanupTicketsWorld,
  countTicketEvents,
  createTicketsWorld,
  CLN_PASSWORD,
  reportTicket,
  type TicketsWorld,
} from "../tickets/fixtures";

describe("sync push ticket assignee gate (AUDIT-003)", () => {
  let world: TicketsWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let techAToken: string;
  let techBToken: string;
  let managerToken: string;

  before(async () => {
    await assertTestDatabase(prisma);
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    world = await createTicketsWorld(prisma);
    ({ api, server } = await listenApp());
    techAToken = (
      await loginBearer(api, world.technician.email, CLN_PASSWORD)
    ).token;
    techBToken = (
      await loginBearer(api, world.technician2.email, CLN_PASSWORD)
    ).token;
    managerToken = (
      await loginBearer(api, world.manager.email, CLN_PASSWORD)
    ).token;
  });

  beforeEach(async () => {
    await prisma.ticketEvent.deleteMany({
      where: { ticket: { locationId: world.locationAId } },
    });
    await prisma.maintenanceTicket.deleteMany({
      where: { locationId: world.locationAId },
    });
    await prisma.syncRun.deleteMany({
      where: {
        user: {
          employeeId: {
            in: [
              world.technician.employeeId,
              world.technician2.employeeId,
              world.manager.employeeId,
            ],
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

  it("foreign technician is forbidden on sync ticket.start; ticket graph unchanged", async () => {
    const { ticket } = await reportTicket(prisma, world);
    await advanceTicketTo(world, ticket.id, "assigned");
    const before = await prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    const eventsBefore = await countTicketEvents(prisma, ticket.id);

    const cmd = {
      commandId: randomUUID(),
      type: "ticket.start",
      payload: { ticketId: ticket.id },
      clientTime: "2026-01-01T00:00:00Z",
    };
    const res = await postJson(api, techBToken, "/sync/push", {
      commands: [cmd],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const result = (res.body as { results: Array<{ status: string; message?: string }> }).results[0];
    // Technicians are scoped to assigned_tickets, so a foreign tech is denied
    // at assertCanAccessTicket (same 403 class as REST). Either scope or
    // assignee-gate wording is an acceptable denial; "ok" is not.
    assert.equal(result.status, "forbidden");
    assert.match(
      result.message ?? "",
      /assigned to another employee|Outside your permitted data scope/i,
    );

    const after = await prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    assert.equal(after.status, before.status);
    assert.equal(after.assigneeId, before.assigneeId);
    assert.deepEqual(after.updatedAt, before.updatedAt);
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsBefore);
  });

  it("manager bypasses assignee via sync start/wait/resume/resolve", async () => {
    const { ticket } = await reportTicket(prisma, world);
    await advanceTicketTo(world, ticket.id, "assigned");
    assert.equal(
      (await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticket.id } }))
        .assigneeId,
      world.technician.employeeId,
    );

    const batch = ["ticket.start", "ticket.wait", "ticket.resume", "ticket.resolve"].map(
      (type) => ({
        commandId: randomUUID(),
        type,
        payload: {
          ticketId: ticket.id,
          ...(type === "ticket.wait" ? { reason: "parts" } : {}),
          ...(type === "ticket.resolve"
            ? { resolutionNotes: "manager offline resolve" }
            : {}),
        },
        clientTime: "2026-01-01T00:00:00Z",
      }),
    );

    const res = await postJson(api, managerToken, "/sync/push", {
      commands: batch,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const results = (res.body as { results: Array<{ status: string; data?: { status: string } }> })
      .results;
    assert.deepEqual(
      results.map((r) => r.status),
      ["ok", "ok", "ok", "ok"],
    );
    assert.deepEqual(
      results.map((r) => r.data?.status),
      ["in_progress", "waiting", "in_progress", "resolved"],
    );

    const final = await prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    assert.equal(final.status, "resolved");
    assert.equal(final.assigneeId, world.technician.employeeId);

    const lifecycleEvents = await prisma.ticketEvent.findMany({
      where: { ticketId: ticket.id, commandId: { in: batch.map((c) => c.commandId) } },
      orderBy: { occurredAt: "asc" },
    });
    assert.equal(lifecycleEvents.length, 4);
  });

  it("assignee can still progress own ticket via sync (non-bypass control)", async () => {
    const { ticket } = await reportTicket(prisma, world);
    await advanceTicketTo(world, ticket.id, "assigned");
    const cmd = {
      commandId: randomUUID(),
      type: "ticket.start",
      payload: { ticketId: ticket.id },
      clientTime: "2026-01-01T00:00:00Z",
    };
    const res = await postJson(api, techAToken, "/sync/push", { commands: [cmd] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(
      (res.body as { results: Array<{ status: string; data?: { status: string } }> })
        .results[0].status,
      "ok",
    );
    assert.equal(
      (await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticket.id } }))
        .status,
      "in_progress",
    );
  });
});
