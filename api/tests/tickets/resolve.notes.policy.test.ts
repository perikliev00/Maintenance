/**
 * Blocking / high / urgent tickets require resolution notes.
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import { Priority, PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { resolveMaintenanceTicket } from "../../src/services/maintenance";
import { AppError } from "../../src/errors";
import {
  advanceTicketTo,
  cleanupTicketsWorld,
  createTicketsWorld,
  reportTicket,
  type TicketsWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

describe("resolve notes policy", () => {
  let world: TicketsWorld;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createTicketsWorld(prisma);
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
    if (world) await cleanupTicketsWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("rejects resolve without notes when blocksRoom", async () => {
    const { ticket } = await reportTicket(prisma, world, {
      blocksRoom: true,
      priority: Priority.normal,
    });
    await advanceTicketTo(world, ticket.id, "in_progress");
    await assert.rejects(
      () =>
        resolveMaintenanceTicket({
          ticketId: ticket.id,
          resolvedByEmployeeId: world.technician.employeeId,
          bypassAssigneeCheck: true,
          commandId: randomUUID(),
        }),
      (err: unknown) =>
        err instanceof AppError && err.code === "validation",
    );
  });

  it("accepts resolve with notes when blocksRoom", async () => {
    const { ticket } = await reportTicket(prisma, world, {
      blocksRoom: true,
      priority: Priority.normal,
    });
    await advanceTicketTo(world, ticket.id, "in_progress");
    const resolved = await resolveMaintenanceTicket({
      ticketId: ticket.id,
      resolvedByEmployeeId: world.technician.employeeId,
      bypassAssigneeCheck: true,
      resolutionNotes: "Leak sealed and tested",
      commandId: randomUUID(),
    });
    assert.equal(resolved.status, "resolved");
  });

  it("allows empty notes for non-blocking normal priority", async () => {
    const { ticket } = await reportTicket(prisma, world, {
      blocksRoom: false,
      priority: Priority.normal,
    });
    await advanceTicketTo(world, ticket.id, "in_progress");
    const resolved = await resolveMaintenanceTicket({
      ticketId: ticket.id,
      resolvedByEmployeeId: world.technician.employeeId,
      bypassAssigneeCheck: true,
      commandId: randomUUID(),
    });
    assert.equal(resolved.status, "resolved");
  });
});
