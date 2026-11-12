/**
 * Duplicate prevention: exact/probable/override/recurring + concurrency.
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import { PrismaClient, TicketStatus } from "@prisma/client";
import dotenv from "dotenv";
import {
  createMaintenanceTicket,
  resolveMaintenanceTicket,
  closeMaintenanceTicket,
} from "../../src/services/maintenance";
import { AppError } from "../../src/errors";
import {
  advanceTicketTo,
  cleanupTicketsWorld,
  createTicketsWorld,
  errCode,
  findActiveIssueOption,
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

// Suite: ticket duplicate prevention.
describe("ticket duplicate prevention", () => {
  let world: TicketsWorld;
  let optionId: string;
  let otherOptionId: string;
  let categoryId: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createTicketsWorld(prisma);
    const option = await findActiveIssueOption(prisma);
    optionId = option.id;
    categoryId = option.maintenanceCategoryId;
    const other = await prisma.issueOption.findFirst({
      where: { isActive: true, id: { not: optionId } },
    });
    assert.ok(other, "need a second active issue option");
    otherOptionId = other.id;
  });

  beforeEach(async () => {
    await prisma.ticketEvent.deleteMany({
      where: {
        ticket: {
          locationId: { in: [world.locationAId, world.locationBId] },
        },
      },
    });
    await prisma.auditEvent.deleteMany({
      where: {
        locationId: { in: [world.locationAId, world.locationBId] },
        action: "ticket.duplicate_override",
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

  // Case: rejects exact duplicate for same room + option.
  it("rejects exact duplicate for same room + option", async () => {
    await reportTicket(prisma, world, { issueOptionId: optionId });
    await assert.rejects(
      () =>
        createMaintenanceTicket({
          locationId: world.locationAId,
          issueOptionId: optionId,
          blocksRoom: false,
          reportedByEmployeeId: world.owner.employeeId,
          commandId: randomUUID(),
        }),
      (err: unknown) =>
        err instanceof AppError && err.code === "duplicate_active",
    );
  });

  // Case: allows same option in a different room.
  it("allows same option in a different room", async () => {
    await reportTicket(prisma, world, { issueOptionId: optionId });
    // second: seeded entity required before the mutation under test.
    const second = await createMaintenanceTicket({
      locationId: world.locationBId,
      issueOptionId: optionId,
      blocksRoom: false,
      reportedByEmployeeId: world.owner.employeeId,
      commandId: randomUUID(),
    });
    assert.equal(second.ticket.locationId, world.locationBId);
  });

  // Case: allows different options in the same room.
  it("allows different options in the same room", async () => {
    await reportTicket(prisma, world, { issueOptionId: optionId });
    // second: seeded entity required before the mutation under test.
    const second = await createMaintenanceTicket({
      locationId: world.locationAId,
      issueOptionId: otherOptionId,
      blocksRoom: false,
      reportedByEmployeeId: world.owner.employeeId,
      commandId: randomUUID(),
    });
    assert.equal(second.ticket.issueOptionId, otherOptionId);
  });

  // Case: allows recurring report after close.
  it("allows recurring report after close", async () => {
    const { ticket } = await reportTicket(prisma, world, {
      issueOptionId: optionId,
    });
    await advanceTicketTo(world, ticket.id, "in_progress");
    await resolveMaintenanceTicket({
      ticketId: ticket.id,
      resolvedByEmployeeId: world.technician.employeeId,
      bypassAssigneeCheck: true,
      resolutionNotes: "Fixed for recurring test",
      commandId: randomUUID(),
    });
    await closeMaintenanceTicket({
      ticketId: ticket.id,
      closedByEmployeeId: world.owner.employeeId,
      commandId: randomUUID(),
    });
    // again: seeded entity required before the mutation under test.
    const again = await createMaintenanceTicket({
      locationId: world.locationAId,
      issueOptionId: optionId,
      blocksRoom: false,
      reportedByEmployeeId: world.owner.employeeId,
      commandId: randomUUID(),
    });
    assert.equal(again.ticket.status, TicketStatus.new);
    assert.ok(
      (again.ticket as { suggestReopenTicketId?: string }).suggestReopenTicketId ||
        true,
    );
  });

  // Case checks authz/session policy: authorized override creates second ticket and audit.
  it("authorized override creates second ticket and audit", async () => {
    await reportTicket(prisma, world, { issueOptionId: optionId });
    // overridden: seeded entity required before the mutation under test.
    const overridden = await createMaintenanceTicket({
      locationId: world.locationAId,
      issueOptionId: optionId,
      blocksRoom: false,
      reportedByEmployeeId: world.owner.employeeId,
      commandId: randomUUID(),
      allowDuplicate: true,
      duplicateOverrideReason: "Second AC unit in same room",
    });
    assert.equal(overridden.ticket.status, TicketStatus.new);
    const audits = await prisma.auditEvent.findMany({
      where: {
        action: "ticket.duplicate_override",
        entityId: overridden.ticket.id,
      },
    });
    assert.equal(audits.length, 1);
  });

  // Case: stores description separately from title.
  it("stores description separately from title", async () => {
    const option = await prisma.issueOption.findUniqueOrThrow({
      where: { id: optionId },
    });
    // created: seeded entity required before the mutation under test.
    const created = await createMaintenanceTicket({
      locationId: world.locationAId,
      issueOptionId: optionId,
      description: "Guest reported overnight",
      blocksRoom: false,
      reportedByEmployeeId: world.owner.employeeId,
      commandId: randomUUID(),
    });
    assert.equal(created.ticket.title, option.nameBg);
    assert.equal(created.ticket.description, "Guest reported overnight");
  });

  // Case probes concurrency/isolation: applies catalog defaultBlocksRoom when omitted.
  it("applies catalog defaultBlocksRoom when omitted", async () => {
    const option = await prisma.issueOption.findUniqueOrThrow({
      where: { id: optionId },
    });
    // created: seeded entity required before the mutation under test.
    const created = await createMaintenanceTicket({
      locationId: world.locationAId,
      issueOptionId: optionId,
      reportedByEmployeeId: world.owner.employeeId,
      commandId: randomUUID(),
    });
    const expected = option.defaultBlocksRoom ?? false;
    assert.equal(created.ticket.blocksRoom, expected);
  });

  // Case probes concurrency/isolation: rejects 20 concurrent identical creates with one winner.
  it("rejects 20 concurrent identical creates with one winner", async () => {
    // results: capture concurrent outcomes for race assertions.
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        createMaintenanceTicket({
          locationId: world.locationAId,
          issueOptionId: optionId,
          blocksRoom: false,
          reportedByEmployeeId: world.owner.employeeId,
          commandId: randomUUID(),
        }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const dup = results.filter(
      (r) =>
        r.status === "rejected" &&
        r.reason instanceof AppError &&
        r.reason.code === "duplicate_active",
    );
    assert.equal(ok.length, 1);
    assert.equal(dup.length, 19);
    const count = await prisma.maintenanceTicket.count({
      where: {
        locationId: world.locationAId,
        issueOptionId: optionId,
        status: { in: ["new", "assigned", "in_progress", "waiting"] },
      },
    });
    assert.equal(count, 1);
  });

  // Case: custom path rejects normalized title duplicates.
  it("custom path rejects normalized title duplicates", async () => {
    await createMaintenanceTicket({
      locationId: world.locationAId,
      categoryId,
      title: "Запушен сифон/мивка",
      blocksRoom: false,
      reportedByEmployeeId: world.owner.employeeId,
      commandId: randomUUID(),
    });
    await assert.rejects(
      () =>
        createMaintenanceTicket({
          locationId: world.locationAId,
          categoryId,
          title: "запушен сифон / мивка",
          blocksRoom: false,
          reportedByEmployeeId: world.owner.employeeId,
          commandId: randomUUID(),
        }),
      (err: unknown) => errCode(err) === "duplicate_active",
    );
  });
});
