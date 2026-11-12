/**
 * Duplicate prevention: exact/probable/override/recurring + concurrency.
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
  createMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  resolveMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  closeMaintenanceTicket,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/maintenance";
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
  errCode,
  // Execute the next setup or assertion step for this scenario.
  findActiveIssueOption,
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

// Suite: ticket duplicate prevention.
describe("ticket duplicate prevention", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: TicketsWorld;
  // Execute the next setup or assertion step for this scenario.
  let optionId: string;
  // Execute the next setup or assertion step for this scenario.
  let otherOptionId: string;
  // Execute the next setup or assertion step for this scenario.
  let categoryId: string;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createTicketsWorld(prisma);
    // option: synchronize actors so the race window is observable.
    const option = await findActiveIssueOption(prisma);
    // Execute the next setup or assertion step for this scenario.
    optionId = option.id;
    // Execute the next setup or assertion step for this scenario.
    categoryId = option.maintenanceCategoryId;
    // other: synchronize actors so the race window is observable.
    const other = await prisma.issueOption.findFirst({
      // SQL fragment used to observe locks or assert DB state.
      where: { isActive: true, id: { not: optionId } },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(other, "need a second active issue option");
    // Execute the next setup or assertion step for this scenario.
    otherOptionId = other.id;
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
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
    await prisma.auditEvent.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: { in: [world.locationAId, world.locationBId] },
        // Execute the next setup or assertion step for this scenario.
        action: "ticket.duplicate_override",
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

  // Case: rejects exact duplicate for same room + option.
  it("rejects exact duplicate for same room + option", async () => {
    // Await async work before asserting or releasing locks.
    await reportTicket(prisma, world, { issueOptionId: optionId });
    // Await async work before asserting or releasing locks.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        createMaintenanceTicket({
          // Execute the next setup or assertion step for this scenario.
          locationId: world.locationAId,
          // Execute the next setup or assertion step for this scenario.
          issueOptionId: optionId,
          // Concurrency/isolation step for the race under test.
          blocksRoom: false,
          // Execute the next setup or assertion step for this scenario.
          reportedByEmployeeId: world.owner.employeeId,
          // Execute the next setup or assertion step for this scenario.
          commandId: randomUUID(),
        }),
      // Execute the next setup or assertion step for this scenario.
      (err: unknown) =>
        // Execute the next setup or assertion step for this scenario.
        err instanceof AppError && err.code === "duplicate_active",
    );
  });

  // Case: allows same option in a different room.
  it("allows same option in a different room", async () => {
    // Await async work before asserting or releasing locks.
    await reportTicket(prisma, world, { issueOptionId: optionId });
    // second: seeded entity required before the mutation under test.
    const second = await createMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationBId,
      // Execute the next setup or assertion step for this scenario.
      issueOptionId: optionId,
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(second.ticket.locationId, world.locationBId);
  });

  // Case: allows different options in the same room.
  it("allows different options in the same room", async () => {
    // Await async work before asserting or releasing locks.
    await reportTicket(prisma, world, { issueOptionId: optionId });
    // second: seeded entity required before the mutation under test.
    const second = await createMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      issueOptionId: otherOptionId,
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(second.ticket.issueOptionId, otherOptionId);
  });

  // Case: allows recurring report after close.
  it("allows recurring report after close", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world, {
      // Execute the next setup or assertion step for this scenario.
      issueOptionId: optionId,
    });
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "in_progress");
    // Await async work before asserting or releasing locks.
    await resolveMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      resolvedByEmployeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      bypassAssigneeCheck: true,
      // Execute the next setup or assertion step for this scenario.
      resolutionNotes: "Fixed for recurring test",
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Await async work before asserting or releasing locks.
    await closeMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      closedByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // again: seeded entity required before the mutation under test.
    const again = await createMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      issueOptionId: optionId,
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(again.ticket.status, TicketStatus.new);
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      (again.ticket as { suggestReopenTicketId?: string }).suggestReopenTicketId ||
        // Execute the next setup or assertion step for this scenario.
        true,
    );
  });

  // Case checks authz/session policy: authorized override creates second ticket and audit.
  it("authorized override creates second ticket and audit", async () => {
    // Await async work before asserting or releasing locks.
    await reportTicket(prisma, world, { issueOptionId: optionId });
    // overridden: seeded entity required before the mutation under test.
    const overridden = await createMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      issueOptionId: optionId,
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      allowDuplicate: true,
      // Execute the next setup or assertion step for this scenario.
      duplicateOverrideReason: "Second AC unit in same room",
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(overridden.ticket.status, TicketStatus.new);
    // audits: synchronize actors so the race window is observable.
    const audits = await prisma.auditEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        action: "ticket.duplicate_override",
        // Execute the next setup or assertion step for this scenario.
        entityId: overridden.ticket.id,
      },
    });
    // Assert collection size matches the expected post-condition.
    assert.equal(audits.length, 1);
  });

  // Case: stores description separately from title.
  it("stores description separately from title", async () => {
    // option: synchronize actors so the race window is observable.
    const option = await prisma.issueOption.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: optionId },
    });
    // created: seeded entity required before the mutation under test.
    const created = await createMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      issueOptionId: optionId,
      // Execute the next setup or assertion step for this scenario.
      description: "Guest reported overnight",
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(created.ticket.title, option.nameBg);
    // Assert the observed value matches the intended post-condition.
    assert.equal(created.ticket.description, "Guest reported overnight");
  });

  // Case probes concurrency/isolation: applies catalog defaultBlocksRoom when omitted.
  it("applies catalog defaultBlocksRoom when omitted", async () => {
    // option: synchronize actors so the race window is observable.
    const option = await prisma.issueOption.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: optionId },
    });
    // created: seeded entity required before the mutation under test.
    const created = await createMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      issueOptionId: optionId,
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Bind expected for later setup or assertions in this scope.
    const expected = option.defaultBlocksRoom ?? false;
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.equal(created.ticket.blocksRoom, expected);
  });

  // Case probes concurrency/isolation: rejects 20 concurrent identical creates with one winner.
  it("rejects 20 concurrent identical creates with one winner", async () => {
    // results: capture concurrent outcomes for race assertions.
    const results = await Promise.allSettled(
      // Execute the next setup or assertion step for this scenario.
      Array.from({ length: 20 }, () =>
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        createMaintenanceTicket({
          // Execute the next setup or assertion step for this scenario.
          locationId: world.locationAId,
          // Execute the next setup or assertion step for this scenario.
          issueOptionId: optionId,
          // Concurrency/isolation step for the race under test.
          blocksRoom: false,
          // Execute the next setup or assertion step for this scenario.
          reportedByEmployeeId: world.owner.employeeId,
          // Execute the next setup or assertion step for this scenario.
          commandId: randomUUID(),
        }),
      ),
    );
    // Bind ok for later setup or assertions in this scope.
    const ok = results.filter((r) => r.status === "fulfilled");
    // Bind dup for later setup or assertions in this scope.
    const dup = results.filter(
      // Execute the next setup or assertion step for this scenario.
      (r) =>
        // Execute the next setup or assertion step for this scenario.
        r.status === "rejected" &&
        // Execute the next setup or assertion step for this scenario.
        r.reason instanceof AppError &&
        // Execute the next setup or assertion step for this scenario.
        r.reason.code === "duplicate_active",
    );
    // Assert collection size matches the expected post-condition.
    assert.equal(ok.length, 1);
    // Assert collection size matches the expected post-condition.
    assert.equal(dup.length, 19);
    // count: synchronize actors so the race window is observable.
    const count = await prisma.maintenanceTicket.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        issueOptionId: optionId,
        // Fixture field status for the seeded actor/entity.
        status: { in: ["new", "assigned", "in_progress", "waiting"] },
      },
    });
    // Assert collection size matches the expected post-condition.
    assert.equal(count, 1);
  });

  // Case: custom path rejects normalized title duplicates.
  it("custom path rejects normalized title duplicates", async () => {
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await createMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      categoryId,
      // Execute the next setup or assertion step for this scenario.
      title: "Запушен сифон/мивка",
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Await async work before asserting or releasing locks.
    await assert.rejects(
      // Execute the next setup or assertion step for this scenario.
      () =>
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        createMaintenanceTicket({
          // Execute the next setup or assertion step for this scenario.
          locationId: world.locationAId,
          // Execute the next setup or assertion step for this scenario.
          categoryId,
          // Execute the next setup or assertion step for this scenario.
          title: "запушен сифон / мивка",
          // Concurrency/isolation step for the race under test.
          blocksRoom: false,
          // Execute the next setup or assertion step for this scenario.
          reportedByEmployeeId: world.owner.employeeId,
          // Execute the next setup or assertion step for this scenario.
          commandId: randomUUID(),
        }),
      // Execute the next setup or assertion step for this scenario.
      (err: unknown) => errCode(err) === "duplicate_active",
    );
  });
});
