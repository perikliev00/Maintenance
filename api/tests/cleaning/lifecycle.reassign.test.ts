/**
 * T-CLN-15, T-CLN-27 — assignee eligibility + reassign constraints.
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
import { lockTask } from "../../src/services/cleaning/locks";
import { assignMaintenanceTicket } from "../../src/services/maintenance";
import {
  cleanupCleaningWorld,
  createCleaningWorld,
  createOpenMaintenanceTicket,
  hotelTodayYmd,
  isAppError,
  resetCleaningWork,
  type CleaningWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

describe("cleaning lifecycle reassign (T-CLN-15/27)", () => {
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

    // Hold the task lock so reassign passes the outer eligibility check, then
    // waits — deactivate/demote before the in-TX re-check runs.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let lockHeld = false;
    const holder = prisma.$transaction(
      async (tx) => {
        await lockTask(tx, task.id);
        lockHeld = true;
        await gate;
      },
      { timeout: 20_000, maxWait: 20_000 },
    );

    for (let i = 0; i < 50 && !lockHeld; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(lockHeld, "expected advisory holder to lock the task");

    const reassignP = reassignCleaningTask({
      taskId: task.id,
      assignedEmployeeId: world.hk2.employeeId,
      reason: "race against block",
      expectedVersion: task.version,
      actorEmployeeId: world.manager.employeeId,
    });
    // Outer assertActiveCleaningAssignee already passed; wait on FOR UPDATE.
    await new Promise((r) => setTimeout(r, 80));

    await prisma.user.update({
      where: { id: world.hk2.userId },
      data: { isActive: false },
    });
    release();
    await holder;

    try {
      await reassignP;
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

    let release2!: () => void;
    const gate2 = new Promise<void>((resolve) => {
      release2 = resolve;
    });
    let lockHeld2 = false;
    const holder2 = prisma.$transaction(
      async (tx) => {
        await lockTask(tx, task.id);
        lockHeld2 = true;
        await gate2;
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
    for (let i = 0; i < 50 && !lockHeld2; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(lockHeld2);

    const reassignRoleP = reassignCleaningTask({
      taskId: task.id,
      assignedEmployeeId: world.hk2.employeeId,
      reason: "race against role change",
      expectedVersion: afterBlock.version,
      actorEmployeeId: world.manager.employeeId,
    });
    await new Promise((r) => setTimeout(r, 80));
    await prisma.user.update({
      where: { id: world.hk2.userId },
      data: { role: Role.reception },
    });
    release2();
    await holder2;

    try {
      await reassignRoleP;
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
});
