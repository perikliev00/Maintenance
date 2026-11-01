/**
 * Audit-only scenarios for Live Board attention leftovers.
 * Does not change product code — documents remaining gaps / regressions.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/db";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  cleanupCleaningWorld,
  createCleaningWorld,
  type CleaningWorld,
} from "../cleaning/fixtures";
import {
  getOperationsLive,
  getOperationsLiveAttentionPage,
  NEEDS_ATTENTION_LIMIT,
} from "../../src/services/operationsLive";

describe("audit: operations live remaining attention risks", () => {
  let world: CleaningWorld;
  const createdLocationIds: string[] = [];
  const createdTaskIds: string[] = [];

  before(async () => {
    await assertTestDatabase(prisma);
    world = await createCleaningWorld(prisma);
  });

  after(async () => {
    if (createdTaskIds.length) {
      await prisma.cleaningTask.deleteMany({
        where: { id: { in: createdTaskIds } },
      });
    }
    if (createdLocationIds.length) {
      await prisma.location.deleteMany({
        where: { id: { in: createdLocationIds } },
      });
    }
    if (world) await cleanupCleaningWorld(prisma, world);
    await prisma.$disconnect();
  });

  async function makeLocations(count: number): Promise<string[]> {
    const rows = await Promise.all(
      Array.from({ length: count }, () =>
        prisma.location.create({
          data: {
            floorId: world.floorId,
            number: randomUUID().replaceAll("-", "").slice(0, 24),
            kind: "room",
            cleaningStatus: "dirty",
          },
        }),
      ),
    );
    const ids = rows.map((r) => r.id);
    createdLocationIds.push(...ids);
    return ids;
  }

  it("BUG-01 remainder: overdue inspection stays visible when past-due work page is full", async () => {
    // 50 newest inspections (not past due) occupy awaiting page.
    // 50 past-due assigned tasks fill past_due work page.
    // Older past-due inspection outside top-50 awaiting must still appear via
    // dedicated overflow quota.
    const stamp = Date.now();
    const locIds = await makeLocations(NEEDS_ATTENTION_LIMIT * 2 + 1);

    const freshInspections = await Promise.all(
      locIds.slice(0, NEEDS_ATTENTION_LIMIT).map((locationId, i) =>
        prisma.cleaningTask
          .create({
            data: {
              locationId,
              hotelDate: new Date("2026-11-01"),
              cleaningCycle: 0,
              status: "awaiting_inspection",
              dueAt: new Date(stamp + 3_600_000),
              assignedEmployeeId: world.hk1.employeeId,
            },
          })
          .then((row) =>
            prisma.cleaningTask.update({
              where: { id: row.id },
              data: { updatedAt: new Date(stamp + (i + 1) * 1000) },
            }),
          ),
      ),
    );
    createdTaskIds.push(...freshInspections.map((t) => t.id));

    const pastDueWork = await Promise.all(
      locIds
        .slice(NEEDS_ATTENTION_LIMIT, NEEDS_ATTENTION_LIMIT * 2)
        .map((locationId, i) =>
          prisma.cleaningTask.create({
            data: {
              locationId,
              hotelDate: new Date("2026-11-02"),
              cleaningCycle: 0,
              status: "assigned",
              dueAt: new Date(stamp - (i + 1) * 60_000),
              assignedEmployeeId: world.hk2.employeeId,
            },
          }),
        ),
    );
    createdTaskIds.push(...pastDueWork.map((t) => t.id));

    const overflowInspection = await prisma.cleaningTask.create({
      data: {
        locationId: locIds[NEEDS_ATTENTION_LIMIT * 2]!,
        hotelDate: new Date("2026-11-03"),
        cleaningCycle: 0,
        status: "awaiting_inspection",
        dueAt: new Date(stamp - 60_000),
        assignedEmployeeId: world.hk1.employeeId,
      },
    });
    await prisma.cleaningTask.update({
      where: { id: overflowInspection.id },
      data: { updatedAt: new Date(stamp - 86_400_000) },
    });
    createdTaskIds.push(overflowInspection.id);

    const allIds = [
      ...freshInspections.map((t) => t.id),
      ...pastDueWork.map((t) => t.id),
      overflowInspection.id,
    ];
    const live = await getOperationsLive({
      task: { id: { in: allIds } },
      ticket: { locationId: locIds[0]! },
      session: { taskId: { in: allIds } },
      location: { id: { in: locIds } },
    });

    const matches = live.needsAttention.filter(
      (n) => n.id === overflowInspection.id,
    );
    assert.equal(matches.length, 1, "overflow past-due inspection must appear once");
    assert.equal(matches[0]!.kind, "past_due");
    assert.ok(live.attention!.pastDue.returned >= NEEDS_ATTENTION_LIMIT + 1);
  });

  it("AUDIT: attention page pagination returns next unique past_due work rows", async () => {
    const stamp = Date.now();
    const locIds = await makeLocations(NEEDS_ATTENTION_LIMIT + 5);
    const rows = await Promise.all(
      locIds.map((locationId, i) =>
        prisma.cleaningTask.create({
          data: {
            locationId,
            hotelDate: new Date("2026-11-04"),
            cleaningCycle: 0,
            status: "assigned",
            dueAt: new Date(stamp - (NEEDS_ATTENTION_LIMIT + 10 - i) * 60_000),
            assignedEmployeeId: world.hk1.employeeId,
          },
        }),
      ),
    );
    createdTaskIds.push(...rows.map((t) => t.id));

    const scope = {
      task: { id: { in: rows.map((t) => t.id) } },
      ticket: { locationId: locIds[0]! },
    };
    const first = await getOperationsLiveAttentionPage({
      kind: "past_due",
      scopeWhere: scope,
    });
    assert.equal(first.returned, NEEDS_ATTENTION_LIMIT);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor);

    const second = await getOperationsLiveAttentionPage({
      kind: "past_due",
      cursor: first.nextCursor,
      scopeWhere: scope,
    });
    assert.ok(second.returned >= 1);
    const overlap = second.items.filter((item) =>
      first.items.some((f) => f.id === item.id),
    );
    assert.equal(overlap.length, 0, "pages must not duplicate task ids");
    assert.equal(first.total, rows.length);
    assert.equal(second.total, rows.length);
  });
});
