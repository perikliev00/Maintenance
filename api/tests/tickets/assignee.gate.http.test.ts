/**
 * non-assignee without bypass cannot wait/resume/resolve.
 */
import assert from "node:assert/strict";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import bindings from node:path.
import path from "node:path";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient } from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
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
  listenApp,
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  postJson,
  // Execute the next setup or assertion step for this scenario.
  reportTicket,
  // Shape TicketsWorld documents the fixture/response fields this suite touches.
  type TicketsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Execute the next setup or assertion step for this scenario.
dotenv.config({
  // Execute the next setup or assertion step for this scenario.
  path: path.resolve(__dirname, "../../.env"),
  // Execute the next setup or assertion step for this scenario.
  override: true,
});

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: ticket assignee gate.
describe("ticket assignee gate", () => {
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
  let ownerToken: string;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createTicketsWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
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
    // Await async work before asserting or releasing locks.
    ownerToken = (await loginBearer(api, world.owner.email, CLN_PASSWORD)).token;
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
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupTicketsWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: foreign tech denied start/wait/resume/resolve; assignee and owner bypass OK.
  it("foreign tech denied start/wait/resume/resolve; assignee and owner bypass OK", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "assigned");

    // deniedStart: HTTP response captured for status/body checks.
    const deniedStart = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      techBToken,
      // Execute the next setup or assertion step for this scenario.
      `/maintenance/tickets/${ticket.id}/start`,
      // Execute the next setup or assertion step for this scenario.
      { commandId: randomUUID() },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(deniedStart.status, 403);
    assert.equal(await countTicketEvents(prisma, ticket.id), 2); // create+assign

    // Assignee can start
    const okStart = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      techAToken,
      // Execute the next setup or assertion step for this scenario.
      `/maintenance/tickets/${ticket.id}/start`,
      // Execute the next setup or assertion step for this scenario.
      { commandId: randomUUID() },
    );
    // Assert HTTP status matches the contract for this path.
    assert.ok(okStart.status === 200 || okStart.status === 201);

    // eventsAfterStart: synchronize actors so the race window is observable.
    const eventsAfterStart = await countTicketEvents(prisma, ticket.id);

    // deniedWait: HTTP response captured for status/body checks.
    const deniedWait = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      techBToken,
      // Execute the next setup or assertion step for this scenario.
      `/maintenance/tickets/${ticket.id}/wait`,
      // Execute the next setup or assertion step for this scenario.
      { commandId: randomUUID(), reason: "parts" },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(deniedWait.status, 403);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsAfterStart);

    // Owner bypass can wait
    const ownerWait = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      `/maintenance/tickets/${ticket.id}/wait`,
      // Execute the next setup or assertion step for this scenario.
      { commandId: randomUUID(), reason: "owner hold" },
    );
    // Assert HTTP status matches the contract for this path.
    assert.ok(ownerWait.status === 200 || ownerWait.status === 201);

    // eventsAfterWait: synchronize actors so the race window is observable.
    const eventsAfterWait = await countTicketEvents(prisma, ticket.id);

    // deniedResume: HTTP response captured for status/body checks.
    const deniedResume = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      techBToken,
      // Execute the next setup or assertion step for this scenario.
      `/maintenance/tickets/${ticket.id}/resume`,
      // Execute the next setup or assertion step for this scenario.
      { commandId: randomUUID() },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(deniedResume.status, 403);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsAfterWait);

    // okResume: HTTP response captured for status/body checks.
    const okResume = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      techAToken,
      // Execute the next setup or assertion step for this scenario.
      `/maintenance/tickets/${ticket.id}/resume`,
      // Execute the next setup or assertion step for this scenario.
      { commandId: randomUUID() },
    );
    // Assert HTTP status matches the contract for this path.
    assert.ok(okResume.status === 200 || okResume.status === 201);

    // eventsAfterResume: synchronize actors so the race window is observable.
    const eventsAfterResume = await countTicketEvents(prisma, ticket.id);

    // deniedResolve: HTTP response captured for status/body checks.
    const deniedResolve = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      techBToken,
      // Execute the next setup or assertion step for this scenario.
      `/maintenance/tickets/${ticket.id}/resolve`,
      // Execute the next setup or assertion step for this scenario.
      { commandId: randomUUID(), resolutionNotes: "nope" },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(deniedResolve.status, 403);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsAfterResume);

    // Supervisor/owner bypass resolve
    const ownerResolve = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      `/maintenance/tickets/${ticket.id}/resolve`,
      // Execute the next setup or assertion step for this scenario.
      { commandId: randomUUID(), resolutionNotes: "owner fixed" },
    );
    // Assert HTTP status matches the contract for this path.
    assert.ok(ownerResolve.status === 200 || ownerResolve.status === 201);
  });
});
