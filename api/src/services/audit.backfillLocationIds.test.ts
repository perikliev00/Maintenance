/**
 * Historical BUG-01 repair: null locationId SLA/overdue rows get room ids.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../db";
import { assertTestDatabase } from "../../tests/assertTestDatabase";
import {
  cleanupCleaningWorld,
  createCleaningWorld,
  type CleaningWorld,
} from "../../tests/cleaning/fixtures";
import { backfillAuditLocationIds } from "./audit.backfillLocationIds";

describe("backfillAuditLocationIds", () => {
  let world: CleaningWorld;
  const ids: string[] = [];

  before(async () => {
    await assertTestDatabase(prisma);
    world = await createCleaningWorld(prisma);
  });

  after(async () => {
    if (ids.length) {
      await prisma.auditEvent.deleteMany({ where: { id: { in: ids } } });
    }
    if (world) {
      await prisma.maintenanceTicket.deleteMany({
        where: { locationId: { in: [world.locationAId, world.locationBId] } },
      });
      await prisma.cleaningSession.deleteMany({
        where: {
          task: { locationId: { in: [world.locationAId, world.locationBId] } },
        },
      });
      await prisma.cleaningTask.deleteMany({
        where: { locationId: { in: [world.locationAId, world.locationBId] } },
      });
      await cleanupCleaningWorld(prisma, world);
    }
    await prisma.$disconnect();
  });

  it("fills null locationId for SLA and overdue audit rows", async () => {
    const ticket = await prisma.maintenanceTicket.create({
      data: {
        status: "new",
        locationId: world.locationAId,
        title: "Backfill SLA",
        categoryKey: "other",
        categoryLabelBg: "Друго",
        categoryLabelEn: "Other",
        reportedByEmployeeId: world.owner.employeeId,
      },
    });
    const task = await prisma.cleaningTask.create({
      data: {
        locationId: world.locationBId,
        hotelDate: new Date("2026-03-01"),
        status: "cancelled",
        cleaningCycle: 0,
      },
    });
    const session = await prisma.cleaningSession.create({
      data: {
        taskId: task.id,
        employeeId: world.hk1.employeeId,
        status: "completed",
        startedAt: new Date(),
        finishedAt: new Date(),
        startCommandId: randomUUID(),
      },
    });

    const slaId = randomUUID();
    const overdueId = randomUUID();
    ids.push(slaId, overdueId);
    await prisma.auditEvent.createMany({
      data: [
        {
          id: slaId,
          action: "ticket.sla_breach",
          entityType: "maintenance_ticket",
          entityId: ticket.id,
          locationId: null,
          occurredAt: new Date(),
        },
        {
          id: overdueId,
          action: "session.overdue_detected",
          entityType: "cleaning_session",
          entityId: session.id,
          locationId: null,
          occurredAt: new Date(),
        },
      ],
    });

    const result = await backfillAuditLocationIds();
    assert.ok(result.slaUpdated >= 1);
    assert.ok(result.overdueUpdated >= 1);

    const sla = await prisma.auditEvent.findUniqueOrThrow({ where: { id: slaId } });
    const overdue = await prisma.auditEvent.findUniqueOrThrow({
      where: { id: overdueId },
    });
    assert.equal(sla.locationId, world.locationAId);
    assert.equal(overdue.locationId, world.locationBId);

    // Idempotent second pass.
    const again = await backfillAuditLocationIds();
    assert.equal(again.slaUpdated, 0);
    assert.equal(again.overdueUpdated, 0);
  });
});
