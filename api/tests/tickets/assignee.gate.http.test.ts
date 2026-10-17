/**
 * T-TKT-03 / P1-39 — non-assignee without bypass cannot wait/resume/resolve.
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import {
  advanceTicketTo,
  cleanupTicketsWorld,
  countTicketEvents,
  createTicketsWorld,
  CLN_PASSWORD,
  listenApp,
  closeServer,
  loginBearer,
  postJson,
  reportTicket,
  type TicketsWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

describe("ticket assignee gate (T-TKT-03 / P1-39)", () => {
  let world: TicketsWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let techAToken: string;
  let techBToken: string;
  let ownerToken: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createTicketsWorld(prisma);
    ({ server, api } = await listenApp());
    techAToken = (
      await loginBearer(api, world.technician.email, CLN_PASSWORD)
    ).token;
    techBToken = (
      await loginBearer(api, world.technician2.email, CLN_PASSWORD)
    ).token;
    ownerToken = (await loginBearer(api, world.owner.email, CLN_PASSWORD)).token;
  });

  beforeEach(async () => {
    await prisma.ticketEvent.deleteMany({
      where: { ticket: { locationId: world.locationAId } },
    });
    await prisma.maintenanceTicket.deleteMany({
      where: { locationId: world.locationAId },
    });
  });

  after(async () => {
    if (server) await closeServer(server);
    if (world) await cleanupTicketsWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("T-TKT-03: foreign tech denied start/wait/resume/resolve; assignee and owner bypass OK", async () => {
    const { ticket } = await reportTicket(prisma, world);
    await advanceTicketTo(world, ticket.id, "assigned");

    const deniedStart = await postJson(
      api,
      techBToken,
      `/maintenance/tickets/${ticket.id}/start`,
      { commandId: randomUUID() },
    );
    assert.equal(deniedStart.status, 403);
    assert.equal(await countTicketEvents(prisma, ticket.id), 2); // create+assign

    // Assignee can start
    const okStart = await postJson(
      api,
      techAToken,
      `/maintenance/tickets/${ticket.id}/start`,
      { commandId: randomUUID() },
    );
    assert.ok(okStart.status === 200 || okStart.status === 201);

    const eventsAfterStart = await countTicketEvents(prisma, ticket.id);

    const deniedWait = await postJson(
      api,
      techBToken,
      `/maintenance/tickets/${ticket.id}/wait`,
      { commandId: randomUUID(), reason: "parts" },
    );
    assert.equal(deniedWait.status, 403);
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsAfterStart);

    // Owner bypass can wait
    const ownerWait = await postJson(
      api,
      ownerToken,
      `/maintenance/tickets/${ticket.id}/wait`,
      { commandId: randomUUID(), reason: "owner hold" },
    );
    assert.ok(ownerWait.status === 200 || ownerWait.status === 201);

    const eventsAfterWait = await countTicketEvents(prisma, ticket.id);

    const deniedResume = await postJson(
      api,
      techBToken,
      `/maintenance/tickets/${ticket.id}/resume`,
      { commandId: randomUUID() },
    );
    assert.equal(deniedResume.status, 403);
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsAfterWait);

    const okResume = await postJson(
      api,
      techAToken,
      `/maintenance/tickets/${ticket.id}/resume`,
      { commandId: randomUUID() },
    );
    assert.ok(okResume.status === 200 || okResume.status === 201);

    const eventsAfterResume = await countTicketEvents(prisma, ticket.id);

    const deniedResolve = await postJson(
      api,
      techBToken,
      `/maintenance/tickets/${ticket.id}/resolve`,
      { commandId: randomUUID(), resolutionNotes: "nope" },
    );
    assert.equal(deniedResolve.status, 403);
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsAfterResume);

    // Supervisor/owner bypass resolve
    const ownerResolve = await postJson(
      api,
      ownerToken,
      `/maintenance/tickets/${ticket.id}/resolve`,
      { commandId: randomUUID(), resolutionNotes: "owner fixed" },
    );
    assert.ok(ownerResolve.status === 200 || ownerResolve.status === 201);
  });
});
