/**
 * SLA / overdue audit events with locationId are visible under sector
 * scope and location filters; foreign rooms stay hidden.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  createCleaningWorld,
  // Shape CleaningWorld documents the fixture/response fields this suite touches.
  type CleaningWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../cleaning/fixtures";
// Import bindings from ../../src/services/jobs/ticketSlaBreach.
import { runTicketSlaBreach } from "../../src/services/jobs/ticketSlaBreach";
// Import bindings from ../../src/services/audit.
import { listAuditEvents } from "../../src/services/audit";
// Import bindings from ../../src/services/settings.
import { getSetting, updateSetting } from "../../src/services/settings";

// Suite: audit SLA location scope.
describe("audit SLA location scope", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: CleaningWorld;
  // Execute the next setup or assertion step for this scenario.
  let operations: Awaited<ReturnType<typeof getSetting<"operations">>>;
  // Bind now for later setup or assertions in this scope.
  const now = Date.parse("2026-02-01T12:00:00Z");

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma);
    // Await async work before asserting or releasing locks.
    operations = await getSetting("operations");
    // Await async work before asserting or releasing locks.
    await updateSetting({
      // Execute the next setup or assertion step for this scenario.
      key: "operations",
      // Session/CSRF step exercising auth lifecycle.
      value: { ...operations, overdueSessionMinutes: 60 },
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "audit sla scope baseline",
    });
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) {
      // Await async work before asserting or releasing locks.
      await updateSetting({
        // Execute the next setup or assertion step for this scenario.
        key: "operations",
        // Execute the next setup or assertion step for this scenario.
        value: operations,
        // Execute the next setup or assertion step for this scenario.
        actorEmployeeId: world.owner.employeeId,
        // Execute the next setup or assertion step for this scenario.
        reason: "restore",
      });
      // Await async work before asserting or releasing locks.
      await prisma.notification.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { locationId: { in: [world.locationAId, world.locationBId] } },
      });
      // Await async work before asserting or releasing locks.
      await prisma.ticketEvent.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Execute the next setup or assertion step for this scenario.
          ticket: { locationId: { in: [world.locationAId, world.locationBId] } },
        },
      });
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // SQL fragment used to observe locks or assert DB state.
          OR: [
            // Execute the next setup or assertion step for this scenario.
            { actorEmployeeId: { in: world.employeeIds } },
            // Execute the next setup or assertion step for this scenario.
            { locationId: { in: [world.locationAId, world.locationBId] } },
          ],
        },
      });
      // Await async work before asserting or releasing locks.
      await prisma.maintenanceTicket.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { locationId: { in: [world.locationAId, world.locationBId] } },
      });
      // Await async work before asserting or releasing locks.
      await cleanupCleaningWorld(prisma, world);
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: scoped list includes own-room SLA and excludes foreign-room SLA.
  it("scoped list includes own-room SLA and excludes foreign-room SLA", async (t) => {
    // Execute the next setup or assertion step for this scenario.
    t.mock.timers.enable({ apis: ["Date"], now });
    // Try path where partial failure must not leak suite state.
    try {
      // own: seeded entity required before the mutation under test.
      const own = await prisma.maintenanceTicket.create({
        // Execute the next setup or assertion step for this scenario.
        data: {
          // Fixture field status for the seeded actor/entity.
          status: "new",
          // Execute the next setup or assertion step for this scenario.
          dueAt: new Date(now - 1),
          // Execute the next setup or assertion step for this scenario.
          locationId: world.locationAId,
          // Execute the next setup or assertion step for this scenario.
          title: "Own SLA",
          // Execute the next setup or assertion step for this scenario.
          categoryKey: "other",
          // Execute the next setup or assertion step for this scenario.
          categoryLabelBg: "Друго",
          // Execute the next setup or assertion step for this scenario.
          categoryLabelEn: "Other",
          // Execute the next setup or assertion step for this scenario.
          reportedByEmployeeId: world.owner.employeeId,
          // Execute the next setup or assertion step for this scenario.
          assigneeId: world.technician.employeeId,
        },
      });
      // foreign: seeded entity required before the mutation under test.
      const foreign = await prisma.maintenanceTicket.create({
        // Execute the next setup or assertion step for this scenario.
        data: {
          // Fixture field status for the seeded actor/entity.
          status: "new",
          // Execute the next setup or assertion step for this scenario.
          dueAt: new Date(now - 1),
          // Execute the next setup or assertion step for this scenario.
          locationId: world.locationBId,
          // Execute the next setup or assertion step for this scenario.
          title: "Foreign SLA",
          // Execute the next setup or assertion step for this scenario.
          categoryKey: "other",
          // Execute the next setup or assertion step for this scenario.
          categoryLabelBg: "Друго",
          // Execute the next setup or assertion step for this scenario.
          categoryLabelEn: "Other",
          // Execute the next setup or assertion step for this scenario.
          reportedByEmployeeId: world.owner.employeeId,
          // Execute the next setup or assertion step for this scenario.
          assigneeId: world.technician.employeeId,
        },
      });

      // Await async work before asserting or releasing locks.
      await runTicketSlaBreach();

      // ownScoped: synchronize actors so the race window is observable.
      const ownScoped = await listAuditEvents({
        // Execute the next setup or assertion step for this scenario.
        action: "ticket.sla_breach",
        // Execute the next setup or assertion step for this scenario.
        scopeLocationIds: [world.locationAId],
        // Pagination step for list/contract coverage.
        limit: 50,
      });
      // Assert the observed value matches the intended post-condition.
      assert.ok(ownScoped.some((row) => row.entityId === own.id));
      // Assert the observed value matches the intended post-condition.
      assert.ok(ownScoped.every((row) => row.locationId === world.locationAId));
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        ownScoped.some((row) => row.entityId === foreign.id),
        // Execute the next setup or assertion step for this scenario.
        false,
      );

      // byLocation: synchronize actors so the race window is observable.
      const byLocation = await listAuditEvents({
        // Execute the next setup or assertion step for this scenario.
        action: "ticket.sla_breach",
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Pagination step for list/contract coverage.
        limit: 50,
      });
      // Assert the observed value matches the intended post-condition.
      assert.ok(byLocation.some((row) => row.entityId === own.id));
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        byLocation.some((row) => row.entityId === foreign.id),
        // Execute the next setup or assertion step for this scenario.
        false,
      );
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Execute the next setup or assertion step for this scenario.
      t.mock.timers.reset();
    }
  });
});
