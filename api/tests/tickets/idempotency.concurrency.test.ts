/**
 * T-TKT-08…10 — concurrent/idempotent commandId (P1-44…46).
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
  findActiveIssueOption,
  loadTicket,
  reportTicket,
  type TicketsWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

describe("ticket commandId concurrency (T-TKT-08…10 / P1-44…46)", () => {
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

  it("T-TKT-08: concurrent start with same commandId → one event (P1-44)", async () => {
    const { ticket } = await reportTicket(prisma, world);
    await advanceTicketTo(world, ticket.id, "assigned");
    const commandId = randomUUID();
    const eventsBefore = await countTicketEvents(prisma, ticket.id);

    const results = await Promise.allSettled([
      startMaintenanceTicket({
        ticketId: ticket.id,
        actorEmployeeId: world.technician.employeeId,
        commandId,
      }),
      startMaintenanceTicket({
        ticketId: ticket.id,
        actorEmployeeId: world.technician.employeeId,
        commandId,
      }),
    ]);

    for (const r of results) {
      assert.equal(r.status, "fulfilled", String(r));
      if (r.status === "fulfilled") {
        assert.equal(r.value.status, TicketStatus.in_progress);
        assert.equal(r.value.id, ticket.id);
      }
    }

    assert.equal(
      await countTicketEvents(prisma, ticket.id, commandId),
      1,
    );
    assert.equal(
      await countTicketEvents(prisma, ticket.id),
      eventsBefore + 1,
    );
  });

  it("T-TKT-08b: concurrent wait with same commandId → one event (P1-44)", async () => {
    const { ticket } = await reportTicket(prisma, world);
    await advanceTicketTo(world, ticket.id, "in_progress");
    const commandId = randomUUID();
    const eventsBefore = await countTicketEvents(prisma, ticket.id);
    const before = await loadTicket(prisma, ticket.id);

    const results = await Promise.allSettled([
      waitMaintenanceTicket({
        ticketId: ticket.id,
        actorEmployeeId: world.technician.employeeId,
        commandId,
        reason: "parts",
      }),
      waitMaintenanceTicket({
        ticketId: ticket.id,
        actorEmployeeId: world.technician.employeeId,
        commandId,
        reason: "parts",
      }),
    ]);

    for (const r of results) {
      assert.equal(r.status, "fulfilled", String(r));
      if (r.status === "fulfilled") {
        assert.equal(r.value.status, TicketStatus.waiting);
        assert.equal(r.value.id, ticket.id);
      }
    }

    const row = await loadTicket(prisma, ticket.id);
    assert.equal(row.status, TicketStatus.waiting);
    assert.ok(row.slaPausedAt);
    assert.equal(row.dueAt?.toISOString() ?? null, before.dueAt?.toISOString() ?? null);
    assert.equal(await countTicketEvents(prisma, ticket.id, commandId), 1);
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsBefore + 1);
  });

  it("T-TKT-08c: concurrent resume with same commandId → one event, one unpause (P1-44)", async () => {
    const T1 = new Date("2026-09-01T09:00:00.000Z");
    const T2 = new Date("2026-09-01T10:00:00.000Z");
    const pauseMs = T2.getTime() - T1.getTime();

    const { ticket } = await reportTicket(prisma, world, {
      now: new Date("2026-09-01T08:00:00.000Z"),
    });
    await advanceTicketTo(world, ticket.id, "in_progress");
    const dueAt0 = (await loadTicket(prisma, ticket.id)).dueAt!;
    await waitMaintenanceTicket({
      ticketId: ticket.id,
      actorEmployeeId: world.technician.employeeId,
      commandId: randomUUID(),
      now: T1,
    });

    const commandId = randomUUID();
    const eventsBefore = await countTicketEvents(prisma, ticket.id);

    const results = await Promise.allSettled([
      resumeMaintenanceTicket({
        ticketId: ticket.id,
        actorEmployeeId: world.technician.employeeId,
        commandId,
        now: T2,
      }),
      resumeMaintenanceTicket({
        ticketId: ticket.id,
        actorEmployeeId: world.technician.employeeId,
        commandId,
        now: T2,
      }),
    ]);

    for (const r of results) {
      assert.equal(r.status, "fulfilled", String(r));
      if (r.status === "fulfilled") {
        assert.equal(r.value.status, TicketStatus.in_progress);
      }
    }

    const row = await loadTicket(prisma, ticket.id);
    assert.equal(row.status, TicketStatus.in_progress);
    assert.equal(row.slaPausedAt, null);
    assert.equal(row.slaPausedMsTotal, pauseMs);
    assert.equal(
      row.dueAt?.toISOString(),
      new Date(dueAt0.getTime() + pauseMs).toISOString(),
    );
    assert.equal(await countTicketEvents(prisma, ticket.id, commandId), 1);
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsBefore + 1);
  });

  it("T-TKT-08d: concurrent resolve with same commandId → one event (P1-44)", async () => {
    const { ticket } = await reportTicket(prisma, world);
    await advanceTicketTo(world, ticket.id, "in_progress");
    const commandId = randomUUID();
    const eventsBefore = await countTicketEvents(prisma, ticket.id);

    const results = await Promise.allSettled([
      resolveMaintenanceTicket({
        ticketId: ticket.id,
        resolvedByEmployeeId: world.technician.employeeId,
        resolutionNotes: "done",
        commandId,
      }),
      resolveMaintenanceTicket({
        ticketId: ticket.id,
        resolvedByEmployeeId: world.technician.employeeId,
        resolutionNotes: "done",
        commandId,
      }),
    ]);

    for (const r of results) {
      assert.equal(r.status, "fulfilled", String(r));
      if (r.status === "fulfilled") {
        assert.equal(r.value.status, TicketStatus.resolved);
        assert.equal(r.value.id, ticket.id);
      }
    }

    const row = await loadTicket(prisma, ticket.id);
    assert.equal(row.status, TicketStatus.resolved);
    assert.equal(row.resolvedByEmployeeId, world.technician.employeeId);
    assert.equal(row.resolutionNotes, "done");
    assert.equal(await countTicketEvents(prisma, ticket.id, commandId), 1);
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsBefore + 1);
  });

  it("T-TKT-09: commandId not reusable across action kinds or tickets (P1-45)", async () => {
    const { ticket: t1 } = await reportTicket(prisma, world);
    await advanceTicketTo(world, t1.id, "assigned");
    const commandId = randomUUID();

    await startMaintenanceTicket({
      ticketId: t1.id,
      actorEmployeeId: world.technician.employeeId,
      commandId,
    });

    try {
      await waitMaintenanceTicket({
        ticketId: t1.id,
        actorEmployeeId: world.technician.employeeId,
        commandId,
      });
      assert.fail("expected conflict reusing start commandId for wait");
    } catch (err) {
      assert.equal(errCode(err), "conflict");
    }

    const { ticket: t2 } = await reportTicket(prisma, world, {
      locationId: world.locationBId,
    });
    await advanceTicketTo(world, t2.id, "assigned", world.technician2.employeeId);
    try {
      await startMaintenanceTicket({
        ticketId: t2.id,
        actorEmployeeId: world.technician2.employeeId,
        commandId,
      });
      assert.fail("expected conflict reusing commandId on other ticket");
    } catch (err) {
      assert.equal(errCode(err), "conflict");
    }

    // Create commandId then lifecycle on another ticket
    const createId = randomUUID();
    await reportTicket(prisma, world, {
      locationId: world.locationBId,
      commandId: createId,
    });
    const { ticket: t3 } = await reportTicket(prisma, world);
    await advanceTicketTo(world, t3.id, "assigned");
    try {
      await startMaintenanceTicket({
        ticketId: t3.id,
        actorEmployeeId: world.technician.employeeId,
        commandId: createId,
      });
      assert.fail("expected conflict create commandId reused for start");
    } catch (err) {
      assert.equal(errCode(err), "conflict");
    }

    // Create replay with different payload → conflict
    const opt = await findActiveIssueOption(prisma);
    const cid = randomUUID();
    await createMaintenanceTicket({
      locationId: world.locationAId,
      issueOptionId: opt.id,
      blocksRoom: false,
      reportedByEmployeeId: world.owner.employeeId,
      commandId: cid,
    });
    try {
      await createMaintenanceTicket({
        locationId: world.locationBId,
        issueOptionId: opt.id,
        blocksRoom: true,
        reportedByEmployeeId: world.owner.employeeId,
        commandId: cid,
        title: "different",
      });
      assert.fail("expected conflict on create fingerprint mismatch");
    } catch (err) {
      assert.equal(errCode(err), "conflict");
    }
  });

  it("T-TKT-10: concurrent create same commandId → one ticket + one history (P1-46)", async () => {
    const option = await findActiveIssueOption(prisma);
    const commandId = randomUUID();
    const payload = {
      locationId: world.locationAId,
      issueOptionId: option.id,
      blocksRoom: false,
      reportedByEmployeeId: world.owner.employeeId,
      commandId,
    };

    const results = await Promise.allSettled([
      createMaintenanceTicket(payload),
      createMaintenanceTicket(payload),
    ]);

    for (const r of results) {
      assert.equal(r.status, "fulfilled", String(r));
    }
    const tickets = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createMaintenanceTicket>>> =>
        r.status === "fulfilled",
      )
      .map((r) => r.value.ticket);

    assert.equal(tickets[0]!.id, tickets[1]!.id);
    const count = await prisma.maintenanceTicket.count({
      where: { commandId },
    });
    assert.equal(count, 1);
    assert.equal(
      await countTicketEvents(prisma, tickets[0]!.id, commandId),
      1,
    );
    const createdEvents = await prisma.ticketEvent.count({
      where: {
        ticketId: tickets[0]!.id,
        toStatus: TicketStatus.new,
      },
    });
    assert.equal(createdEvents, 1);

    const row = await loadTicket(prisma, tickets[0]!.id);
    assert.equal(row.status, TicketStatus.new);
  });
});
