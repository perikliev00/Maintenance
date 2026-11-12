// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { orderedDatabaseRace } from "../dbBarrier";
/**
 * concurrent assign × start never deadlocks.
 * Mirrors cleaning orderedDatabaseRace (both orderings).
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import { PrismaClient, TicketStatus } from "@prisma/client";
import dotenv from "dotenv";
import {
  assignMaintenanceTicket,
  startMaintenanceTicket,
} from "../../src/services/maintenance";
import {
  advanceTicketTo,
  cleanupTicketsWorld,
  createTicketsWorld,
  errCode,
  isAppError,
  loadTicket,
  reportTicket,
  // Shape TicketsWorld documents the fixture/response fields this suite touches.
  type TicketsWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Helper isPrismaDeadlock: concurrency/isolation coordination.
function isPrismaDeadlock(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  if (code === "P2010" || code === "40P01") return true;
  const message = String((err as { message?: string }).message ?? err);
  return /deadlock|40P01/i.test(message);
}

// Suite: ticket assign × start ordered race.
describe("ticket assign × start ordered race", () => {
  let world: TicketsWorld;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createTicketsWorld(prisma);
  });

  beforeEach(async () => {
    await prisma.ticketReopenEvent.deleteMany({
      where: {
        ticket: {
          locationId: { in: [world.locationAId, world.locationBId] },
        },
      },
    });
    await prisma.ticketEvent.deleteMany({
      where: {
        ticket: {
          locationId: { in: [world.locationAId, world.locationBId] },
        },
      },
    });
    await prisma.maintenanceTicket.deleteMany({
      where: {
        locationId: { in: [world.locationAId, world.locationBId] },
      },
    });
  });

  after(async () => {
    if (world) await cleanupTicketsWorld(prisma, world);
    await prisma.$disconnect();
  });

  for (const startFirst of [true, false]) {
    // Case: ${startFirst ? .
    it(`${startFirst ? "start": "assign"} first never deadlocks`, async () => {
      const { ticket } = await reportTicket(prisma, world);
      await advanceTicketTo(world, ticket.id, "assigned", world.technician.employeeId);

      const start = () =>
        startMaintenanceTicket({
          ticketId: ticket.id,
          actorEmployeeId: world.technician.employeeId,
          commandId: randomUUID(),
        });
      const assign = () =>
        assignMaintenanceTicket({
          ticketId: ticket.id,
          assigneeId: world.technician2.employeeId,
          actorEmployeeId: world.owner.employeeId,
        });

      const ordered = await orderedDatabaseRace(
        prisma,
        (tx) =>
          tx.$queryRaw`SELECT id FROM "MaintenanceTicket" WHERE id = ${ticket.id} FOR UPDATE`,
        startFirst ? start : assign,
        startFirst ? assign : start,
      );
      const settled = startFirst ? ordered : [ordered[1]!, ordered[0]!];
      const startResult = settled[0]!;
      const assignResult = settled[1]!;

      for (const result of [startResult, assignResult]) {
        if (result.status === "rejected") {
          assert.equal(
            isPrismaDeadlock(result.reason),
            false,
            `must not deadlock: ${String(result.reason)}`,
          );
          assert.ok(
            isAppError(result.reason),
            `loser must be structured AppError, got ${String(result.reason)}`,
          );
          assert.ok(
            result.reason.status === 409 || result.reason.status === 403,
            `loser must not be 500, got ${result.reason.status}`,
          );
        }
      }

      const finalTicket = await loadTicket(prisma, ticket.id);

      if (startFirst) {
        assert.equal(startResult.status, "fulfilled");
        assert.equal(finalTicket.status, TicketStatus.in_progress);
        assert.equal(finalTicket.assigneeId, world.technician.employeeId);
        assert.equal(assignResult.status, "rejected");
        assert.ok(isAppError(assignResult.reason));
        const code = errCode(assignResult.reason);
        assert.ok(
          code === "conflict" || code === "invalid_state",
          `assign loser code ${code}`,
        );
      } else {
        assert.equal(assignResult.status, "fulfilled");
        assert.equal(finalTicket.status, TicketStatus.assigned);
        assert.equal(finalTicket.assigneeId, world.technician2.employeeId);
        assert.equal(startResult.status, "rejected");
        assert.ok(isAppError(startResult.reason));
        const code = errCode(startResult.reason);
        assert.ok(
          code === "conflict" ||
            code === "invalid_state" ||
            code === "forbidden",
          `start loser code ${code}`,
        );
      }
    });
  }
});
