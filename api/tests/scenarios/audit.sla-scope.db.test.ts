/**
 * SLA / overdue audit events with locationId are visible under sector
 * scope and location filters; foreign rooms stay hidden.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
import {
  cleanupCleaningWorld,
  createCleaningWorld,
  // Shape CleaningWorld documents the fixture/response fields this suite touches.
  type CleaningWorld,
} from "../cleaning/fixtures";
import { runTicketSlaBreach } from "../../src/services/jobs/ticketSlaBreach";
import { listAuditEvents } from "../../src/services/audit";
import { getSetting, updateSetting } from "../../src/services/settings";

// Suite: audit SLA location scope.
describe("audit SLA location scope", () => {
  let world: CleaningWorld;
  let operations: Awaited<ReturnType<typeof getSetting<"operations">>>;
  const now = Date.parse("2026-02-01T12:00:00Z");

  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    world = await createCleaningWorld(prisma);
    operations = await getSetting("operations");
    await updateSetting({
      key: "operations",
      value: { ...operations, overdueSessionMinutes: 60 },
      actorEmployeeId: world.owner.employeeId,
      reason: "audit sla scope baseline",
    });
  });

  after(async () => {
    if (world) {
      await updateSetting({
        key: "operations",
        value: operations,
        actorEmployeeId: world.owner.employeeId,
        reason: "restore",
      });
      await prisma.notification.deleteMany({
        where: { locationId: { in: [world.locationAId, world.locationBId] } },
      });
      await prisma.ticketEvent.deleteMany({
        where: {
          ticket: { locationId: { in: [world.locationAId, world.locationBId] } },
        },
      });
      await prisma.auditEvent.deleteMany({
        where: {
          OR: [
            { actorEmployeeId: { in: world.employeeIds } },
            { locationId: { in: [world.locationAId, world.locationBId] } },
          ],
        },
      });
      await prisma.maintenanceTicket.deleteMany({
        where: { locationId: { in: [world.locationAId, world.locationBId] } },
      });
      await cleanupCleaningWorld(prisma, world);
    }
    await prisma.$disconnect();
  });

  // Case: scoped list includes own-room SLA and excludes foreign-room SLA.
  it("scoped list includes own-room SLA and excludes foreign-room SLA", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now });
    try {
      // own: seeded entity required before the mutation under test.
      const own = await prisma.maintenanceTicket.create({
        data: {
          status: "new",
          dueAt: new Date(now - 1),
          locationId: world.locationAId,
          title: "Own SLA",
          categoryKey: "other",
          categoryLabelBg: "Друго",
          categoryLabelEn: "Other",
          reportedByEmployeeId: world.owner.employeeId,
          assigneeId: world.technician.employeeId,
        },
      });
      // foreign: seeded entity required before the mutation under test.
      const foreign = await prisma.maintenanceTicket.create({
        data: {
          status: "new",
          dueAt: new Date(now - 1),
          locationId: world.locationBId,
          title: "Foreign SLA",
          categoryKey: "other",
          categoryLabelBg: "Друго",
          categoryLabelEn: "Other",
          reportedByEmployeeId: world.owner.employeeId,
          assigneeId: world.technician.employeeId,
        },
      });

      await runTicketSlaBreach();

      const ownScoped = await listAuditEvents({
        action: "ticket.sla_breach",
        scopeLocationIds: [world.locationAId],
        limit: 50,
      });
      assert.ok(ownScoped.some((row) => row.entityId === own.id));
      assert.ok(ownScoped.every((row) => row.locationId === world.locationAId));
      assert.equal(
        ownScoped.some((row) => row.entityId === foreign.id),
        false,
      );

      const byLocation = await listAuditEvents({
        action: "ticket.sla_breach",
        locationId: world.locationAId,
        limit: 50,
      });
      assert.ok(byLocation.some((row) => row.entityId === own.id));
      assert.equal(
        byLocation.some((row) => row.entityId === foreign.id),
        false,
      );
    } finally {
      t.mock.timers.reset();
    }
  });
});
