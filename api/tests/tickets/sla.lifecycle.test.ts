/**
 * 07 — SLA dueAt on create, wait/resume, resolve-from-waiting (43).
 */
import assert from "node:assert/strict";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import bindings from node:path.
import path from "node:path";
// Prisma client types/runtime for DB setup and assertions.
import { Priority, PrismaClient, TicketStatus } from "@prisma/client";
// Import bindings from dotenv.
import dotenv from "dotenv";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  resolveMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  resumeMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  waitMaintenanceTicket,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/maintenance";
// Import bindings from ../../src/services/slaPolicies.
import { resolveSlaForPriority } from "../../src/services/slaPolicies";
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
  loadTicket,
  // Execute the next setup or assertion step for this scenario.
  reportTicket,
  // Execute the next setup or assertion step for this scenario.
  withDefaultSlaHours,
  // Execute the next setup or assertion step for this scenario.
  withMissingSlaPolicy,
  // Execute the next setup or assertion step for this scenario.
  withSlaPolicyPatch,
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

// Suite: ticket SLA lifecycle (07 / 43).
describe("ticket SLA lifecycle (07 / 43)", () => {
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

  // Case: dueAt from active SLA policy hours.
  it("dueAt from active SLA policy hours", async () => {
    // Bind T0 for later setup or assertions in this scope.
    const T0 = new Date("2026-06-01T10:00:00.000Z");
    // Await async work before asserting or releasing locks.
    await withSlaPolicyPatch(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      Priority.urgent,
      // Execute the next setup or assertion step for this scenario.
      { hours: 5, isActive: true },
      // Execute the next setup or assertion step for this scenario.
      async () => {
        // expected: synchronize actors so the race window is observable.
        const expected = await resolveSlaForPriority(Priority.urgent);
        // Assert we are on the isolated test DB, not a seed/prod database.
        assert.equal(expected.hours, 5);
        // Assert we are on the isolated test DB, not a seed/prod database.
        assert.ok(expected.policyId);

        // Await async work before asserting or releasing locks.
        const { ticket } = await reportTicket(prisma, world, {
          // Execute the next setup or assertion step for this scenario.
          priority: Priority.urgent,
          // Execute the next setup or assertion step for this scenario.
          now: T0,
        });
        // row: synchronize actors so the race window is observable.
        const row = await loadTicket(prisma, ticket.id);
        // Assert the observed value matches the intended post-condition.
        assert.equal(row.dueAt?.toISOString(), new Date(T0.getTime() + 5 * 3600_000).toISOString());
        // Assert the observed value matches the intended post-condition.
        assert.equal(row.slaHoursSnapshot, 5);
        // Assert we are on the isolated test DB, not a seed/prod database.
        assert.equal(row.slaPolicyId, expected.policyId);
      },
    );
  });

  // Case: inactive policy falls back to defaultTicketSlaHours.
  it("inactive policy falls back to defaultTicketSlaHours", async () => {
    // Bind T0 for later setup or assertions in this scope.
    const T0 = new Date("2026-06-01T12:00:00.000Z");
    // Await async work before asserting or releasing locks.
    await withSlaPolicyPatch(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      Priority.low,
      // Execute the next setup or assertion step for this scenario.
      { isActive: false },
      // Execute the next setup or assertion step for this scenario.
      async () => {
        // Await async work before asserting or releasing locks.
        await withDefaultSlaHours(world.owner.employeeId, 17, async () => {
          // expected: synchronize actors so the race window is observable.
          const expected = await resolveSlaForPriority(Priority.low);
          // Assert we are on the isolated test DB, not a seed/prod database.
          assert.equal(expected.hours, 17);
          // Assert we are on the isolated test DB, not a seed/prod database.
          assert.equal(expected.policyId, null);

          // Await async work before asserting or releasing locks.
          const { ticket } = await reportTicket(prisma, world, {
            // Execute the next setup or assertion step for this scenario.
            priority: Priority.low,
            // Execute the next setup or assertion step for this scenario.
            now: T0,
          });
          // row: synchronize actors so the race window is observable.
          const row = await loadTicket(prisma, ticket.id);
          // Assert the observed value matches the intended post-condition.
          assert.equal(
            // Execute the next setup or assertion step for this scenario.
            row.dueAt?.toISOString(),
            // Execute the next setup or assertion step for this scenario.
            new Date(T0.getTime() + 17 * 3600_000).toISOString(),
          );
          // Assert the observed value matches the intended post-condition.
          assert.equal(row.slaHoursSnapshot, 17);
          // Assert the observed value matches the intended post-condition.
          assert.equal(row.slaPolicyId, null);
        });
      },
    );
  });

  // Case: missing SLA policy row falls back to defaultTicketSlaHours.
  it("missing SLA policy row falls back to defaultTicketSlaHours", async () => {
    // Bind T0 for later setup or assertions in this scope.
    const T0 = new Date("2026-06-01T14:00:00.000Z");
    // Await async work before asserting or releasing locks.
    await withMissingSlaPolicy(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      Priority.high,
      // Execute the next setup or assertion step for this scenario.
      async () => {
        // Await async work before asserting or releasing locks.
        await withDefaultSlaHours(world.owner.employeeId, 13, async () => {
          // rowMissing: synchronize actors so the race window is observable.
          const rowMissing = await prisma.slaPolicy.findUnique({
            // SQL fragment used to observe locks or assert DB state.
            where: { priority: Priority.high },
          });
          // Assert the observed value matches the intended post-condition.
          assert.equal(rowMissing, null);

          // expected: synchronize actors so the race window is observable.
          const expected = await resolveSlaForPriority(Priority.high);
          // Assert we are on the isolated test DB, not a seed/prod database.
          assert.equal(expected.hours, 13);
          // Assert we are on the isolated test DB, not a seed/prod database.
          assert.equal(expected.policyId, null);

          // Await async work before asserting or releasing locks.
          const { ticket } = await reportTicket(prisma, world, {
            // Execute the next setup or assertion step for this scenario.
            priority: Priority.high,
            // Execute the next setup or assertion step for this scenario.
            now: T0,
          });
          // row: synchronize actors so the race window is observable.
          const row = await loadTicket(prisma, ticket.id);
          // Assert the observed value matches the intended post-condition.
          assert.equal(
            // Execute the next setup or assertion step for this scenario.
            row.dueAt?.toISOString(),
            // Execute the next setup or assertion step for this scenario.
            new Date(T0.getTime() + 13 * 3600_000).toISOString(),
          );
          // Assert the observed value matches the intended post-condition.
          assert.equal(row.slaHoursSnapshot, 13);
          // Assert the observed value matches the intended post-condition.
          assert.equal(row.slaPolicyId, null);
        });
      },
    );
  });

  // Case: wait→resume extends dueAt exactly; same-commandId replay does not double-extend.
  it("wait→resume extends dueAt exactly; same-commandId replay does not double-extend", async () => {
    // Bind T0 for later setup or assertions in this scope.
    const T0 = new Date("2026-07-01T08:00:00.000Z");
    // Bind T1 for later setup or assertions in this scope.
    const T1 = new Date("2026-07-01T09:00:00.000Z");
    // Bind T2 for later setup or assertions in this scope.
    const T2 = new Date("2026-07-01T10:30:00.000Z");
    // Bind pauseMs for later setup or assertions in this scope.
    const pauseMs = T2.getTime() - T1.getTime();

    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world, {
      // Execute the next setup or assertion step for this scenario.
      priority: Priority.normal,
      // Execute the next setup or assertion step for this scenario.
      now: T0,
    });
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "in_progress");
    // beforeWait: synchronize actors so the race window is observable.
    const beforeWait = await loadTicket(prisma, ticket.id);
    // Bind dueAt0 for later setup or assertions in this scope.
    const dueAt0 = beforeWait.dueAt!;
    // Assert the observed value matches the intended post-condition.
    assert.ok(dueAt0);

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
    // row: synchronize actors so the race window is observable.
    let row = await loadTicket(prisma, ticket.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal(row.status, TicketStatus.waiting);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.slaPausedAt?.toISOString(), T1.toISOString());

    // resumeCommandId: unique stamp so parallel runs do not collide.
    const resumeCommandId = randomUUID();
    // Await async work before asserting or releasing locks.
    await resumeMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: resumeCommandId,
      // Execute the next setup or assertion step for this scenario.
      now: T2,
    });
    // Await async work before asserting or releasing locks.
    row = await loadTicket(prisma, ticket.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal(row.status, TicketStatus.in_progress);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.slaPausedAt, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.slaPausedMsTotal, pauseMs);
    // Bind expectedDue for later setup or assertions in this scope.
    const expectedDue = new Date(dueAt0.getTime() + pauseMs).toISOString();
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.equal(row.dueAt?.toISOString(), expectedDue);

    // eventsAfterResume: synchronize actors so the race window is observable.
    const eventsAfterResume = await countTicketEvents(
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      ticket.id,
      // Execute the next setup or assertion step for this scenario.
      resumeCommandId,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(eventsAfterResume, 1);

    // Same commandId replay must not extend dueAt / slaPausedMsTotal again
    const replayed = await resumeMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: resumeCommandId,
      // Execute the next setup or assertion step for this scenario.
      now: new Date(T2.getTime() + 60_000),
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(replayed.status, TicketStatus.in_progress);
    // Await async work before asserting or releasing locks.
    row = await loadTicket(prisma, ticket.id);
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.equal(row.dueAt?.toISOString(), expectedDue);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.slaPausedMsTotal, pauseMs);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.slaPausedAt, null);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await countTicketEvents(prisma, ticket.id, resumeCommandId),
      1,
    );

    // Different commandId from in_progress → invalid_state; SLA fields unchanged
    try {
      // Await async work before asserting or releasing locks.
      await resumeMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
        // Execute the next setup or assertion step for this scenario.
        now: new Date(T2.getTime() + 120_000),
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected resume refuse when not waiting");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(errCode(err), "invalid_state");
    }
    // Await async work before asserting or releasing locks.
    row = await loadTicket(prisma, ticket.id);
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.equal(row.dueAt?.toISOString(), expectedDue);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.slaPausedMsTotal, pauseMs);
  });

  // Case: resolve-from-waiting closes pause and stamps resolver.
  it("resolve-from-waiting closes pause and stamps resolver", async () => {
    // Bind T0 for later setup or assertions in this scope.
    const T0 = new Date("2026-08-01T08:00:00.000Z");
    // Bind T1 for later setup or assertions in this scope.
    const T1 = new Date("2026-08-01T09:00:00.000Z");
    // Bind T2 for later setup or assertions in this scope.
    const T2 = new Date("2026-08-01T11:00:00.000Z");
    // Bind pauseMs for later setup or assertions in this scope.
    const pauseMs = T2.getTime() - T1.getTime();

    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world, { now: T0 });
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

    // eventsBefore: synchronize actors so the race window is observable.
    const eventsBefore = await countTicketEvents(prisma, ticket.id);
    // Await async work before asserting or releasing locks.
    await resolveMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      resolvedByEmployeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      resolutionNotes: "fixed while waiting",
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      now: T2,
    });

    // row: synchronize actors so the race window is observable.
    const row = await loadTicket(prisma, ticket.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal(row.status, TicketStatus.resolved);
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
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.resolvedByEmployeeId, world.technician.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.resolutionNotes, "fixed while waiting");
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.resolvedAt?.toISOString(), T2.toISOString());
    // Assert collection size matches the expected post-condition.
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsBefore + 1);
  });
});
