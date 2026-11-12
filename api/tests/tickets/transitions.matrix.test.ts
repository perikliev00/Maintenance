/**
 * assign + wrong-state matrix .
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
  closeMaintenanceTicket,
  // Execute the next setup or assertion step for this scenario.
  reopenMaintenanceTicket,
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

// Local helper snapshotSla used by cases in this file.
async function snapshotSla(ticketId: string) {
  // t: synchronize actors so the race window is observable.
  const t = await loadTicket(prisma, ticketId);
  // Return the arranged value/result to the caller.
  return {
    // Fixture field status for the seeded actor/entity.
    status: t.status,
    // Execute the next setup or assertion step for this scenario.
    dueAt: t.dueAt?.toISOString() ?? null,
    // Execute the next setup or assertion step for this scenario.
    slaPausedAt: t.slaPausedAt?.toISOString() ?? null,
    // Execute the next setup or assertion step for this scenario.
    slaPausedMsTotal: t.slaPausedMsTotal,
    // Await async work before asserting or releasing locks.
    eventCount: await countTicketEvents(prisma, ticketId),
  };
}

// Suite: ticket transition matrix (04).
describe("ticket transition matrix (04)", () => {
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

  // Case: assign refused from in_progress/waiting/resolved/closed.
  it("assign refused from in_progress/waiting/resolved/closed", async () => {
    // Iterate to cover variants or wait until a condition holds.
    for (const target of ["in_progress", "waiting"] as const) {
      // Parallel actives of the same catalog option are blocked by design.
      const { ticket } = await reportTicket(prisma, world, {
        // Execute the next setup or assertion step for this scenario.
        allowDuplicate: true,
      });
      // Await async work before asserting or releasing locks.
      await advanceTicketTo(world, ticket.id, target);
      // before: synchronize actors so the race window is observable.
      const before = await snapshotSla(ticket.id);
      // Try path where partial failure must not leak suite state.
      try {
        // Await async work before asserting or releasing locks.
        await assignMaintenanceTicket({
          // Execute the next setup or assertion step for this scenario.
          ticketId: ticket.id,
          // Execute the next setup or assertion step for this scenario.
          assigneeId: world.technician2.employeeId,
          // Execute the next setup or assertion step for this scenario.
          actorEmployeeId: world.owner.employeeId,
        });
        // Assert we are on the isolated test DB, not a seed/prod database.
        assert.fail(`expected assign refuse from ${target}`);
      // Execute the next setup or assertion step for this scenario.
      } catch (err) {
        // Assert the observed value matches the intended post-condition.
        assert.equal(errCode(err), "invalid_state");
      }
      // after: synchronize actors so the race window is observable.
      const after = await snapshotSla(ticket.id);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(after, before);
    }

    // Await async work before asserting or releasing locks.
    const { ticket: resolvedT } = await reportTicket(prisma, world, {
      // Execute the next setup or assertion step for this scenario.
      allowDuplicate: true,
    });
    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, resolvedT.id, "in_progress");
    // Await async work before asserting or releasing locks.
    await resolveMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: resolvedT.id,
      // Execute the next setup or assertion step for this scenario.
      resolvedByEmployeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      resolutionNotes: "matrix resolve",
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // before: synchronize actors so the race window is observable.
    let before = await snapshotSla(resolvedT.id);
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await assignMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: resolvedT.id,
        // Execute the next setup or assertion step for this scenario.
        assigneeId: world.technician2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected assign refuse from resolved");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(errCode(err), "invalid_state");
    }
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await snapshotSla(resolvedT.id), before);

    // Await async work before asserting or releasing locks.
    await closeMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: resolvedT.id,
      // Execute the next setup or assertion step for this scenario.
      closedByEmployeeId: world.owner.employeeId,
    });
    // Await async work before asserting or releasing locks.
    before = await snapshotSla(resolvedT.id);
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await assignMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: resolvedT.id,
        // Execute the next setup or assertion step for this scenario.
        assigneeId: world.technician2.employeeId,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected assign refuse from closed");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(errCode(err), "invalid_state");
    }
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await snapshotSla(resolvedT.id), before);
  });

  // Case: assign allowed from new and assigned (positive).
  it("assign allowed from new and assigned (positive)", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // Await async work before asserting or releasing locks.
    await assignMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      assigneeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
    });
    // row: synchronize actors so the race window is observable.
    let row = await loadTicket(prisma, ticket.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal(row.status, TicketStatus.assigned);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.assigneeId, world.technician.employeeId);

    // Await async work before asserting or releasing locks.
    await assignMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      assigneeId: world.technician2.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
    });
    // Await async work before asserting or releasing locks.
    row = await loadTicket(prisma, ticket.id);
    // Assert the observed value matches the intended post-condition.
    assert.equal(row.assigneeId, world.technician2.employeeId);
  });

  // Case: wrong-state start/wait/resume/resolve refuse without event or dueAt change.
  it("wrong-state start/wait/resume/resolve refuse without event or dueAt change", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // new → cannot start/wait/resume/resolve
    let before = await snapshotSla(ticket.id);
    // Iterate to cover variants or wait until a condition holds.
    for (const op of ["start", "wait", "resume", "resolve"] as const) {
      // Try path where partial failure must not leak suite state.
      try {
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (op === "start") {
          // Await async work before asserting or releasing locks.
          await startMaintenanceTicket({
            // Execute the next setup or assertion step for this scenario.
            ticketId: ticket.id,
            // Execute the next setup or assertion step for this scenario.
            actorEmployeeId: world.technician.employeeId,
            // Execute the next setup or assertion step for this scenario.
            commandId: randomUUID(),
          });
        // Execute the next setup or assertion step for this scenario.
        } else if (op === "wait") {
          // Await async work before asserting or releasing locks.
          await waitMaintenanceTicket({
            // Execute the next setup or assertion step for this scenario.
            ticketId: ticket.id,
            // Execute the next setup or assertion step for this scenario.
            actorEmployeeId: world.technician.employeeId,
            // Execute the next setup or assertion step for this scenario.
            commandId: randomUUID(),
          });
        // Execute the next setup or assertion step for this scenario.
        } else if (op === "resume") {
          // Await async work before asserting or releasing locks.
          await resumeMaintenanceTicket({
            // Execute the next setup or assertion step for this scenario.
            ticketId: ticket.id,
            // Execute the next setup or assertion step for this scenario.
            actorEmployeeId: world.technician.employeeId,
            // Execute the next setup or assertion step for this scenario.
            commandId: randomUUID(),
          });
        // Execute the next setup or assertion step for this scenario.
        } else {
          // Await async work before asserting or releasing locks.
          await resolveMaintenanceTicket({
            // Execute the next setup or assertion step for this scenario.
            ticketId: ticket.id,
            // Execute the next setup or assertion step for this scenario.
            resolvedByEmployeeId: world.technician.employeeId,
            // Execute the next setup or assertion step for this scenario.
            commandId: randomUUID(),
          });
        }
        // Assert we are on the isolated test DB, not a seed/prod database.
        assert.fail(`expected ${op} refuse from new`);
      // Execute the next setup or assertion step for this scenario.
      } catch (err) {
        // Assert the observed value matches the intended post-condition.
        assert.ok(isAppError(err));
        // Assert the observed value matches the intended post-condition.
        assert.equal(err.code, "invalid_state");
      }
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await snapshotSla(ticket.id), before);
    }

    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "assigned");
    // Await async work before asserting or releasing locks.
    before = await snapshotSla(ticket.id);
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await waitMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected wait refuse from assigned");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(errCode(err), "invalid_state");
    }
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await snapshotSla(ticket.id), before);

    // Await async work before asserting or releasing locks.
    await advanceTicketTo(world, ticket.id, "in_progress");
    // Await async work before asserting or releasing locks.
    before = await snapshotSla(ticket.id);
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await startMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected second start refuse");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(errCode(err), "invalid_state");
    }
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await snapshotSla(ticket.id), before);

    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await resumeMaintenanceTicket({
        // Execute the next setup or assertion step for this scenario.
        ticketId: ticket.id,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.technician.employeeId,
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
      });
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected resume refuse from in_progress");
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(errCode(err), "invalid_state");
    }
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await snapshotSla(ticket.id), before);
  });

  // Case: wait/resume/resolve/start refused from waiting/resolved/closed.
  it("wait/resume/resolve/start refused from waiting/resolved/closed", async () => {
    // Helper expectRefuse: assert expected post-condition.
    async function expectRefuse(
      // Execute the next setup or assertion step for this scenario.
      ticketId: string,
      // Execute the next setup or assertion step for this scenario.
      op: "start" | "wait" | "resume" | "resolve" | "close" | "reopen",
      // Execute the next setup or assertion step for this scenario.
      label: string,
    // Execute the next setup or assertion step for this scenario.
    ) {
      // before: synchronize actors so the race window is observable.
      const before = await snapshotSla(ticketId);
      // Try path where partial failure must not leak suite state.
      try {
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (op === "start") {
          // Await async work before asserting or releasing locks.
          await startMaintenanceTicket({
            // Execute the next setup or assertion step for this scenario.
            ticketId,
            // Execute the next setup or assertion step for this scenario.
            actorEmployeeId: world.technician.employeeId,
            // Execute the next setup or assertion step for this scenario.
            bypassAssigneeCheck: true,
            // Execute the next setup or assertion step for this scenario.
            commandId: randomUUID(),
          });
        // Execute the next setup or assertion step for this scenario.
        } else if (op === "wait") {
          // Await async work before asserting or releasing locks.
          await waitMaintenanceTicket({
            // Execute the next setup or assertion step for this scenario.
            ticketId,
            // Execute the next setup or assertion step for this scenario.
            actorEmployeeId: world.technician.employeeId,
            // Execute the next setup or assertion step for this scenario.
            bypassAssigneeCheck: true,
            // Execute the next setup or assertion step for this scenario.
            commandId: randomUUID(),
          });
        // Execute the next setup or assertion step for this scenario.
        } else if (op === "resume") {
          // Await async work before asserting or releasing locks.
          await resumeMaintenanceTicket({
            // Execute the next setup or assertion step for this scenario.
            ticketId,
            // Execute the next setup or assertion step for this scenario.
            actorEmployeeId: world.technician.employeeId,
            // Execute the next setup or assertion step for this scenario.
            bypassAssigneeCheck: true,
            // Execute the next setup or assertion step for this scenario.
            commandId: randomUUID(),
          });
        // Execute the next setup or assertion step for this scenario.
        } else if (op === "resolve") {
          // Await async work before asserting or releasing locks.
          await resolveMaintenanceTicket({
            // Execute the next setup or assertion step for this scenario.
            ticketId,
            // Execute the next setup or assertion step for this scenario.
            resolvedByEmployeeId: world.technician.employeeId,
            // Execute the next setup or assertion step for this scenario.
            bypassAssigneeCheck: true,
            // Execute the next setup or assertion step for this scenario.
            commandId: randomUUID(),
          });
        // Execute the next setup or assertion step for this scenario.
        } else if (op === "close") {
          // Await async work before asserting or releasing locks.
          await closeMaintenanceTicket({
            // Execute the next setup or assertion step for this scenario.
            ticketId,
            // Execute the next setup or assertion step for this scenario.
            closedByEmployeeId: world.owner.employeeId,
          });
        // Execute the next setup or assertion step for this scenario.
        } else {
          // Await async work before asserting or releasing locks.
          await reopenMaintenanceTicket({
            // Execute the next setup or assertion step for this scenario.
            ticketId,
            // Execute the next setup or assertion step for this scenario.
            reopenedByEmployeeId: world.owner.employeeId,
          });
        }
        // Assert we are on the isolated test DB, not a seed/prod database.
        assert.fail(`expected ${op} refuse ${label}`);
      // Execute the next setup or assertion step for this scenario.
      } catch (err) {
        // Assert the observed value matches the intended post-condition.
        assert.ok(isAppError(err), `${op} ${label}: ${String(err)}`);
        // Assert the observed value matches the intended post-condition.
        assert.equal(err.code, "invalid_state");
      }
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await snapshotSla(ticketId), before);
    }

    // waiting: start/wait/close/reopen refused; resume+resolve allowed (tested elsewhere)
    {
      // Await async work before asserting or releasing locks.
      const { ticket } = await reportTicket(prisma, world, {
        // Execute the next setup or assertion step for this scenario.
        allowDuplicate: true,
      });
      // Await async work before asserting or releasing locks.
      await advanceTicketTo(world, ticket.id, "waiting");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "start", "from waiting");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "wait", "from waiting");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "close", "from waiting");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "reopen", "from waiting");
    }

    // resolved: wait/resume/resolve/start/close(ok)/reopen(ok) — refuse wait/resume/resolve/start
    {
      // Await async work before asserting or releasing locks.
      const { ticket } = await reportTicket(prisma, world, {
        // Execute the next setup or assertion step for this scenario.
        allowDuplicate: true,
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
        resolutionNotes: "matrix resolve",
        // Execute the next setup or assertion step for this scenario.
        commandId: randomUUID(),
      });
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "start", "from resolved");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "wait", "from resolved");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "resume", "from resolved");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "resolve", "from resolved");
    }

    // closed: wait/resume/resolve/start/close refused
    {
      // Await async work before asserting or releasing locks.
      const { ticket } = await reportTicket(prisma, world, {
        // Execute the next setup or assertion step for this scenario.
        allowDuplicate: true,
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
        resolutionNotes: "matrix resolve",
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
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "start", "from closed");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "wait", "from closed");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "resume", "from closed");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "resolve", "from closed");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "close", "from closed");
    }

    // assigned: resolve/resume/close/reopen refused (wait already covered in)
    {
      // Await async work before asserting or releasing locks.
      const { ticket } = await reportTicket(prisma, world, {
        // Execute the next setup or assertion step for this scenario.
        allowDuplicate: true,
      });
      // Await async work before asserting or releasing locks.
      await advanceTicketTo(world, ticket.id, "assigned");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "resolve", "from assigned");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "resume", "from assigned");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "close", "from assigned");
      // Await async work before asserting or releasing locks.
      await expectRefuse(ticket.id, "reopen", "from assigned");
    }
  });

  // Case: positive allowed transitions.
  it("positive allowed transitions", async () => {
    // Await async work before asserting or releasing locks.
    const { ticket } = await reportTicket(prisma, world);
    // Await async work before asserting or releasing locks.
    await assignMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      assigneeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
    });
    // Await async work before asserting or releasing locks.
    await startMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Await async work before asserting or releasing locks.
    await waitMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Await async work before asserting or releasing locks.
    await resumeMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.technician.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
    });
    // Await async work before asserting or releasing locks.
    await resolveMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      resolvedByEmployeeId: world.technician.employeeId,
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
    // Await async work before asserting or releasing locks.
    await reopenMaintenanceTicket({
      // Execute the next setup or assertion step for this scenario.
      ticketId: ticket.id,
      // Execute the next setup or assertion step for this scenario.
      reopenedByEmployeeId: world.owner.employeeId,
    });
    // row: synchronize actors so the race window is observable.
    const row = await loadTicket(prisma, ticket.id);
    // Assert HTTP status matches the contract for this path.
    assert.equal(row.status, TicketStatus.in_progress);
  });
});
