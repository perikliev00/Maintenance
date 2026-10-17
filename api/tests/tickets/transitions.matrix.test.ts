/**
 * T-TKT-02 / T-TKT-04 — assign + wrong-state matrix (P1-38, P1-40).
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import { PrismaClient, TicketStatus } from "@prisma/client";
import dotenv from "dotenv";
import {
  assignMaintenanceTicket,
  closeMaintenanceTicket,
  reopenMaintenanceTicket,
  resolveMaintenanceTicket,
  resumeMaintenanceTicket,
  startMaintenanceTicket,
  waitMaintenanceTicket,
} from "../../src/services/maintenance";
import {
  advanceTicketTo,
  cleanupTicketsWorld,
  countTicketEvents,
  createTicketsWorld,
  errCode,
  isAppError,
  loadTicket,
  reportTicket,
  type TicketsWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

async function snapshotSla(ticketId: string) {
  const t = await loadTicket(prisma, ticketId);
  return {
    status: t.status,
    dueAt: t.dueAt?.toISOString() ?? null,
    slaPausedAt: t.slaPausedAt?.toISOString() ?? null,
    slaPausedMsTotal: t.slaPausedMsTotal,
    eventCount: await countTicketEvents(prisma, ticketId),
  };
}

describe("ticket transition matrix (T-TKT-02/04 / P1-38/40)", () => {
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

  it("T-TKT-02a: assign refused from in_progress/waiting/resolved/closed (P1-38)", async () => {
    for (const target of ["in_progress", "waiting"] as const) {
      const { ticket } = await reportTicket(prisma, world);
      await advanceTicketTo(world, ticket.id, target);
      const before = await snapshotSla(ticket.id);
      try {
        await assignMaintenanceTicket({
          ticketId: ticket.id,
          assigneeId: world.technician2.employeeId,
          actorEmployeeId: world.owner.employeeId,
        });
        assert.fail(`expected assign refuse from ${target}`);
      } catch (err) {
        assert.equal(errCode(err), "invalid_state");
      }
      const after = await snapshotSla(ticket.id);
      assert.deepEqual(after, before);
    }

    const { ticket: resolvedT } = await reportTicket(prisma, world);
    await advanceTicketTo(world, resolvedT.id, "in_progress");
    await resolveMaintenanceTicket({
      ticketId: resolvedT.id,
      resolvedByEmployeeId: world.technician.employeeId,
      commandId: randomUUID(),
    });
    let before = await snapshotSla(resolvedT.id);
    try {
      await assignMaintenanceTicket({
        ticketId: resolvedT.id,
        assigneeId: world.technician2.employeeId,
        actorEmployeeId: world.owner.employeeId,
      });
      assert.fail("expected assign refuse from resolved");
    } catch (err) {
      assert.equal(errCode(err), "invalid_state");
    }
    assert.deepEqual(await snapshotSla(resolvedT.id), before);

    await closeMaintenanceTicket({
      ticketId: resolvedT.id,
      closedByEmployeeId: world.owner.employeeId,
    });
    before = await snapshotSla(resolvedT.id);
    try {
      await assignMaintenanceTicket({
        ticketId: resolvedT.id,
        assigneeId: world.technician2.employeeId,
        actorEmployeeId: world.owner.employeeId,
      });
      assert.fail("expected assign refuse from closed");
    } catch (err) {
      assert.equal(errCode(err), "invalid_state");
    }
    assert.deepEqual(await snapshotSla(resolvedT.id), before);
  });

  it("T-TKT-02b: assign allowed from new and assigned (positive)", async () => {
    const { ticket } = await reportTicket(prisma, world);
    await assignMaintenanceTicket({
      ticketId: ticket.id,
      assigneeId: world.technician.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });
    let row = await loadTicket(prisma, ticket.id);
    assert.equal(row.status, TicketStatus.assigned);
    assert.equal(row.assigneeId, world.technician.employeeId);

    await assignMaintenanceTicket({
      ticketId: ticket.id,
      assigneeId: world.technician2.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });
    row = await loadTicket(prisma, ticket.id);
    assert.equal(row.assigneeId, world.technician2.employeeId);
  });

  it("T-TKT-04: wrong-state start/wait/resume/resolve refuse without event or dueAt change (P1-40)", async () => {
    const { ticket } = await reportTicket(prisma, world);
    // new → cannot start/wait/resume/resolve
    let before = await snapshotSla(ticket.id);
    for (const op of ["start", "wait", "resume", "resolve"] as const) {
      try {
        if (op === "start") {
          await startMaintenanceTicket({
            ticketId: ticket.id,
            actorEmployeeId: world.technician.employeeId,
            commandId: randomUUID(),
          });
        } else if (op === "wait") {
          await waitMaintenanceTicket({
            ticketId: ticket.id,
            actorEmployeeId: world.technician.employeeId,
            commandId: randomUUID(),
          });
        } else if (op === "resume") {
          await resumeMaintenanceTicket({
            ticketId: ticket.id,
            actorEmployeeId: world.technician.employeeId,
            commandId: randomUUID(),
          });
        } else {
          await resolveMaintenanceTicket({
            ticketId: ticket.id,
            resolvedByEmployeeId: world.technician.employeeId,
            commandId: randomUUID(),
          });
        }
        assert.fail(`expected ${op} refuse from new`);
      } catch (err) {
        assert.ok(isAppError(err));
        assert.equal(err.code, "invalid_state");
      }
      assert.deepEqual(await snapshotSla(ticket.id), before);
    }

    await advanceTicketTo(world, ticket.id, "assigned");
    before = await snapshotSla(ticket.id);
    try {
      await waitMaintenanceTicket({
        ticketId: ticket.id,
        actorEmployeeId: world.technician.employeeId,
        commandId: randomUUID(),
      });
      assert.fail("expected wait refuse from assigned");
    } catch (err) {
      assert.equal(errCode(err), "invalid_state");
    }
    assert.deepEqual(await snapshotSla(ticket.id), before);

    await advanceTicketTo(world, ticket.id, "in_progress");
    before = await snapshotSla(ticket.id);
    try {
      await startMaintenanceTicket({
        ticketId: ticket.id,
        actorEmployeeId: world.technician.employeeId,
        commandId: randomUUID(),
      });
      assert.fail("expected second start refuse");
    } catch (err) {
      assert.equal(errCode(err), "invalid_state");
    }
    assert.deepEqual(await snapshotSla(ticket.id), before);

    try {
      await resumeMaintenanceTicket({
        ticketId: ticket.id,
        actorEmployeeId: world.technician.employeeId,
        commandId: randomUUID(),
      });
      assert.fail("expected resume refuse from in_progress");
    } catch (err) {
      assert.equal(errCode(err), "invalid_state");
    }
    assert.deepEqual(await snapshotSla(ticket.id), before);
  });

  it("T-TKT-04b: wait/resume/resolve/start refused from waiting/resolved/closed (P1-40)", async () => {
    async function expectRefuse(
      ticketId: string,
      op: "start" | "wait" | "resume" | "resolve" | "close" | "reopen",
      label: string,
    ) {
      const before = await snapshotSla(ticketId);
      try {
        if (op === "start") {
          await startMaintenanceTicket({
            ticketId,
            actorEmployeeId: world.technician.employeeId,
            bypassAssigneeCheck: true,
            commandId: randomUUID(),
          });
        } else if (op === "wait") {
          await waitMaintenanceTicket({
            ticketId,
            actorEmployeeId: world.technician.employeeId,
            bypassAssigneeCheck: true,
            commandId: randomUUID(),
          });
        } else if (op === "resume") {
          await resumeMaintenanceTicket({
            ticketId,
            actorEmployeeId: world.technician.employeeId,
            bypassAssigneeCheck: true,
            commandId: randomUUID(),
          });
        } else if (op === "resolve") {
          await resolveMaintenanceTicket({
            ticketId,
            resolvedByEmployeeId: world.technician.employeeId,
            bypassAssigneeCheck: true,
            commandId: randomUUID(),
          });
        } else if (op === "close") {
          await closeMaintenanceTicket({
            ticketId,
            closedByEmployeeId: world.owner.employeeId,
          });
        } else {
          await reopenMaintenanceTicket({
            ticketId,
            reopenedByEmployeeId: world.owner.employeeId,
          });
        }
        assert.fail(`expected ${op} refuse ${label}`);
      } catch (err) {
        assert.ok(isAppError(err), `${op} ${label}: ${String(err)}`);
        assert.equal(err.code, "invalid_state");
      }
      assert.deepEqual(await snapshotSla(ticketId), before);
    }

    // waiting: start/wait/close/reopen refused; resume+resolve allowed (tested elsewhere)
    {
      const { ticket } = await reportTicket(prisma, world);
      await advanceTicketTo(world, ticket.id, "waiting");
      await expectRefuse(ticket.id, "start", "from waiting");
      await expectRefuse(ticket.id, "wait", "from waiting");
      await expectRefuse(ticket.id, "close", "from waiting");
      await expectRefuse(ticket.id, "reopen", "from waiting");
    }

    // resolved: wait/resume/resolve/start/close(ok)/reopen(ok) — refuse wait/resume/resolve/start
    {
      const { ticket } = await reportTicket(prisma, world);
      await advanceTicketTo(world, ticket.id, "in_progress");
      await resolveMaintenanceTicket({
        ticketId: ticket.id,
        resolvedByEmployeeId: world.technician.employeeId,
        commandId: randomUUID(),
      });
      await expectRefuse(ticket.id, "start", "from resolved");
      await expectRefuse(ticket.id, "wait", "from resolved");
      await expectRefuse(ticket.id, "resume", "from resolved");
      await expectRefuse(ticket.id, "resolve", "from resolved");
    }

    // closed: wait/resume/resolve/start/close refused
    {
      const { ticket } = await reportTicket(prisma, world);
      await advanceTicketTo(world, ticket.id, "in_progress");
      await resolveMaintenanceTicket({
        ticketId: ticket.id,
        resolvedByEmployeeId: world.technician.employeeId,
        commandId: randomUUID(),
      });
      await closeMaintenanceTicket({
        ticketId: ticket.id,
        closedByEmployeeId: world.owner.employeeId,
      });
      await expectRefuse(ticket.id, "start", "from closed");
      await expectRefuse(ticket.id, "wait", "from closed");
      await expectRefuse(ticket.id, "resume", "from closed");
      await expectRefuse(ticket.id, "resolve", "from closed");
      await expectRefuse(ticket.id, "close", "from closed");
    }

    // assigned: resolve/resume/close/reopen refused (wait already covered in T-TKT-04)
    {
      const { ticket } = await reportTicket(prisma, world);
      await advanceTicketTo(world, ticket.id, "assigned");
      await expectRefuse(ticket.id, "resolve", "from assigned");
      await expectRefuse(ticket.id, "resume", "from assigned");
      await expectRefuse(ticket.id, "close", "from assigned");
      await expectRefuse(ticket.id, "reopen", "from assigned");
    }
  });

  it("T-TKT-02c: positive allowed transitions", async () => {
    const { ticket } = await reportTicket(prisma, world);
    await assignMaintenanceTicket({
      ticketId: ticket.id,
      assigneeId: world.technician.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });
    await startMaintenanceTicket({
      ticketId: ticket.id,
      actorEmployeeId: world.technician.employeeId,
      commandId: randomUUID(),
    });
    await waitMaintenanceTicket({
      ticketId: ticket.id,
      actorEmployeeId: world.technician.employeeId,
      commandId: randomUUID(),
    });
    await resumeMaintenanceTicket({
      ticketId: ticket.id,
      actorEmployeeId: world.technician.employeeId,
      commandId: randomUUID(),
    });
    await resolveMaintenanceTicket({
      ticketId: ticket.id,
      resolvedByEmployeeId: world.technician.employeeId,
      commandId: randomUUID(),
    });
    await closeMaintenanceTicket({
      ticketId: ticket.id,
      closedByEmployeeId: world.owner.employeeId,
    });
    await reopenMaintenanceTicket({
      ticketId: ticket.id,
      reopenedByEmployeeId: world.owner.employeeId,
    });
    const row = await loadTicket(prisma, ticket.id);
    assert.equal(row.status, TicketStatus.in_progress);
  });
});
