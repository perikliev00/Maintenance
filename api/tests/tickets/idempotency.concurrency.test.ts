// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { withDatabaseBarrier } from "../dbBarrier";
/**
 * 10 — concurrent/idempotent commandId (46).
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
  resumeMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  startMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  waitMaintenanceTicket,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/maintenance";
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
  errCode,
  // Execute the next setup or assertion step for this scenario.
  findActiveIssueOption,
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

// Suite: ticket commandId concurrency (10 / 46).
describe("ticket commandId concurrency (10 / 46)", () => {
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

  // Case probes concurrency/isolation: concurrent start with same commandId → one event.
  it("concurrent start with same commandId → one event", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "assigned");
    // commandId: unique stamp so parallel runs do not collide.
    const commandId = randomUUID();
    // eventsBefore: synchronize actors so the race window is observable.
    const eventsBefore = await countTicketEvents(prisma, ticket.id);

    // results: capture concurrent outcomes for race assertions.
    const results = await withDatabaseBarrier(prisma, tx => tx.$queryRaw`SELECT id FROM "MaintenanceTicket" WHERE id = ${ticket.id} FOR UPDATE`, () => Promise.allSettled([
      // Execute the next setup or assertion step for this scenario.
      startMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId,
      }),
      // Execute the next setup or assertion step for this scenario.
      startMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId,
      }),
    ]));

    // Iterate to cover variants or wait until a condition holds.
    for (const r of results) {
      // Assert HTTP status matches the contract for this path.
      assert.equal(r.status, "fulfilled", String(r));
      // Guard optional cleanup or alternate assertion paths.
      if (r.status === "fulfilled") {
        // Assert HTTP status matches the contract for this path.
        assert.equal(r.value.status, TicketStatus.in_progress);
        // Assert the observed value matches the intended post-condition.
        assert.equal(r.value.id, ticket.id);
      }
    }

    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await countTicketEvents(prisma, ticket.id, commandId),
      1,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await countTicketEvents(prisma, ticket.id),
      // Execute the next setup or assertion step for this scenario.
      eventsBefore + 1,
    );
  });

  // Case probes concurrency/isolation: concurrent wait with same commandId → one event.
  it("concurrent wait with same commandId → one event", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "in_progress");
    // commandId: unique stamp so parallel runs do not collide.
    const commandId = randomUUID();
    // eventsBefore: synchronize actors so the race window is observable.
    const eventsBefore = await countTicketEvents(prisma, ticket.id);
    // before: synchronize actors so the race window is observable.
    const before = await loadTicket(prisma, ticket.id);

    // results: capture concurrent outcomes for race assertions.
    const results = await withDatabaseBarrier(prisma, tx => tx.$queryRaw`SELECT id FROM "MaintenanceTicket" WHERE id = ${ticket.id} FOR UPDATE`, () => Promise.allSettled([
      // Execute the next setup or assertion step for this scenario.
      waitMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId,
        // Execute the next setup or assertion step for this scenario.
        reason: "parts",
      }),
      // Execute the next setup or assertion step for this scenario.
      waitMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId,
        // Execute the next setup or assertion step for this scenario.
        reason: "parts",
      }),
    ]));

    // Iterate to cover variants or wait until a condition holds.
    for (const r of results) {
      // Assert HTTP status matches the contract for this path.
      assert.equal(r.status, "fulfilled", String(r));
      // Guard optional cleanup or alternate assertion paths.
      if (r.status === "fulfilled") {
        // Assert HTTP status matches the contract for this path.
        assert.equal(r.value.status, TicketStatus.waiting);
        // Assert the observed value matches the intended post-condition.
        assert.equal(r.value.id, ticket.id);
      }
    }

    // row: synchronize actors so the race window is observable.
    const row = await loadTicket(prisma, ticket.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal(row.status, TicketStatus.waiting);
    // Assert the observed value matches the intended post-condition.
    assert.ok(row.slaPausedAt);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.dueAt?.toISOString() ?? null, before.dueAt?.toISOString() ?? null);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTicketEvents(prisma, ticket.id, commandId), 1);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsBefore + 1);
  });

  // Case probes concurrency/isolation: concurrent resume with same commandId → one event, one unpause.
  it("concurrent resume with same commandId → one event, one unpause", async () => {
    // Bind T1 for later setup or assertions in this scope.
    const T1 = new Date("2026-09-01T09:00:00.000Z");
    // Bind T2 for later setup or assertions in this scope.
    const T2 = new Date("2026-09-01T10:00:00.000Z");
    // Bind pauseMs for later setup or assertions in this scope.
    const pauseMs = T2.getTime() - T1.getTime();

    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world, {
      // Execute the next setup or assertion step for this scenario.
      now: new Date("2026-09-01T08:00:00.000Z"),
    });
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "in_progress");
    // dueAt0: synchronize actors so the race window is observable.
    const dueAt0 = (await loadTicket(prisma, ticket.id)).dueAt!;
    // Await async work before asserting or releasing locks.
    await waitMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      now: T1,
    });

    // commandId: unique stamp so parallel runs do not collide.
    const commandId = randomUUID();
    // eventsBefore: synchronize actors so the race window is observable.
    const eventsBefore = await countTicketEvents(prisma, ticket.id);

    // results: capture concurrent outcomes for race assertions.
    const results = await withDatabaseBarrier(prisma, tx => tx.$queryRaw`SELECT id FROM "MaintenanceTicket" WHERE id = ${ticket.id} FOR UPDATE`, () => Promise.allSettled([
      // Execute the next setup or assertion step for this scenario.
      resumeMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId,
        // Execute the next setup or assertion step for this scenario.
        now: T2,
      }),
      // Execute the next setup or assertion step for this scenario.
      resumeMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId,
        // Execute the next setup or assertion step for this scenario.
        now: T2,
      }),
    ]));

    // Iterate to cover variants or wait until a condition holds.
    for (const r of results) {
      // Assert HTTP status matches the contract for this path.
      assert.equal(r.status, "fulfilled", String(r));
      // Guard optional cleanup or alternate assertion paths.
      if (r.status === "fulfilled") {
        // Assert HTTP status matches the contract for this path.
        assert.equal(r.value.status, TicketStatus.in_progress);
      }
    }

    // row: synchronize actors so the race window is observable.
    const row = await loadTicket(prisma, ticket.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal(row.status, TicketStatus.in_progress);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.slaPausedAt, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.slaPausedMsTotal, pauseMs);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      row.dueAt?.toISOString(),
      // Execute the next setup or assertion step for this scenario.
      new Date(dueAt0.getTime() + pauseMs).toISOString(),
    );
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTicketEvents(prisma, ticket.id, commandId), 1);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsBefore + 1);
  });

  // Case probes concurrency/isolation: concurrent resolve with same commandId → one event.
  it("concurrent resolve with same commandId → one event", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "in_progress");
    // commandId: unique stamp so parallel runs do not collide.
    const commandId = randomUUID();
    // eventsBefore: synchronize actors so the race window is observable.
    const eventsBefore = await countTicketEvents(prisma, ticket.id);

    // results: capture concurrent outcomes for race assertions.
    const results = await withDatabaseBarrier(prisma, tx => tx.$queryRaw`SELECT id FROM "MaintenanceTicket" WHERE id = ${ticket.id} FOR UPDATE`, () => Promise.allSettled([
      // Execute the next setup or assertion step for this scenario.
      resolveMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        resolvedByEmployeeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        resolutionNotes: "done",
        // Execute the next setup or assertion step for this scenario.
        commandId,
      }),
      // Execute the next setup or assertion step for this scenario.
      resolveMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        resolvedByEmployeeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        resolutionNotes: "done",
        // Execute the next setup or assertion step for this scenario.
        commandId,
      }),
    ]));

    // Iterate to cover variants or wait until a condition holds.
    for (const r of results) {
      // Assert HTTP status matches the contract for this path.
      assert.equal(r.status, "fulfilled", String(r));
      // Guard optional cleanup or alternate assertion paths.
      if (r.status === "fulfilled") {
        // Assert HTTP status matches the contract for this path.
        assert.equal(r.value.status, TicketStatus.resolved);
        // Assert the observed value matches the intended post-condition.
        assert.equal(r.value.id, ticket.id);
      }
    }

    // row: synchronize actors so the race window is observable.
    const row = await loadTicket(prisma, ticket.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal(row.status, TicketStatus.resolved);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.resolvedByEmployeeId, world.technician.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.resolutionNotes, "done");
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTicketEvents(prisma, ticket.id, commandId), 1);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsBefore + 1);
  });

  // Case: commandId not reusable across action kinds or tickets.
  it("commandId not reusable across action kinds or tickets", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket: t1 } = await reportTicket(prisma, world);
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, t1.id, "assigned");
    // commandId: unique stamp so parallel runs do not collide.
    const commandId = randomUUID();

    // Await async work before asserting or releasing locks.
    await startMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: t1.id,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId,
    });

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await waitMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: t1.id,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected conflict reusing start commandId for wait");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(errCode(err), "conflict");
    }

    // Await async work before asserting or releasing locks.
    const { ticket: t2 } = await reportTicket(prisma, world, {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationBId,
    });
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, t2.id, "assigned", world.technician2.employeeId);
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await startMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: t2.id,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.technician2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected conflict reusing commandId on other ticket");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(errCode(err), "conflict");
    }

    // Create commandId then lifecycle on another ticket
    const createId = randomUUID();
    // Await async work before asserting or releasing locks.
    await reportTicket(prisma, world, {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationBId,
      // Execute the next setup or assertion step for this scenario.
      commandId: createId,
      // Execute the next setup or assertion step for this scenario.
      allowDuplicate: true,
    });
    // Await async work before asserting or releasing locks.
    const { ticket: t3 } = await reportTicket(prisma, world, {
      // Execute the next setup or assertion step for this scenario.
      allowDuplicate: true,
    });
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, t3.id, "assigned");
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await startMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: t3.id,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: createId,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected conflict create commandId reused for start");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(errCode(err), "conflict");
    }

    // Create replay with different payload → conflict
    const opt = await findActiveIssueOption(prisma);
    // cid: unique stamp so parallel runs do not collide.
    const cid = randomUUID();
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await createMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      issueOptionId: opt.id,
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: cid,
      // Execute the next setup or assertion step for this scenario.
      allowDuplicate: true,
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      duplicateOverrideReason: "idempotency fingerprint fixture",
    });
    // Try path where partial failure must not leak suite state.
    try {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await createMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationBId,
        // Execute the next setup or assertion step for this scenario.
        issueOptionId: opt.id,
        // Concurrency/isolation step for the race under test.
        blocksRoom: true,
        // Execute the next setup or assertion step for this scenario.
        reportedByEmployeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: cid,
        // Execute the next setup or assertion step for this scenario.
        title: "different",
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected conflict on create fingerprint mismatch");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(errCode(err), "conflict");
    }
  });

  // Case probes concurrency/isolation: concurrent create same commandId → one ticket + one history.
  it("concurrent create same commandId → one ticket + one history", async () => {
    // option: synchronize actors so the race window is observable.
    const option = await findActiveIssueOption(prisma);
    // commandId: unique stamp so parallel runs do not collide.
    const commandId = randomUUID();
    // Bind payload for later setup or assertions in this scope.
    const payload = {
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      issueOptionId: option.id,
      // Concurrency/isolation step for the race under test.
      blocksRoom: false,
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId,
    };

    // results: capture concurrent outcomes for race assertions.
    const results = await withDatabaseBarrier(prisma, tx => tx.$executeRaw`LOCK TABLE "MaintenanceTicket" IN SHARE MODE`, () => Promise.allSettled([
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      createMaintenanceTicket(payload),
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      createMaintenanceTicket(payload),
    ]));

    // Iterate to cover variants or wait until a condition holds.
    for (const r of results) {
      // Assert HTTP status matches the contract for this path.
      assert.equal(r.status, "fulfilled", String(r));
    }
    // Bind tickets for later setup or assertions in this scope.
    const tickets = results
      // Continue the call chain for setup or assertion detail.
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createMaintenanceTicket>>> =>
        // Execute the next setup or assertion step for this scenario.
        r.status === "fulfilled",
      )
      // Continue the call chain for setup or assertion detail.
      .map((r) => r.value.ticket);

    // Assert the observed value matches the intended post-condition.
    assert.equal(tickets[0]!.id, tickets[1]!.id);
    // count: synchronize actors so the race window is observable.
    const count = await prisma.maintenanceTicket.count({
      // SQL fragment used to observe locks or assert DB state.
      where: { commandId },
    });
    // Assert collection size matches the expected post-condition.
    assert.equal(count, 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await countTicketEvents(prisma, tickets[0]!.id, commandId),
      1,
    );
    // createdEvents: seeded entity required before the mutation under test.
    const createdEvents = await prisma.ticketEvent.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        ticketId: tickets[0]!.id,
        // Execute the next setup or assertion step for this scenario.
        toStatus: TicketStatus.new,
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(createdEvents, 1);

    // row: synchronize actors so the race window is observable.
    const row = await loadTicket(prisma, tickets[0]!.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal(row.status, TicketStatus.new);
  });
});
