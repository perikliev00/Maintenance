/**
 * Backfill repair: null locationId SLA/overdue rows get room ids.
 */
import assert from "node:assert/strict";
// Import module dependency from node:crypto.
import { randomUUID } from "node:crypto";
// Import module dependency from node:test.
import { after, before, describe, it } from "node:test";
// Import module dependency from ../db.
import { prisma } from "../db";
// Import module dependency from ../../tests/assertTestDatabase.
import { assertTestDatabase } from "../../tests/assertTestDatabase";
// Import module dependency used by this file.
import {
  // List item in import/export/params.
  cleanupCleaningWorld,
  // List item in import/export/params.
  createCleaningWorld,
  // Declare type alias CleaningWorld.
  type CleaningWorld,
// Support the surrounding logic for this step.
} from "../../tests/cleaning/fixtures";
// Import module dependency from ./backfillAuditLocationIds.
import { backfillAuditLocationIds } from "./backfillAuditLocationIds";

// Group related tests under a shared suite name.
describe("backfillAuditLocationIds", () => {
  // Bind world for use in the following logic.
  let world: CleaningWorld;
  // Initialize an array used by subsequent logic.
  const ids: string[] = [];

  // Register test lifecycle hook for setup or teardown.
  before(async () => {
    // Wait for an async operation before continuing.
    await assertTestDatabase(prisma);
    // Support the surrounding logic for this step.
    world = await createCleaningWorld(prisma);
  });

  // Register test lifecycle hook for setup or teardown.
  after(async () => {
    // Conditional branch for the case described by this guard.
    if (ids.length) {
      // Wait for an async operation before continuing.
      await prisma.auditEvent.deleteMany({ where: { id: { in: ids } } });
    }
    // Conditional branch for the case described by this guard.
    if (world) {
      // Wait for an async operation before continuing.
      await prisma.maintenanceTicket.deleteMany({
        // Provide where field used by this structure.
        where: { locationId: { in: [world.locationAId, world.locationBId] } },
      });
      // Wait for an async operation before continuing.
      await prisma.cleaningSession.deleteMany({
        // Provide where field used by this structure.
        where: {
          // Provide task field used by this structure.
          task: { locationId: { in: [world.locationAId, world.locationBId] } },
        },
      });
      // Wait for an async operation before continuing.
      await prisma.cleaningTask.deleteMany({
        // Provide where field used by this structure.
        where: { locationId: { in: [world.locationAId, world.locationBId] } },
      });
      // Wait for an async operation before continuing.
      await cleanupCleaningWorld(prisma, world);
    }
    // Wait for an async operation before continuing.
    await prisma.$disconnect();
  });

  // Define a single test case and its expectation.
  it("fills null locationId for SLA and overdue audit rows", async () => {
    // Bind ticket for use in the following logic.
    const ticket = await prisma.maintenanceTicket.create({
      // Provide data field used by this structure.
      data: {
        // Provide status field used by this structure.
        status: "new",
        // Provide locationId field used by this structure.
        locationId: world.locationAId,
        // Provide title field used by this structure.
        title: "Backfill SLA",
        // Provide categoryKey field used by this structure.
        categoryKey: "other",
        // Provide categoryLabelBg field used by this structure.
        categoryLabelBg: "Друго",
        // Provide categoryLabelEn field used by this structure.
        categoryLabelEn: "Other",
        // Provide reportedByEmployeeId field used by this structure.
        reportedByEmployeeId: world.owner.employeeId,
      },
    });
    // Bind task for use in the following logic.
    const task = await prisma.cleaningTask.create({
      // Provide data field used by this structure.
      data: {
        // Provide locationId field used by this structure.
        locationId: world.locationBId,
        // Provide hotelDate field used by this structure.
        hotelDate: new Date("2026-03-01"),
        // Provide status field used by this structure.
        status: "cancelled",
        // Provide cleaningCycle field used by this structure.
        cleaningCycle: 0,
      },
    });
    // Bind session for use in the following logic.
    const session = await prisma.cleaningSession.create({
      // Provide data field used by this structure.
      data: {
        // Provide taskId field used by this structure.
        taskId: task.id,
        // Provide employeeId field used by this structure.
        employeeId: world.hk1.employeeId,
        // Provide status field used by this structure.
        status: "completed",
        // Provide startedAt field used by this structure.
        startedAt: new Date(),
        // Provide finishedAt field used by this structure.
        finishedAt: new Date(),
        // Provide startCommandId field used by this structure.
        startCommandId: randomUUID(),
      },
    });

    // Bind slaId for use in the following logic.
    const slaId = randomUUID();
    // Bind overdueId for use in the following logic.
    const overdueId = randomUUID();
    // Invoke ids.push to perform this step.
    ids.push(slaId, overdueId);
    // Wait for an async operation before continuing.
    await prisma.auditEvent.createMany({
      // Provide data field used by this structure.
      data: [
        {
          // Provide id field used by this structure.
          id: slaId,
          // Provide action field used by this structure.
          action: "ticket.sla_breach",
          // Provide entityType field used by this structure.
          entityType: "maintenance_ticket",
          // Provide entityId field used by this structure.
          entityId: ticket.id,
          // Provide locationId field used by this structure.
          locationId: null,
          // Provide occurredAt field used by this structure.
          occurredAt: new Date(),
        },
        {
          // Provide id field used by this structure.
          id: overdueId,
          // Provide action field used by this structure.
          action: "session.overdue_detected",
          // Provide entityType field used by this structure.
          entityType: "cleaning_session",
          // Provide entityId field used by this structure.
          entityId: session.id,
          // Provide locationId field used by this structure.
          locationId: null,
          // Provide occurredAt field used by this structure.
          occurredAt: new Date(),
        },
      ],
    });

    // Bind result for use in the following logic.
    const result = await backfillAuditLocationIds();
    // Assert expected behavior in this test case.
    assert.ok(result.slaUpdated >= 1);
    // Assert expected behavior in this test case.
    assert.ok(result.overdueUpdated >= 1);

    // Bind sla for use in the following logic.
    const sla = await prisma.auditEvent.findUniqueOrThrow({ where: { id: slaId } });
    // Bind overdue for use in the following logic.
    const overdue = await prisma.auditEvent.findUniqueOrThrow({
      // Provide where field used by this structure.
      where: { id: overdueId },
    });
    // Assert expected behavior in this test case.
    assert.equal(sla.locationId, world.locationAId);
    // Assert expected behavior in this test case.
    assert.equal(overdue.locationId, world.locationBId);

    // Idempotent second pass.
    const again = await backfillAuditLocationIds();
    // Assert expected behavior in this test case.
    assert.equal(again.slaUpdated, 0);
    // Assert expected behavior in this test case.
    assert.equal(again.overdueUpdated, 0);
  });
});
