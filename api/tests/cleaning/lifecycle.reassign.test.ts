/**
 * T-CLN-15…15d, T-CLN-27 — assignee eligibility + reassign constraints.
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import path from "node:path";
import { PrismaClient, Role, TaskStatus } from "@prisma/client";
import dotenv from "dotenv";
import {
  CLEANING_ASSIGNEE_MESSAGE,
  MAINTENANCE_ASSIGNEE_MESSAGE,
} from "../../src/services/assignees";
import {
  createCleaningTask,
  reassignCleaningTask,
  startCleaningTask,
} from "../../src/services/cleaning";
import { lockLocation } from "../../src/services/cleaning/locks";
import { assignMaintenanceTicket } from "../../src/services/maintenance";
import {
  cleanupCleaningWorld,
  countActiveTasks,
  createCleaningWorld,
  createOpenMaintenanceTicket,
  hotelTodayYmd,
  isAppError,
  resetCleaningWork,
  runEligibilityChangeBeforeRace,
  runWhileRowLocked,
  type CleaningWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

describe("cleaning lifecycle reassign (T-CLN-15/15b–d/27)", () => {
  let world: CleaningWorld;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createCleaningWorld(prisma);
  });

  beforeEach(async () => {
    await resetCleaningWork(prisma, world);
    // Reactivate / restore roles that T-CLN-15 may have mutated.
    await prisma.user.update({
      where: { id: world.hk1.userId },
      data: { isActive: true, role: Role.housekeeper },
    });
    await prisma.user.update({
      where: { id: world.hk2.userId },
      data: { isActive: true, role: Role.housekeeper },
    });
    await prisma.user.update({
      where: { id: world.technician.userId },
      data: { isActive: true, role: Role.technician },
    });
  });

  after(async () => {
    if (world) {
      await prisma.user.updateMany({
        where: { employeeId: { in: world.employeeIds } },
        data: { isActive: true },
      });
      await cleanupCleaningWorld(prisma, world);
    }
    await prisma.$disconnect();
  });

  it("T-CLN-15: create/reassign/assign reject deactivated assignees", async () => {
    const today = await hotelTodayYmd();

    await prisma.user.update({
      where: { id: world.hk2.userId },
      data: { isActive: false },
    });

    try {
      await createCleaningTask({
        locationId: world.locationAId,
        hotelDate: today,
        assignedEmployeeId: world.hk2.employeeId,
        actorEmployeeId: world.owner.employeeId,
      });
      assert.fail("expected validation on create with blocked HK");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.status, 400);
      assert.equal(err.code, "validation");
      assert.equal(err.message, CLEANING_ASSIGNEE_MESSAGE);
    }

    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });

    try {
      await reassignCleaningTask({
        taskId: task.id,
        assignedEmployeeId: world.hk2.employeeId,
        reason: "try blocked",
        expectedVersion: task.version,
        actorEmployeeId: world.manager.employeeId,
      });
      assert.fail("expected validation on reassign to blocked HK");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "validation");
      assert.equal(err.message, CLEANING_ASSIGNEE_MESSAGE);
    }

    await prisma.user.update({
      where: { id: world.technician.userId },
      data: { isActive: false },
    });
    const ticket = await createOpenMaintenanceTicket(
      prisma,
      world,
      world.locationAId,
    );
    try {
      await assignMaintenanceTicket({
        ticketId: ticket.id,
        assigneeId: world.technician.employeeId,
        actorEmployeeId: world.manager.employeeId,
      });
      assert.fail("expected validation on assign to blocked technician");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "validation");
      assert.equal(err.message, MAINTENANCE_ASSIGNEE_MESSAGE);
    }
  });

  it("T-CLN-15b: concurrent block/role-change vs reassign after eligibility check", async () => {
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });

    // Queue the eligibility mutation before the in-transaction user recheck.
    try {
      await runEligibilityChangeBeforeRace({
        prisma,
        acquireLock: (tx) => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${world.hk2.userId} FOR SHARE`,
        startMutation: () => prisma.user.update({
          where: { id: world.hk2.userId },
          data: { isActive: false },
        }),
        startRace: () =>
          reassignCleaningTask({
            taskId: task.id,
            assignedEmployeeId: world.hk2.employeeId,
            reason: "race against block",
            expectedVersion: task.version,
            actorEmployeeId: world.manager.employeeId,
          }),
      });
      assert.fail("expected validation after mid-flight deactivate");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "validation");
      assert.equal(err.message, CLEANING_ASSIGNEE_MESSAGE);
    }

    const afterBlock = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(afterBlock.assignedEmployeeId, world.hk1.employeeId);

    // Role demotion race (same lock-hold pattern).
    await prisma.user.update({
      where: { id: world.hk2.userId },
      data: { isActive: true, role: Role.housekeeper },
    });

    try {
      await runEligibilityChangeBeforeRace({
        prisma,
        acquireLock: (tx) => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${world.hk2.userId} FOR SHARE`,
        startMutation: () => prisma.user.update({
          where: { id: world.hk2.userId },
          data: { role: Role.reception },
        }),
        startRace: () =>
          reassignCleaningTask({
            taskId: task.id,
            assignedEmployeeId: world.hk2.employeeId,
            reason: "race against role change",
            expectedVersion: afterBlock.version,
            actorEmployeeId: world.manager.employeeId,
          }),
      });
      assert.fail("expected validation after mid-flight role demotion");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "validation");
      assert.equal(err.message, CLEANING_ASSIGNEE_MESSAGE);
    }

    const afterRole = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(afterRole.assignedEmployeeId, world.hk1.employeeId);
  });

  it("T-CLN-15c: concurrent block/role-change vs createCleaningTask", async () => {
    const today = await hotelTodayYmd();

    try {
      await runWhileRowLocked({
        prisma,
        acquireLock: (tx) => lockLocation(tx, world.locationAId),
        startRace: () =>
          createCleaningTask({
            locationId: world.locationAId,
            hotelDate: today,
            assignedEmployeeId: world.hk2.employeeId,
            actorEmployeeId: world.owner.employeeId,
          }),
        whileBlocked: async () => {
          await prisma.user.update({
            where: { id: world.hk2.userId },
            data: { isActive: false },
          });
        },
      });
      assert.fail("expected validation after mid-flight deactivate on create");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "validation");
      assert.equal(err.message, CLEANING_ASSIGNEE_MESSAGE);
    }
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 0);

    await prisma.user.update({
      where: { id: world.hk2.userId },
      data: { isActive: true, role: Role.housekeeper },
    });

    try {
      await runWhileRowLocked({
        prisma,
        acquireLock: (tx) => lockLocation(tx, world.locationAId),
        startRace: () =>
          createCleaningTask({
            locationId: world.locationAId,
            hotelDate: today,
            assignedEmployeeId: world.hk2.employeeId,
            actorEmployeeId: world.owner.employeeId,
          }),
        whileBlocked: async () => {
          await prisma.user.update({
            where: { id: world.hk2.userId },
            data: { role: Role.reception },
          });
        },
      });
      assert.fail("expected validation after mid-flight role demotion on create");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "validation");
      assert.equal(err.message, CLEANING_ASSIGNEE_MESSAGE);
    }
    assert.equal(await countActiveTasks(prisma, world.locationAId, today), 0);
  });

  it("T-CLN-15d: concurrent block/role-change vs assignMaintenanceTicket", async () => {
    const ticket = await createOpenMaintenanceTicket(
      prisma,
      world,
      world.locationAId,
    );

    try {
      await runEligibilityChangeBeforeRace({
        prisma,
        acquireLock: (tx) => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${world.technician.userId} FOR SHARE`,
        startMutation: () => prisma.user.update({
          where: { id: world.technician.userId },
          data: { isActive: false },
        }),
        startRace: () =>
          assignMaintenanceTicket({
            ticketId: ticket.id,
            assigneeId: world.technician.employeeId,
            actorEmployeeId: world.manager.employeeId,
          }),
      });
      assert.fail("expected validation after mid-flight deactivate on assign");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "validation");
      assert.equal(err.message, MAINTENANCE_ASSIGNEE_MESSAGE);
    }

    const afterBlock = await prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    assert.equal(afterBlock.assigneeId, null);

    await prisma.user.update({
      where: { id: world.technician.userId },
      data: { isActive: true, role: Role.technician },
    });

    try {
      await runEligibilityChangeBeforeRace({
        prisma,
        acquireLock: (tx) => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${world.technician.userId} FOR SHARE`,
        startMutation: () => prisma.user.update({
          where: { id: world.technician.userId },
          data: { role: Role.reception },
        }),
        startRace: () =>
          assignMaintenanceTicket({
            ticketId: ticket.id,
            assigneeId: world.technician.employeeId,
            actorEmployeeId: world.manager.employeeId,
          }),
      });
      assert.fail("expected validation after mid-flight role demotion on assign");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "validation");
      assert.equal(err.message, MAINTENANCE_ASSIGNEE_MESSAGE);
    }

    const afterRole = await prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    assert.equal(afterRole.assigneeId, null);
  });

  it("T-CLN-27: reassign requires reason, blocks running, version conflict, success", async () => {
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });

    try {
      await reassignCleaningTask({
        taskId: task.id,
        assignedEmployeeId: world.hk2.employeeId,
        reason: "   ",
        expectedVersion: task.version,
        actorEmployeeId: world.manager.employeeId,
      });
      assert.fail("expected validation on empty reason");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "validation");
    }

    const started = await startCleaningTask({
      taskId: task.id,
      employeeId: world.hk1.employeeId,
      commandId: randomUUID(),
      expectedVersion: task.version,
    });

    try {
      await reassignCleaningTask({
        taskId: task.id,
        assignedEmployeeId: world.hk2.employeeId,
        reason: "while running",
        expectedVersion: started.task.version,
        actorEmployeeId: world.manager.employeeId,
      });
      assert.fail("expected failure while session running / in_progress");
    } catch (err) {
      assert.ok(isAppError(err));
      // in_progress → invalid_state before running-session check; running on
      // assigned/rework/awaiting_inspection → conflict.
      assert.ok(
        err.code === "invalid_state" || err.code === "conflict",
        `unexpected code ${err.code}`,
      );
    }

    await resetCleaningWork(prisma, world);
    const task2 = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });

    try {
      await reassignCleaningTask({
        taskId: task2.id,
        assignedEmployeeId: world.hk2.employeeId,
        reason: "stale version",
        expectedVersion: task2.version - 1,
        actorEmployeeId: world.manager.employeeId,
      });
      assert.fail("expected version_conflict");
    } catch (err) {
      assert.ok(isAppError(err));
      assert.equal(err.code, "version_conflict");
    }

    const updated = await reassignCleaningTask({
      taskId: task2.id,
      assignedEmployeeId: world.hk2.employeeId,
      reason: "coverage swap",
      expectedVersion: task2.version,
      actorEmployeeId: world.manager.employeeId,
    });
    assert.equal(updated.assignedEmployeeId, world.hk2.employeeId);
    assert.equal(updated.reassignReason, "coverage swap");
    assert.equal(updated.version, task2.version + 1);
    assert.equal(updated.status, TaskStatus.assigned);
  });

  for (const status of [TaskStatus.completed, TaskStatus.cancelled, TaskStatus.rework, TaskStatus.awaiting_inspection]) {
    it(`P1-27: reassign matrix for ${status} preserves unrelated state`, async () => {
      const task = await createCleaningTask({
        locationId: world.locationAId, hotelDate: await hotelTodayYmd(),
        assignedEmployeeId: world.hk1.employeeId, actorEmployeeId: world.owner.employeeId,
      });
      // Isolate the state policy from lifecycle preparation (covered separately).
      const before = await prisma.cleaningTask.update({ where: { id: task.id }, data: { status } });
      const location = await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } });
      const audits = await prisma.auditEvent.findMany({ where: { entityId: task.id }, orderBy: { id: "asc" } });
      const notifications = await prisma.notification.findMany({ where: { entityId: task.id }, orderBy: { id: "asc" } });
      const operation = () => reassignCleaningTask({
        taskId: task.id, assignedEmployeeId: world.hk2.employeeId,
        reason: "  coverage  ", expectedVersion: before.version, actorEmployeeId: world.manager.employeeId,
      });
      if (status === TaskStatus.completed || status === TaskStatus.cancelled) {
        await assert.rejects(operation(), (err: unknown) => isAppError(err) && err.code === "invalid_state");
        assert.deepEqual(await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } }), before);
        assert.deepEqual(await prisma.auditEvent.findMany({ where: { entityId: task.id }, orderBy: { id: "asc" } }), audits);
        assert.deepEqual(await prisma.notification.findMany({ where: { entityId: task.id }, orderBy: { id: "asc" } }), notifications);
      } else {
        const updated = await operation();
        assert.equal(updated.status, status);
        assert.equal(updated.assignedEmployeeId, world.hk2.employeeId);
        assert.equal(updated.version, before.version + 1);
        assert.equal(updated.reassignReason, "coverage");
        assert.equal(await prisma.auditEvent.count({ where: { entityId: task.id, action: "cleaning.task.reassign" } }), 1);
      }
      assert.deepEqual(await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } }), location);
      assert.equal(await prisma.cleaningSession.count({ where: { taskId: task.id } }), 0);
      assert.equal(await prisma.inspection.count({ where: { taskId: task.id } }), 0);
    });
  }

  it("P1-27: running session blocks reassignment even when task appears idle", async () => {
    const task = await createCleaningTask({
      locationId: world.locationAId, hotelDate: await hotelTodayYmd(), assignedEmployeeId: world.hk1.employeeId,
    });
    const started = await startCleaningTask({ taskId: task.id, employeeId: world.hk1.employeeId, commandId: randomUUID(), expectedVersion: task.version });
    const before = await prisma.cleaningTask.update({ where: { id: task.id }, data: { status: TaskStatus.assigned } });
    await assert.rejects(reassignCleaningTask({
      taskId: task.id, assignedEmployeeId: world.hk2.employeeId, reason: "idle-looking task", expectedVersion: before.version,
    }), (err: unknown) => isAppError(err) && err.code === "conflict");
    assert.deepEqual(await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } }), before);
    assert.deepEqual(await prisma.cleaningSession.findUniqueOrThrow({ where: { id: started.session.id } }), started.session);
    assert.equal(await prisma.auditEvent.count({ where: { entityId: task.id, action: "cleaning.task.reassign" } }), 0);
  });
});
