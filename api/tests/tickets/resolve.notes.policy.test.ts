/**
 * Blocking / high / urgent tickets require resolution notes.
 */
import assert from "node:assert/strict";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import bindings from node:path.
import path from "node:path";
// Prisma client types/runtime for DB setup and assertions.
import { Priority, PrismaClient } from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import bindings from ../../src/services/maintenance.
import { resolveMaintenanceTicket } from "../../src/services/maintenance";
// Import bindings from ../../src/errors.
import { AppError } from "../../src/errors";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  advanceTicketTo,
  // Execute the next setup or assertion step for this scenario.
  cleanupTicketsWorld,
  // Execute the next setup or assertion step for this scenario.
  createTicketsWorld,
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

// Suite: resolve notes policy.
describe("resolve notes policy", () => {
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

  // Case probes concurrency/isolation: rejects resolve without notes when blocksRoom.
  it("rejects resolve without notes when blocksRoom", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world, {
      // Concurrency/isolation step for the race under test.
      blocksRoom: true,
      // Execute the next setup or assertion step for this scenario.
      priority: Priority.normal,
    });
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "in_progress");
    // Await async work before asserting or releasing locks.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Execute the next setup or assertion step for this scenario.
        resolveMaintenanceTicket({
          // Execute the next setup or assertion step for this scenario.
          ticketId: ticket.id,
          // Execute the next setup or assertion step for this scenario.
          resolvedByEmployeeId: world.technician.employeeId,
          // Execute the next setup or assertion step for this scenario.
          bypassAssigneeCheck: true,
          // Execute the next setup or assertion step for this scenario.
          commandId: randomUUID(),
        }),
      // Execute the next setup or assertion step for this scenario.
      (err: unknown) =>
        // Execute the next setup or assertion step for this scenario.
        err instanceof AppError && err.code === "validation",
    );
  });

  // Case probes concurrency/isolation: accepts resolve with notes when blocksRoom.
  it("accepts resolve with notes when blocksRoom", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world, {
      // Concurrency/isolation step for the race under test.
      blocksRoom: true,
      // Execute the next setup or assertion step for this scenario.
      priority: Priority.normal,
    });
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "in_progress");
    // resolved: synchronize actors so the race window is observable.
    const resolved = await resolveMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      resolvedByEmployeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      bypassAssigneeCheck: true,
      // Execute the next setup or assertion step for this scenario.
      resolutionNotes: "Leak sealed and tested",
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(resolved.status, "resolved");
  });

  // Case probes concurrency/isolation: allows empty notes for non-blocking normal priority.
  it("allows empty notes for non-blocking normal priority", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world, {
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      priority: Priority.normal,
    });
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "in_progress");
    // resolved: synchronize actors so the race window is observable.
    const resolved = await resolveMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      resolvedByEmployeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      bypassAssigneeCheck: true,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(resolved.status, "resolved");
  });
});
