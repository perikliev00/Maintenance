/**
 * reopen clears current resolve/close; keeps prior history.
 */
import assert from "node:assert/strict";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import bindings from node:path.
import path from "node:path";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient, TicketStatus } from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  closeMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  reopenMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  resolveMaintenanceTicket,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/maintenance";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  advanceTicketTo,
  // Execute the next setup or assertion step for this scenario.
  cleanupTicketsWorld,
  // Execute the next setup or assertion step for this scenario.
  createTicketsWorld,
  // Execute the next setup or assertion step for this scenario.
  loadTicket,
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

// Suite: ticket reopen history.
describe("ticket reopen history", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: TicketsWorld;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createTicketsWorld(prisma);
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await prisma.ticketReopenEvent.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { ticket: { locationId: world.locationAId } },
    });
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
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupTicketsWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: reopen clears current fields; prior resolve/close events remain.
  it("reopen clears current fields; prior resolve/close events remain", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "in_progress");

    // Await async work before asserting or releasing locks.
    await resolveMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      resolvedByEmployeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      resolutionNotes: "first fix notes",
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Await async work before asserting or releasing locks.
    await closeMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      closedByEmployeeId: world.owner.employeeId,
    });

    // resolveEventsBefore: synchronize actors so the race window is observable.
    const resolveEventsBefore = await prisma.ticketEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        toStatus: TicketStatus.resolved,
      },
    });
    // Assert collection size matches the expected post-condition.
    assert.equal(resolveEventsBefore.length, 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(resolveEventsBefore[0]!.actorEmployeeId, world.technician.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(resolveEventsBefore[0]!.reason, "first fix notes");

    // closeEventsBefore: synchronize actors so the race window is observable.
    const closeEventsBefore = await prisma.ticketEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        toStatus: TicketStatus.closed,
      },
    });
    // Assert collection size matches the expected post-condition.
    assert.equal(closeEventsBefore.length, 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(closeEventsBefore[0]!.actorEmployeeId, world.owner.employeeId);

    // Await async work before asserting or releasing locks.
    await reopenMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      reopenedByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "guest reports again",
    });

    // row: synchronize actors so the race window is observable.
    const row = await loadTicket(prisma, ticket.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal(row.status, TicketStatus.in_progress);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.resolvedAt, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.resolvedByEmployeeId, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.resolutionNotes, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.closedAt, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.closedByEmployeeId, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.slaPausedAt, null);

    // resolveEventsAfter: synchronize actors so the race window is observable.
    const resolveEventsAfter = await prisma.ticketEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        toStatus: TicketStatus.resolved,
      },
    });
    // Assert collection size matches the expected post-condition.
    assert.equal(resolveEventsAfter.length, 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(resolveEventsAfter[0]!.id, resolveEventsBefore[0]!.id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(resolveEventsAfter[0]!.reason, "first fix notes");

    // closeEventsAfter: synchronize actors so the race window is observable.
    const closeEventsAfter = await prisma.ticketEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        toStatus: TicketStatus.closed,
      },
    });
    // Assert collection size matches the expected post-condition.
    assert.equal(closeEventsAfter.length, 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(closeEventsAfter[0]!.id, closeEventsBefore[0]!.id);

    // reopenEvents: synchronize actors so the race window is observable.
    const reopenEvents = await prisma.ticketReopenEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { ticketId: ticket.id },
    });
    // Assert collection size matches the expected post-condition.
    assert.equal(reopenEvents.length, 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(reopenEvents[0]!.reason, "guest reports again");
    // Assert the observed value matches the intended post-condition.
    assert.equal(reopenEvents[0]!.previousStatus, TicketStatus.closed);

    // reopenTicketEvents: synchronize actors so the race window is observable.
    const reopenTicketEvents = await prisma.ticketEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        toStatus: TicketStatus.in_progress,
      },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { occurredAt: "desc" },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      reopenTicketEvents.some((e) => {
        // Bind p for later setup or assertions in this scope.
        const p = e.payload as { reopen?: boolean } | null;
        // Return the arranged value/result to the caller.
        return p && p.reopen === true;
      }),
    );
  });
});
