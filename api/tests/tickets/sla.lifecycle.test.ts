/**
 * T-TKT-05…07 — SLA dueAt on create, wait/resume, resolve-from-waiting (P1-41…43).
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import { Priority, PrismaClient, TicketStatus } from "@prisma/client";
import dotenv from "dotenv";
import {
  resolveMaintenanceTicket,
  resumeMaintenanceTicket,
  waitMaintenanceTicket,
} from "../../src/services/maintenance";
import { resolveSlaForPriority } from "../../src/services/slaPolicies";
import {
  advanceTicketTo,
  cleanupTicketsWorld,
  countTicketEvents,
  createTicketsWorld,
  errCode,
  loadTicket,
  reportTicket,
  withDefaultSlaHours,
  withSlaPolicyPatch,
  type TicketsWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

describe("ticket SLA lifecycle (T-TKT-05…07 / P1-41…43)", () => {
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

  it("T-TKT-05a: dueAt from active SLA policy hours (P1-41)", async () => {
    const T0 = new Date("2026-06-01T10:00:00.000Z");
    await withSlaPolicyPatch(
      prisma,
      world.owner.employeeId,
      Priority.urgent,
      { hours: 5, isActive: true },
      async () => {
        const expected = await resolveSlaForPriority(Priority.urgent);
        assert.equal(expected.hours, 5);
        assert.ok(expected.policyId);

        const { ticket } = await reportTicket(prisma, world, {
          priority: Priority.urgent,
          now: T0,
        });
        const row = await loadTicket(prisma, ticket.id);
        assert.equal(row.dueAt?.toISOString(), new Date(T0.getTime() + 5 * 3600_000).toISOString());
        assert.equal(row.slaHoursSnapshot, 5);
        assert.equal(row.slaPolicyId, expected.policyId);
      },
    );
  });

  it("T-TKT-05b: inactive policy falls back to defaultTicketSlaHours (P1-41)", async () => {
    const T0 = new Date("2026-06-01T12:00:00.000Z");
    await withSlaPolicyPatch(
      prisma,
      world.owner.employeeId,
      Priority.low,
      { isActive: false },
      async () => {
        await withDefaultSlaHours(world.owner.employeeId, 17, async () => {
          const expected = await resolveSlaForPriority(Priority.low);
          assert.equal(expected.hours, 17);
          assert.equal(expected.policyId, null);

          const { ticket } = await reportTicket(prisma, world, {
            priority: Priority.low,
            now: T0,
          });
          const row = await loadTicket(prisma, ticket.id);
          assert.equal(
            row.dueAt?.toISOString(),
            new Date(T0.getTime() + 17 * 3600_000).toISOString(),
          );
          assert.equal(row.slaHoursSnapshot, 17);
          assert.equal(row.slaPolicyId, null);
        });
      },
    );
  });

  it("T-TKT-06: wait→resume extends dueAt exactly; repeat resume does not double-extend (P1-42)", async () => {
    const T0 = new Date("2026-07-01T08:00:00.000Z");
    const T1 = new Date("2026-07-01T09:00:00.000Z");
    const T2 = new Date("2026-07-01T10:30:00.000Z");
    const pauseMs = T2.getTime() - T1.getTime();

    const { ticket } = await reportTicket(prisma, world, {
      priority: Priority.normal,
      now: T0,
    });
    await advanceTicketTo(world, ticket.id, "in_progress");
    const beforeWait = await loadTicket(prisma, ticket.id);
    const dueAt0 = beforeWait.dueAt!;
    assert.ok(dueAt0);

    await waitMaintenanceTicket({
      ticketId: ticket.id,
      actorEmployeeId: world.technician.employeeId,
      commandId: randomUUID(),
      now: T1,
    });
    let row = await loadTicket(prisma, ticket.id);
    assert.equal(row.status, TicketStatus.waiting);
    assert.equal(row.slaPausedAt?.toISOString(), T1.toISOString());

    await resumeMaintenanceTicket({
      ticketId: ticket.id,
      actorEmployeeId: world.technician.employeeId,
      commandId: randomUUID(),
      now: T2,
    });
    row = await loadTicket(prisma, ticket.id);
    assert.equal(row.status, TicketStatus.in_progress);
    assert.equal(row.slaPausedAt, null);
    assert.equal(row.slaPausedMsTotal, pauseMs);
    assert.equal(
      row.dueAt?.toISOString(),
      new Date(dueAt0.getTime() + pauseMs).toISOString(),
    );

    const dueAfter = row.dueAt!.toISOString();
    const totalAfter = row.slaPausedMsTotal;

    // Repeat resume from in_progress → invalid_state; dueAt unchanged
    try {
      await resumeMaintenanceTicket({
        ticketId: ticket.id,
        actorEmployeeId: world.technician.employeeId,
        commandId: randomUUID(),
        now: new Date(T2.getTime() + 60_000),
      });
      assert.fail("expected resume refuse when not waiting");
    } catch (err) {
      assert.equal(errCode(err), "invalid_state");
    }
    row = await loadTicket(prisma, ticket.id);
    assert.equal(row.dueAt?.toISOString(), dueAfter);
    assert.equal(row.slaPausedMsTotal, totalAfter);
  });

  it("T-TKT-07: resolve-from-waiting closes pause and stamps resolver (P1-43)", async () => {
    const T0 = new Date("2026-08-01T08:00:00.000Z");
    const T1 = new Date("2026-08-01T09:00:00.000Z");
    const T2 = new Date("2026-08-01T11:00:00.000Z");
    const pauseMs = T2.getTime() - T1.getTime();

    const { ticket } = await reportTicket(prisma, world, { now: T0 });
    await advanceTicketTo(world, ticket.id, "in_progress");
    const dueAt0 = (await loadTicket(prisma, ticket.id)).dueAt!;

    await waitMaintenanceTicket({
      ticketId: ticket.id,
      actorEmployeeId: world.technician.employeeId,
      commandId: randomUUID(),
      now: T1,
    });

    const eventsBefore = await countTicketEvents(prisma, ticket.id);
    await resolveMaintenanceTicket({
      ticketId: ticket.id,
      resolvedByEmployeeId: world.technician.employeeId,
      resolutionNotes: "fixed while waiting",
      commandId: randomUUID(),
      now: T2,
    });

    const row = await loadTicket(prisma, ticket.id);
    assert.equal(row.status, TicketStatus.resolved);
    assert.equal(row.slaPausedAt, null);
    assert.equal(row.slaPausedMsTotal, pauseMs);
    assert.equal(
      row.dueAt?.toISOString(),
      new Date(dueAt0.getTime() + pauseMs).toISOString(),
    );
    assert.equal(row.resolvedByEmployeeId, world.technician.employeeId);
    assert.equal(row.resolutionNotes, "fixed while waiting");
    assert.equal(row.resolvedAt?.toISOString(), T2.toISOString());
    assert.equal(await countTicketEvents(prisma, ticket.id), eventsBefore + 1);
  });
});
