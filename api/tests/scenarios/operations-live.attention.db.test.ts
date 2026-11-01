/**
 * Live board attention queue: overdue selection must not lose rows to the
 * inspection cap (BUG-01), and counts must reflect totals not page size (BUG-02).
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
  NEEDS_ATTENTION_LIMIT,
} from "../../src/services/operationsLive";

describe("operations live attention selection and counts", () => {
  let world: CleaningWorld;
  const hotelDate = new Date("2026-10-29");
  const createdLocationIds: string[] = [];
  const createdTaskIds: string[] = [];
  const createdTicketIds: string[] = [];

  before(async () => {
    await assertTestDatabase(prisma);
    world = await createCleaningWorld(prisma);
  });

  after(async () => {
    if (createdTicketIds.length) {
      await prisma.maintenanceTicket.deleteMany({
        where: { id: { in: createdTicketIds } },
      });
    }
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

  it("BUG-01A: assigned past-due survives many earlier past-due inspections", async () => {
    const now = Date.now();
    const locIds = await makeLocations(NEEDS_ATTENTION_LIMIT + 1);
    const inspections = await Promise.all(
      locIds.slice(0, NEEDS_ATTENTION_LIMIT).map((locationId, i) =>
        prisma.cleaningTask.create({
          data: {
            locationId,
            hotelDate,
            cleaningCycle: 0,
            status: "awaiting_inspection",
            dueAt: new Date(now - (NEEDS_ATTENTION_LIMIT + 10 - i) * 60_000),
            assignedEmployeeId: world.hk1.employeeId,
          },
        }),
      ),
    );
    createdTaskIds.push(...inspections.map((t) => t.id));

    const assigned = await prisma.cleaningTask.create({
      data: {
        locationId: locIds[NEEDS_ATTENTION_LIMIT]!,
        hotelDate,
        cleaningCycle: 0,
        status: "assigned",
        dueAt: new Date(now - 30_000),
        assignedEmployeeId: world.hk2.employeeId,
      },
    });
    createdTaskIds.push(assigned.id);

    const scopeIds = locIds;
    const live = await getOperationsLive({
      task: { locationId: { in: scopeIds } },
      ticket: { locationId: { in: scopeIds } },
      session: { task: { locationId: { in: scopeIds } } },
      location: { id: { in: scopeIds } },
    });

    const pastDue = live.needsAttention.filter((n) => n.kind === "past_due");
    assert.ok(
      pastDue.some((n) => n.id === assigned.id),
      "assigned past-due task must remain visible",
    );
  });

  it("BUG-01B: past-due inspection outside newest-50 still appears", async () => {
    const stamp = Date.now();
    const locIds = await makeLocations(NEEDS_ATTENTION_LIMIT + 1);
    const freshRows = await Promise.all(
      locIds.slice(0, NEEDS_ATTENTION_LIMIT).map((locationId, i) =>
        prisma.cleaningTask.create({
          data: {
            locationId,
            hotelDate: new Date("2026-10-28"),
            cleaningCycle: 0,
            status: "awaiting_inspection",
            dueAt: new Date(stamp + 60 * 60_000),
            assignedEmployeeId: world.hk1.employeeId,
          },
        }).then(async (row) => {
          // Force older updatedAt ranking for the overflow candidate separately.
          if (i === 0) return row;
          return prisma.cleaningTask.update({
            where: { id: row.id },
            data: { updatedAt: new Date(stamp + i * 1000) },
          });
        }),
      ),
    );
    createdTaskIds.push(...freshRows.map((t) => t.id));

    const oldPastDue = await prisma.cleaningTask.create({
      data: {
        locationId: locIds[NEEDS_ATTENTION_LIMIT]!,
        hotelDate: new Date("2026-10-28"),
        cleaningCycle: 0,
        status: "awaiting_inspection",
        dueAt: new Date(stamp - 60_000),
        assignedEmployeeId: world.hk2.employeeId,
      },
    });
    await prisma.cleaningTask.update({
      where: { id: oldPastDue.id },
      data: { updatedAt: new Date(stamp - 86_400_000) },
    });
    createdTaskIds.push(oldPastDue.id);

    const allIds = [...freshRows.map((t) => t.id), oldPastDue.id];
    const live = await getOperationsLive({
      task: { id: { in: allIds } },
      ticket: { locationId: locIds[0]! },
      session: { taskId: { in: allIds } },
      location: { id: { in: locIds } },
    });

    const matches = live.needsAttention.filter((n) => n.id === oldPastDue.id);
    assert.equal(matches.length, 1, "old past-due inspection must appear once");
    assert.ok(
      matches[0]!.kind === "past_due" || matches[0]!.kind === "awaiting_inspection",
    );
  });

  it("BUG-02: inspection and blocking counts exceed page size", async () => {
    const extra = NEEDS_ATTENTION_LIMIT + 11;
    const locIds = await makeLocations(extra);
    const taskRows = await Promise.all(
      locIds.map((locationId) =>
        prisma.cleaningTask.create({
          data: {
            locationId,
            hotelDate: new Date("2026-10-27"),
            cleaningCycle: 0,
            status: "awaiting_inspection",
            dueAt: new Date(Date.now() + 3_600_000),
            assignedEmployeeId: world.hk1.employeeId,
          },
        }),
      ),
    );
    createdTaskIds.push(...taskRows.map((t) => t.id));

    const ticketRows = await Promise.all(
      locIds.map((locationId, i) =>
        prisma.maintenanceTicket.create({
          data: {
            locationId,
            title: `Block ${i}`,
            categoryKey: "other",
            categoryLabelBg: "Друго",
            categoryLabelEn: "Other",
            status: "new",
            blocksRoom: true,
            reportedByEmployeeId: world.owner.employeeId,
          },
        }),
      ),
    );
    createdTicketIds.push(...ticketRows.map((t) => t.id));

    const live = await getOperationsLive({
      task: { id: { in: taskRows.map((t) => t.id) } },
      ticket: { id: { in: ticketRows.map((t) => t.id) } },
      session: { taskId: { in: taskRows.map((t) => t.id) } },
      location: { id: { in: locIds } },
    });

    assert.equal(live.counts.awaitingInspection, extra);
    assert.equal(live.counts.blockingTickets, extra);
    assert.equal(live.attention?.awaitingInspection.total, extra);
    assert.equal(live.attention?.blockingTickets.total, extra);
    assert.equal(live.attention?.awaitingInspection.hasMore, true);
    assert.equal(live.attention?.blockingTickets.hasMore, true);
    assert.ok(
      live.needsAttention.filter((n) => n.kind === "awaiting_inspection")
        .length <= NEEDS_ATTENTION_LIMIT,
    );
  });
});
