/**
 * Live board attention queue: overdue selection must not lose rows to the
 * inspection cap , and counts must reflect totals not page size .
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
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
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  getOperationsLive,
  // Pagination step for list/contract coverage.
  NEEDS_ATTENTION_LIMIT,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/operationsLive";

// Suite: operations live attention selection and counts.
describe("operations live attention selection and counts", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: CleaningWorld;
  // Bind hotelDate for later setup or assertions in this scope.
  const hotelDate = new Date("2026-10-29");
  // Execute the next setup or assertion step for this scenario.
  const createdLocationIds: string[] = [];
  // Execute the next setup or assertion step for this scenario.
  const createdTaskIds: string[] = [];
  // Execute the next setup or assertion step for this scenario.
  const createdTicketIds: string[] = [];

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCleaningWorld(prisma);
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (createdTicketIds.length) {
      // Await async work before asserting or releasing locks.
      await prisma.maintenanceTicket.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: { in: createdTicketIds } },
      });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (createdTaskIds.length) {
      // Await async work before asserting or releasing locks.
      await prisma.cleaningTask.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: { in: createdTaskIds } },
      });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (createdLocationIds.length) {
      // Await async work before asserting or releasing locks.
      await prisma.location.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: { in: createdLocationIds } },
      });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupCleaningWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Local helper makeLocations used by cases in this file.
  async function makeLocations(count: number): Promise<string[]> {
    // rows: capture concurrent outcomes for race assertions.
    const rows = await Promise.all(
      // Execute the next setup or assertion step for this scenario.
      Array.from({ length: count }, () =>
        // Execute the next setup or assertion step for this scenario.
        prisma.location.create({
          // Execute the next setup or assertion step for this scenario.
          data: {
            // Execute the next setup or assertion step for this scenario.
            floorId: world.floorId,
            // Execute the next setup or assertion step for this scenario.
            number: randomUUID().replaceAll("-", "").slice(0, 24),
            // Execute the next setup or assertion step for this scenario.
            kind: "room",
            // Execute the next setup or assertion step for this scenario.
            cleaningStatus: "dirty",
          },
        }),
      ),
    );
    // Bind ids for later setup or assertions in this scope.
    const ids = rows.map((r) => r.id);
    // Execute the next setup or assertion step for this scenario.
    createdLocationIds.push(...ids);
    // Return the arranged value/result to the caller.
    return ids;
  }

  // Case: assigned past-due survives many earlier past-due inspections.
  it("assigned past-due survives many earlier past-due inspections", async () => {
    // Bind now for later setup or assertions in this scope.
    const now = Date.now();
    // locIds: synchronize actors so the race window is observable.
    const locIds = await makeLocations(NEEDS_ATTENTION_LIMIT + 1);
    // inspections: capture concurrent outcomes for race assertions.
    const inspections = await Promise.all(
      // Pagination step for list/contract coverage.
      locIds.slice(0, NEEDS_ATTENTION_LIMIT).map((locationId, i) =>
        // Execute the next setup or assertion step for this scenario.
        prisma.cleaningTask.create({
          // Execute the next setup or assertion step for this scenario.
          data: {
            // Execute the next setup or assertion step for this scenario.
            locationId,
            // Execute the next setup or assertion step for this scenario.
            hotelDate,
            // Execute the next setup or assertion step for this scenario.
            cleaningCycle: 0,
            // Fixture field status for the seeded actor/entity.
            status: "awaiting_inspection",
            // Pagination step for list/contract coverage.
            dueAt: new Date(now - (NEEDS_ATTENTION_LIMIT + 10 - i) * 60_000),
            // Execute the next setup or assertion step for this scenario.
            assignedEmployeeId: world.hk1.employeeId,
          },
        }),
      ),
    );
    // Execute the next setup or assertion step for this scenario.
    createdTaskIds.push(...inspections.map((t) => t.id));

    // assigned: seeded entity required before the mutation under test.
    const assigned = await prisma.cleaningTask.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Pagination step for list/contract coverage.
        locationId: locIds[NEEDS_ATTENTION_LIMIT]!,
        // Execute the next setup or assertion step for this scenario.
        hotelDate,
        // Execute the next setup or assertion step for this scenario.
        cleaningCycle: 0,
        // Fixture field status for the seeded actor/entity.
        status: "assigned",
        // Execute the next setup or assertion step for this scenario.
        dueAt: new Date(now - 30_000),
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk2.employeeId,
      },
    });
    // Execute the next setup or assertion step for this scenario.
    createdTaskIds.push(assigned.id);

    // Bind scopeIds for later setup or assertions in this scope.
    const scopeIds = locIds;
    // live: HTTP response captured for status/body checks.
    const live = await getOperationsLive({
      // Execute the next setup or assertion step for this scenario.
      task: { locationId: { in: scopeIds } },
      // Execute the next setup or assertion step for this scenario.
      ticket: { locationId: { in: scopeIds } },
      // Session/CSRF step exercising auth lifecycle.
      session: { task: { locationId: { in: scopeIds } } },
      // Execute the next setup or assertion step for this scenario.
      location: { id: { in: scopeIds } },
    });

    // Bind pastDue for later setup or assertions in this scope.
    const pastDue = live.needsAttention.filter((n) => n.kind === "past_due");
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      pastDue.some((n) => n.id === assigned.id),
      // Execute the next setup or assertion step for this scenario.
      "assigned past-due task must remain visible",
    );
  });

  // Case: past-due inspection outside newest-50 still appears.
  it("past-due inspection outside newest-50 still appears", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // locIds: synchronize actors so the race window is observable.
    const locIds = await makeLocations(NEEDS_ATTENTION_LIMIT + 1);
    // freshRows: capture concurrent outcomes for race assertions.
    const freshRows = await Promise.all(
      // Pagination step for list/contract coverage.
      locIds.slice(0, NEEDS_ATTENTION_LIMIT).map((locationId, i) =>
        // Execute the next setup or assertion step for this scenario.
        prisma.cleaningTask.create({
          // Execute the next setup or assertion step for this scenario.
          data: {
            // Execute the next setup or assertion step for this scenario.
            locationId,
            // Execute the next setup or assertion step for this scenario.
            hotelDate: new Date("2026-10-28"),
            // Execute the next setup or assertion step for this scenario.
            cleaningCycle: 0,
            // Fixture field status for the seeded actor/entity.
            status: "awaiting_inspection",
            // Execute the next setup or assertion step for this scenario.
            dueAt: new Date(stamp + 60 * 60_000),
            // Execute the next setup or assertion step for this scenario.
            assignedEmployeeId: world.hk1.employeeId,
          },
        // Execute the next setup or assertion step for this scenario.
        }).then(async (row) => {
          // Force older updatedAt ranking for the overflow candidate separately.
          if (i === 0) return row;
          // Return the arranged value/result to the caller.
          return prisma.cleaningTask.update({
            // SQL fragment used to observe locks or assert DB state.
            where: { id: row.id },
            // Execute the next setup or assertion step for this scenario.
            data: { updatedAt: new Date(stamp + i * 1000) },
          });
        }),
      ),
    );
    // Execute the next setup or assertion step for this scenario.
    createdTaskIds.push(...freshRows.map((t) => t.id));

    // oldPastDue: seeded entity required before the mutation under test.
    const oldPastDue = await prisma.cleaningTask.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Pagination step for list/contract coverage.
        locationId: locIds[NEEDS_ATTENTION_LIMIT]!,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date("2026-10-28"),
        // Execute the next setup or assertion step for this scenario.
        cleaningCycle: 0,
        // Fixture field status for the seeded actor/entity.
        status: "awaiting_inspection",
        // Execute the next setup or assertion step for this scenario.
        dueAt: new Date(stamp - 60_000),
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk2.employeeId,
      },
    });
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: oldPastDue.id },
      // Execute the next setup or assertion step for this scenario.
      data: { updatedAt: new Date(stamp - 86_400_000) },
    });
    // Execute the next setup or assertion step for this scenario.
    createdTaskIds.push(oldPastDue.id);

    // Bind allIds for later setup or assertions in this scope.
    const allIds = [...freshRows.map((t) => t.id), oldPastDue.id];
    // live: HTTP response captured for status/body checks.
    const live = await getOperationsLive({
      // Execute the next setup or assertion step for this scenario.
      task: { id: { in: allIds } },
      // Execute the next setup or assertion step for this scenario.
      ticket: { locationId: locIds[0]! },
      // Session/CSRF step exercising auth lifecycle.
      session: { taskId: { in: allIds } },
      // Execute the next setup or assertion step for this scenario.
      location: { id: { in: locIds } },
    });

    // Bind matches for later setup or assertions in this scope.
    const matches = live.needsAttention.filter((n) => n.id === oldPastDue.id);
    // Assert collection size matches the expected post-condition.
    assert.equal(matches.length, 1, "old past-due inspection must appear once");
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      matches[0]!.kind === "past_due" || matches[0]!.kind === "awaiting_inspection",
    );
  });

  // Case probes concurrency/isolation: inspection and blocking counts exceed page size.
  it("inspection and blocking counts exceed page size", async () => {
    // Bind extra for later setup or assertions in this scope.
    const extra = NEEDS_ATTENTION_LIMIT + 11;
    // locIds: synchronize actors so the race window is observable.
    const locIds = await makeLocations(extra);
    // taskRows: capture concurrent outcomes for race assertions.
    const taskRows = await Promise.all(
      // Execute the next setup or assertion step for this scenario.
      locIds.map((locationId) =>
        // Execute the next setup or assertion step for this scenario.
        prisma.cleaningTask.create({
          // Execute the next setup or assertion step for this scenario.
          data: {
            // Execute the next setup or assertion step for this scenario.
            locationId,
            // Execute the next setup or assertion step for this scenario.
            hotelDate: new Date("2026-10-27"),
            // Execute the next setup or assertion step for this scenario.
            cleaningCycle: 0,
            // Fixture field status for the seeded actor/entity.
            status: "awaiting_inspection",
            // Execute the next setup or assertion step for this scenario.
            dueAt: new Date(Date.now() + 3_600_000),
            // Execute the next setup or assertion step for this scenario.
            assignedEmployeeId: world.hk1.employeeId,
          },
        }),
      ),
    );
    // Execute the next setup or assertion step for this scenario.
    createdTaskIds.push(...taskRows.map((t) => t.id));

    // ticketRows: capture concurrent outcomes for race assertions.
    const ticketRows = await Promise.all(
      // Execute the next setup or assertion step for this scenario.
      locIds.map((locationId, i) =>
        // Execute the next setup or assertion step for this scenario.
        prisma.maintenanceTicket.create({
          // Execute the next setup or assertion step for this scenario.
          data: {
            // Execute the next setup or assertion step for this scenario.
            locationId,
            // Concurrency/isolation step for the race under test.
            title: `Block ${i}`,
            // Execute the next setup or assertion step for this scenario.
            categoryKey: "other",
            // Execute the next setup or assertion step for this scenario.
            categoryLabelBg: "Друго",
            // Execute the next setup or assertion step for this scenario.
            categoryLabelEn: "Other",
            // Fixture field status for the seeded actor/entity.
            status: "new",
            // Concurrency/isolation step for the race under test.
            blocksRoom: true,
            // Execute the next setup or assertion step for this scenario.
            reportedByEmployeeId: world.owner.employeeId,
          },
        }),
      ),
    );
    // Execute the next setup or assertion step for this scenario.
    createdTicketIds.push(...ticketRows.map((t) => t.id));

    // live: HTTP response captured for status/body checks.
    const live = await getOperationsLive({
      // Execute the next setup or assertion step for this scenario.
      task: { id: { in: taskRows.map((t) => t.id) } },
      // Execute the next setup or assertion step for this scenario.
      ticket: { id: { in: ticketRows.map((t) => t.id) } },
      // Session/CSRF step exercising auth lifecycle.
      session: { taskId: { in: taskRows.map((t) => t.id) } },
      // Execute the next setup or assertion step for this scenario.
      location: { id: { in: locIds } },
    });

    // Assert collection size matches the expected post-condition.
    assert.equal(live.counts.awaitingInspection, extra);
    // Assert collection size matches the expected post-condition.
    assert.equal(live.counts.blockingTickets, extra);
    // Assert the observed value matches the intended post-condition.
    assert.equal(live.attention?.awaitingInspection.total, extra);
    // Assert the observed value matches the intended post-condition.
    assert.equal(live.attention?.blockingTickets.total, extra);
    // Assert the observed value matches the intended post-condition.
    assert.equal(live.attention?.awaitingInspection.hasMore, true);
    // Assert the observed value matches the intended post-condition.
    assert.equal(live.attention?.blockingTickets.hasMore, true);
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      live.needsAttention.filter((n) => n.kind === "awaiting_inspection")
        // Continue the call chain for setup or assertion detail.
        .length <= NEEDS_ATTENTION_LIMIT,
    );
  });
});
