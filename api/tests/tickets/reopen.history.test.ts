/**
 * T-TKT-11 / P1-47 — reopen clears current resolve/close; keeps prior history.
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import { PrismaClient, TicketStatus } from "@prisma/client";
import dotenv from "dotenv";
import {
  closeMaintenanceTicket,
  reopenMaintenanceTicket,
  resolveMaintenanceTicket,
} from "../../src/services/maintenance";
import {
  advanceTicketTo,
  cleanupTicketsWorld,
  createTicketsWorld,
  loadTicket,
  reportTicket,
  type TicketsWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

describe("ticket reopen history (T-TKT-11 / P1-47)", () => {
  let world: TicketsWorld;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createTicketsWorld(prisma);
  });

  beforeEach(async () => {
    await prisma.ticketReopenEvent.deleteMany({
      where: { ticket: { locationId: world.locationAId } },
    });
    await prisma.ticketEvent.deleteMany({
      where: { ticket: { locationId: world.locationAId } },
    });
    await prisma.maintenanceTicket.deleteMany({
      where: { locationId: world.locationAId },
    });
  });

  after(async () => {
    if (world) await cleanupTicketsWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("T-TKT-11: reopen clears current fields; prior resolve/close events remain", async () => {
    const { ticket } = await reportTicket(prisma, world);
    await advanceTicketTo(world, ticket.id, "in_progress");

    await resolveMaintenanceTicket({
      ticketId: ticket.id,
      resolvedByEmployeeId: world.technician.employeeId,
      resolutionNotes: "first fix notes",
      commandId: randomUUID(),
    });
    await closeMaintenanceTicket({
      ticketId: ticket.id,
      closedByEmployeeId: world.owner.employeeId,
    });

    const resolveEventsBefore = await prisma.ticketEvent.findMany({
      where: {
        ticketId: ticket.id,
        toStatus: TicketStatus.resolved,
      },
    });
    assert.equal(resolveEventsBefore.length, 1);
    assert.equal(resolveEventsBefore[0]!.actorEmployeeId, world.technician.employeeId);
    assert.equal(resolveEventsBefore[0]!.reason, "first fix notes");

    const closeEventsBefore = await prisma.ticketEvent.findMany({
      where: {
        ticketId: ticket.id,
        toStatus: TicketStatus.closed,
      },
    });
    assert.equal(closeEventsBefore.length, 1);
    assert.equal(closeEventsBefore[0]!.actorEmployeeId, world.owner.employeeId);

    await reopenMaintenanceTicket({
      ticketId: ticket.id,
      reopenedByEmployeeId: world.owner.employeeId,
      reason: "guest reports again",
    });

    const row = await loadTicket(prisma, ticket.id);
    assert.equal(row.status, TicketStatus.in_progress);
    assert.equal(row.resolvedAt, null);
    assert.equal(row.resolvedByEmployeeId, null);
    assert.equal(row.resolutionNotes, null);
    assert.equal(row.closedAt, null);
    assert.equal(row.closedByEmployeeId, null);
    assert.equal(row.slaPausedAt, null);

    const resolveEventsAfter = await prisma.ticketEvent.findMany({
      where: {
        ticketId: ticket.id,
        toStatus: TicketStatus.resolved,
      },
    });
    assert.equal(resolveEventsAfter.length, 1);
    assert.equal(resolveEventsAfter[0]!.id, resolveEventsBefore[0]!.id);
    assert.equal(resolveEventsAfter[0]!.reason, "first fix notes");

    const closeEventsAfter = await prisma.ticketEvent.findMany({
      where: {
        ticketId: ticket.id,
        toStatus: TicketStatus.closed,
      },
    });
    assert.equal(closeEventsAfter.length, 1);
    assert.equal(closeEventsAfter[0]!.id, closeEventsBefore[0]!.id);

    const reopenEvents = await prisma.ticketReopenEvent.findMany({
      where: { ticketId: ticket.id },
    });
    assert.equal(reopenEvents.length, 1);
    assert.equal(reopenEvents[0]!.reason, "guest reports again");
    assert.equal(reopenEvents[0]!.previousStatus, TicketStatus.closed);

    const reopenTicketEvents = await prisma.ticketEvent.findMany({
      where: {
        ticketId: ticket.id,
        toStatus: TicketStatus.in_progress,
      },
      orderBy: { occurredAt: "desc" },
    });
    assert.ok(
      reopenTicketEvents.some((e) => {
        const p = e.payload as { reopen?: boolean } | null;
        return p && p.reopen === true;
      }),
    );
  });
});
