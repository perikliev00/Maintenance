// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { orderedDatabaseRace } from "../dbBarrier";
/**
 * concurrent assign × start never deadlocks.
 * Mirrors cleaning orderedDatabaseRace (both orderings).
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
  assignMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  startMaintenanceTicket,
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
  errCode,
  // Execute the next setup or assertion step for this scenario.
  isAppError,
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

// Helper isPrismaDeadlock: concurrency/isolation coordination.
function isPrismaDeadlock(err: unknown): boolean {
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!err || typeof err !== "object") return false;
  // Bind code for later setup or assertions in this scope.
  const code = (err as { code?: string }).code;
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (code === "P2010" || code === "40P01") return true;
  // Bind message for later setup or assertions in this scope.
  const message = String((err as { message?: string }).message ?? err);
  // Return the arranged value/result to the caller.
  return /deadlock|40P01/i.test(message);
}

// Suite: ticket assign × start ordered race.
describe("ticket assign × start ordered race", () => {
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
      where: {
        // Execute the next setup or assertion step for this scenario.
        ticket: {
          // Execute the next setup or assertion step for this scenario.
          locationId: { in: [world.locationAId, world.locationBId] },
        },
      },
    });
    // Await async work before asserting or releasing locks.
    await prisma.ticketEvent.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        ticket: {
          // Execute the next setup or assertion step for this scenario.
          locationId: { in: [world.locationAId, world.locationBId] },
        },
      },
    });
    // Await async work before asserting or releasing locks.
    await prisma.maintenanceTicket.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: { in: [world.locationAId, world.locationBId] },
      },
    });
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupTicketsWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Iterate to cover variants or wait until a condition holds.
  for (const startFirst of [true, false]) {
    // Case: ${startFirst ? .
    it(`${startFirst ? "start": "assign"} first never deadlocks`, async () => {
      // Await async work before asserting or releasing locks.
      const { ticket } = await reportTicket(prisma, world);
      // Await async work before asserting or releasing locks.
      await advanceTicketTo(world, ticket.id, "assigned", world.technician.employeeId);

      // Bind start for later setup or assertions in this scope.
      const start = () =>
        // Execute the next setup or assertion step for this scenario.
        startMaintenanceTicket({
          // Execute the next setup or assertion step for this scenario.
          ticketId: ticket.id,
          // Execute the next setup or assertion step for this scenario.
          actorEmployeeId: world.technician.employeeId,
          // Execute the next setup or assertion step for this scenario.
          commandId: randomUUID(),
        });
      // Bind assign for later setup or assertions in this scope.
      const assign = () =>
        // Execute the next setup or assertion step for this scenario.
        assignMaintenanceTicket({
          // Execute the next setup or assertion step for this scenario.
          ticketId: ticket.id,
          // Execute the next setup or assertion step for this scenario.
          assigneeId: world.technician2.employeeId,
          // Execute the next setup or assertion step for this scenario.
          actorEmployeeId: world.owner.employeeId,
        });

      // ordered: synchronize actors so the race window is observable.
      const ordered = await orderedDatabaseRace(
        // Execute the next setup or assertion step for this scenario.
        prisma,
        // Execute the next setup or assertion step for this scenario.
        (tx) =>
          // Execute the next setup or assertion step for this scenario.
          tx.$queryRaw`SELECT id FROM "MaintenanceTicket" WHERE id = ${ticket.id} FOR UPDATE`,
        // Execute the next setup or assertion step for this scenario.
        startFirst ? start : assign,
        // Execute the next setup or assertion step for this scenario.
        startFirst ? assign : start,
      );
      // Bind settled for later setup or assertions in this scope.
      const settled = startFirst ? ordered : [ordered[1]!, ordered[0]!];
      // Bind startResult for later setup or assertions in this scope.
      const startResult = settled[0]!;
      // Bind assignResult for later setup or assertions in this scope.
      const assignResult = settled[1]!;

      // Iterate to cover variants or wait until a condition holds.
      for (const result of [startResult, assignResult]) {
        // Guard optional cleanup or alternate assertion paths.
        if (result.status === "rejected") {
          // Assert the observed value matches the intended post-condition.
          assert.equal(
            // Concurrency/isolation step for the race under test.
            isPrismaDeadlock(result.reason),
            // Execute the next setup or assertion step for this scenario.
            false,
            // Concurrency/isolation step for the race under test.
            `must not deadlock: ${String(result.reason)}`,
          );
          // Assert the observed value matches the intended post-condition.
          assert.ok(
            // Execute the next setup or assertion step for this scenario.
            isAppError(result.reason),
            // Execute the next setup or assertion step for this scenario.
            `loser must be structured AppError, got ${String(result.reason)}`,
          );
          // Assert the observed value matches the intended post-condition.
          assert.ok(
            // Execute the next setup or assertion step for this scenario.
            result.reason.status === 409 || result.reason.status === 403,
            // Execute the next setup or assertion step for this scenario.
            `loser must not be 500, got ${result.reason.status}`,
          );
        }
      }

      // finalTicket: synchronize actors so the race window is observable.
      const finalTicket = await loadTicket(prisma, ticket.id);

      // Conditional path for setup, cleanup, or alternate outcomes.
      if (startFirst) {
        // Assert HTTP status matches the contract for this path.
        assert.equal(startResult.status, "fulfilled");
        // Assert HTTP status matches the contract for this path.
        assert.equal(finalTicket.status, TicketStatus.in_progress);
        // Assert the observed value matches the intended post-condition.
        assert.equal(finalTicket.assigneeId, world.technician.employeeId);
        // Assert HTTP status matches the contract for this path.
        assert.equal(assignResult.status, "rejected");
        // Assert the observed value matches the intended post-condition.
        assert.ok(isAppError(assignResult.reason));
        // Bind code for later setup or assertions in this scope.
        const code = errCode(assignResult.reason);
        // Assert the observed value matches the intended post-condition.
        assert.ok(
          // Execute the next setup or assertion step for this scenario.
          code === "conflict" || code === "invalid_state",
          // Execute the next setup or assertion step for this scenario.
          `assign loser code ${code}`,
        );
      // Execute the next setup or assertion step for this scenario.
      } else {
        // Assert HTTP status matches the contract for this path.
        assert.equal(assignResult.status, "fulfilled");
        // Assert HTTP status matches the contract for this path.
        assert.equal(finalTicket.status, TicketStatus.assigned);
        // Assert the observed value matches the intended post-condition.
        assert.equal(finalTicket.assigneeId, world.technician2.employeeId);
        // Assert HTTP status matches the contract for this path.
        assert.equal(startResult.status, "rejected");
        // Assert the observed value matches the intended post-condition.
        assert.ok(isAppError(startResult.reason));
        // Bind code for later setup or assertions in this scope.
        const code = errCode(startResult.reason);
        // Assert the observed value matches the intended post-condition.
        assert.ok(
          // Execute the next setup or assertion step for this scenario.
          code === "conflict" ||
            // Execute the next setup or assertion step for this scenario.
            code === "invalid_state" ||
            // Execute the next setup or assertion step for this scenario.
            code === "forbidden",
          // Execute the next setup or assertion step for this scenario.
          `start loser code ${code}`,
        );
      }
    });
  }
});
