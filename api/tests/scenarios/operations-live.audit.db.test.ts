/**
 * Audit-only scenarios for Live Board attention leftovers.
 * Does not change product code — documents remaining gaps / regressions.
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
  // Execute the next setup or assertion step for this scenario.
  getOperationsLiveAttentionPage,
  // Pagination step for list/contract coverage.
  NEEDS_ATTENTION_LIMIT,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/operationsLive";

// Suite: audit: operations live remaining attention risks.
describe("audit: operations live remaining attention risks", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: CleaningWorld;
  // Execute the next setup or assertion step for this scenario.
  const createdLocationIds: string[] = [];
  // Execute the next setup or assertion step for this scenario.
  const createdTaskIds: string[] = [];

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

  // Case: remainder: overdue inspection stays visible when past-due work page is full.
  it("remainder: overdue inspection stays visible when past-due work page is full", async () => {
    // 50 newest inspections (not past due) occupy awaiting page.
    // 50 past-due assigned tasks fill past_due work page.
    // Older past-due inspection outside top-50 awaiting must still appear via
    // dedicated overflow quota.
    const stamp = Date.now();
    // locIds: synchronize actors so the race window is observable.
    const locIds = await makeLocations(NEEDS_ATTENTION_LIMIT * 2 + 1);

    // freshInspections: capture concurrent outcomes for race assertions.
    const freshInspections = await Promise.all(
      // Pagination step for list/contract coverage.
      locIds.slice(0, NEEDS_ATTENTION_LIMIT).map((locationId, i) =>
        // Execute the next setup or assertion step for this scenario.
        prisma.cleaningTask
          // Continue the call chain for setup or assertion detail.
          .create({
            // Execute the next setup or assertion step for this scenario.
            data: {
              // Execute the next setup or assertion step for this scenario.
              locationId,
              // Execute the next setup or assertion step for this scenario.
              hotelDate: new Date("2026-11-01"),
              // Execute the next setup or assertion step for this scenario.
              cleaningCycle: 0,
              // Fixture field status for the seeded actor/entity.
              status: "awaiting_inspection",
              // Execute the next setup or assertion step for this scenario.
              dueAt: new Date(stamp + 3_600_000),
              // Execute the next setup or assertion step for this scenario.
              assignedEmployeeId: world.hk1.employeeId,
            },
          })
          // Continue the call chain for setup or assertion detail.
          .then((row) =>
            // Execute the next setup or assertion step for this scenario.
            prisma.cleaningTask.update({
              // SQL fragment used to observe locks or assert DB state.
              where: { id: row.id },
              // Execute the next setup or assertion step for this scenario.
              data: { updatedAt: new Date(stamp + (i + 1) * 1000) },
            }),
          ),
      ),
    );
    // Execute the next setup or assertion step for this scenario.
    createdTaskIds.push(...freshInspections.map((t) => t.id));

    // pastDueWork: capture concurrent outcomes for race assertions.
    const pastDueWork = await Promise.all(
      // Execute the next setup or assertion step for this scenario.
      locIds
        // Continue the call chain for setup or assertion detail.
        .slice(NEEDS_ATTENTION_LIMIT, NEEDS_ATTENTION_LIMIT * 2)
        // Continue the call chain for setup or assertion detail.
        .map((locationId, i) =>
          // Execute the next setup or assertion step for this scenario.
          prisma.cleaningTask.create({
            // Execute the next setup or assertion step for this scenario.
            data: {
              // Execute the next setup or assertion step for this scenario.
              locationId,
              // Execute the next setup or assertion step for this scenario.
              hotelDate: new Date("2026-11-02"),
              // Execute the next setup or assertion step for this scenario.
              cleaningCycle: 0,
              // Fixture field status for the seeded actor/entity.
              status: "assigned",
              // Execute the next setup or assertion step for this scenario.
              dueAt: new Date(stamp - (i + 1) * 60_000),
              // Execute the next setup or assertion step for this scenario.
              assignedEmployeeId: world.hk2.employeeId,
            },
          }),
        ),
    );
    // Execute the next setup or assertion step for this scenario.
    createdTaskIds.push(...pastDueWork.map((t) => t.id));

    // overflowInspection: seeded entity required before the mutation under test.
    const overflowInspection = await prisma.cleaningTask.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Pagination step for list/contract coverage.
        locationId: locIds[NEEDS_ATTENTION_LIMIT * 2]!,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date("2026-11-03"),
        // Execute the next setup or assertion step for this scenario.
        cleaningCycle: 0,
        // Fixture field status for the seeded actor/entity.
        status: "awaiting_inspection",
        // Execute the next setup or assertion step for this scenario.
        dueAt: new Date(stamp - 60_000),
        // Execute the next setup or assertion step for this scenario.
        assignedEmployeeId: world.hk1.employeeId,
      },
    });
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.update({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: overflowInspection.id },
      // Execute the next setup or assertion step for this scenario.
      data: { updatedAt: new Date(stamp - 86_400_000) },
    });
    // Execute the next setup or assertion step for this scenario.
    createdTaskIds.push(overflowInspection.id);

    // Bind allIds for later setup or assertions in this scope.
    const allIds = [
      // Continue the call chain for setup or assertion detail.
      ...freshInspections.map((t) => t.id),
      // Continue the call chain for setup or assertion detail.
      ...pastDueWork.map((t) => t.id),
      // Execute the next setup or assertion step for this scenario.
      overflowInspection.id,
    ];
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
    const matches = live.needsAttention.filter(
      // Execute the next setup or assertion step for this scenario.
      (n) => n.id === overflowInspection.id,
    );
    // Assert collection size matches the expected post-condition.
    assert.equal(matches.length, 1, "overflow past-due inspection must appear once");
    // Assert the observed value matches the intended post-condition.
    assert.equal(matches[0]!.kind, "past_due");
    // Assert the observed value matches the intended post-condition.
    assert.ok(live.attention!.pastDue.returned >= NEEDS_ATTENTION_LIMIT + 1);
  });

  // Case: AUDIT: attention page pagination returns next unique past_due work rows.
  it("AUDIT: attention page pagination returns next unique past_due work rows", async () => {
    // stamp: unique stamp so parallel runs do not collide.
    const stamp = Date.now();
    // locIds: synchronize actors so the race window is observable.
    const locIds = await makeLocations(NEEDS_ATTENTION_LIMIT + 5);
    // rows: capture concurrent outcomes for race assertions.
    const rows = await Promise.all(
      // Execute the next setup or assertion step for this scenario.
      locIds.map((locationId, i) =>
        // Execute the next setup or assertion step for this scenario.
        prisma.cleaningTask.create({
          // Execute the next setup or assertion step for this scenario.
          data: {
            // Execute the next setup or assertion step for this scenario.
            locationId,
            // Execute the next setup or assertion step for this scenario.
            hotelDate: new Date("2026-11-04"),
            // Execute the next setup or assertion step for this scenario.
            cleaningCycle: 0,
            // Fixture field status for the seeded actor/entity.
            status: "assigned",
            // Pagination step for list/contract coverage.
            dueAt: new Date(stamp - (NEEDS_ATTENTION_LIMIT + 10 - i) * 60_000),
            // Execute the next setup or assertion step for this scenario.
            assignedEmployeeId: world.hk1.employeeId,
          },
        }),
      ),
    );
    // Execute the next setup or assertion step for this scenario.
    createdTaskIds.push(...rows.map((t) => t.id));

    // Bind scope for later setup or assertions in this scope.
    const scope = {
      // Execute the next setup or assertion step for this scenario.
      task: { id: { in: rows.map((t) => t.id) } },
      // Execute the next setup or assertion step for this scenario.
      ticket: { locationId: locIds[0]! },
    };
    // first: HTTP response captured for status/body checks.
    const first = await getOperationsLiveAttentionPage({
      // Execute the next setup or assertion step for this scenario.
      kind: "past_due",
      // Execute the next setup or assertion step for this scenario.
      scopeWhere: scope,
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(first.returned, NEEDS_ATTENTION_LIMIT);
    // Assert the observed value matches the intended post-condition.
    assert.equal(first.hasMore, true);
    // Assert the observed value matches the intended post-condition.
    assert.ok(first.nextCursor);

    // second: HTTP response captured for status/body checks.
    const second = await getOperationsLiveAttentionPage({
      // Execute the next setup or assertion step for this scenario.
      kind: "past_due",
      // Pagination step for list/contract coverage.
      cursor: first.nextCursor,
      // Execute the next setup or assertion step for this scenario.
      scopeWhere: scope,
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(second.returned >= 1);
    // Bind overlap for later setup or assertions in this scope.
    const overlap = second.items.filter((item) =>
      // Execute the next setup or assertion step for this scenario.
      first.items.some((f) => f.id === item.id),
    );
    // Assert collection size matches the expected post-condition.
    assert.equal(overlap.length, 0, "pages must not duplicate task ids");
    // Assert collection size matches the expected post-condition.
    assert.equal(first.total, rows.length);
    // Assert collection size matches the expected post-condition.
    assert.equal(second.total, rows.length);
  });
});
