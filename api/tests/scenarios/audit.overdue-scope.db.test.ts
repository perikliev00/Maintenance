/**
 * BUG-01 remainder: overdue-session audit events with locationId are visible
 * under sector/location scope; foreign rooms stay hidden.
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
import { runOverdueSessions } from "../../src/services/jobs/overdueSessions";
import { listAuditEvents } from "../../src/services/audit";
import { getSetting, updateSetting } from "../../src/services/settings";

describe("audit overdue location scope (BUG-01)", () => {
  let world: CleaningWorld;
  let operations: Awaited<ReturnType<typeof getSetting<"operations">>>;
  const now = Date.parse("2026-02-02T12:00:00Z");

  async function overdueSession(locationId: string, employeeId: string) {
    const task = await prisma.cleaningTask.create({
      data: {
        locationId,
        hotelDate: new Date("2026-02-02"),
        status: "cancelled",
        cleaningCycle: 0,
        assignedEmployeeId: employeeId,
      },
    });
    return prisma.cleaningSession.create({
      data: {
        taskId: task.id,
        employeeId,
        status: "running",
        startedAt: new Date(now - 61 * 60_000),
        startCommandId: randomUUID(),
        anomalyFlags: [],
      },
    });
  }

  before(async () => {
    await assertTestDatabase(prisma);
    world = await createCleaningWorld(prisma);
    operations = await getSetting("operations");
    await updateSetting({
      key: "operations",
      value: { ...operations, overdueSessionMinutes: 60 },
      actorEmployeeId: world.owner.employeeId,
      reason: "audit overdue scope baseline",
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
      await prisma.auditEvent.deleteMany({
        where: {
          locationId: { in: [world.locationAId, world.locationBId] },
          action: "session.overdue_detected",
        },
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

  it("scoped list includes own-room overdue and excludes foreign-room overdue", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now });
    try {
      const own = await overdueSession(world.locationAId, world.hk1.employeeId);
      const foreign = await overdueSession(
        world.locationBId,
        world.hk2.employeeId,
      );

      const result = await runOverdueSessions();
      assert.ok(result.flagged >= 2);

      const ownScoped = await listAuditEvents({
        action: "session.overdue_detected",
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
        action: "session.overdue_detected",
        locationId: world.locationAId,
        limit: 50,
      });
      assert.ok(byLocation.some((row) => row.entityId === own.id));
      assert.equal(
        byLocation.some((row) => row.entityId === foreign.id),
        false,
      );

      await prisma.cleaningSession.updateMany({
        where: { id: { in: [own.id, foreign.id] } },
        data: { status: "completed", finishedAt: new Date(now) },
      });
    } finally {
      t.mock.timers.reset();
    }
  });
});
