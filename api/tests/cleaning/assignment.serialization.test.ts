import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient, Role, type Prisma } from "@prisma/client";
import { assertTestDatabase } from "../assertTestDatabase";
import { createCleaningWorld, cleanupCleaningWorld, resetCleaningWork, hotelTodayYmd, createOpenMaintenanceTicket, type CleaningWorld } from "./fixtures";
import { createCleaningTask, reassignCleaningTask, startCleaningTask } from "../../src/services/cleaning";
import { assignMaintenanceTicket, startMaintenanceTicket } from "../../src/services/maintenance";
import { randomUUID } from "node:crypto";
import { createDailyPlanEntry } from "../../src/services/dailyPlan";
import { linkOrCreateDepartureTask } from "../../src/services/dailyPlanEffects/tasks";

const prisma = new PrismaClient();
let world: CleaningWorld;

async function waitForBlockedBy(blockerPid: number, count = 1): Promise<number> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND ${blockerPid} = ANY(pg_blocking_pids(pid))
    `;
    if (rows.length >= count) return rows[0]!.pid;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`No PostgreSQL waiter blocked by backend ${blockerPid}`);
}

// Pause the actual assignment write after the final eligibility SELECT. Unlike
// pausing at a domain lock, this reproduces the original uncovered TOCTOU gap.
async function withLateAssignmentBarrier(
  table: "CleaningTask" | "MaintenanceTicket", employeeId: string,
  assign: () => Promise<unknown>, mutate: () => Promise<unknown>,
  assignmentCount = 1,
) {
  const column = table === "CleaningTask" ? "assignedEmployeeId" : "assigneeId";
  const key = Math.floor(Math.random() * 1_000_000_000);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION assignment_late_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."${column}" = '${employeeId}' THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER assignment_late_barrier BEFORE INSERT OR UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION assignment_late_barrier()`);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held!: (pid: number) => void;
  const acquired = new Promise<number>(resolve => { held = resolve; });
  const holder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${key}::bigint)`;
    const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    held(row!.pid);
    await gate;
  }, { timeout: 15000 });
  let assignment: Promise<unknown> | undefined;
  let mutation: Promise<unknown> | undefined;
  try {
    const holderPid = await acquired;
    assignment = assign();
    assignment.catch(() => undefined);
    const assignmentPid = await waitForBlockedBy(holderPid, assignmentCount);
    mutation = mutate();
    mutation.catch(() => undefined);
    // The User UPDATE must wait for the exact assignment transaction, not just
    // any unrelated lock. Without FOR SHARE it commits here and this fails.
    await waitForBlockedBy(assignmentPid);
    release();
    await holder;
    await assignment;
    await mutation;
  } finally {
    release();
    await Promise.allSettled([holder, assignment, mutation]);
    await prisma.$executeRawUnsafe(`DROP TRIGGER assignment_late_barrier ON "${table}"`);
    await prisma.$executeRawUnsafe("DROP FUNCTION assignment_late_barrier()");
  }
}

describe("eligibility remains locked after the final read through assignment commit", () => {
  before(async () => { await assertTestDatabase(prisma); world = await createCleaningWorld(prisma); });
  beforeEach(async () => {
    await resetCleaningWork(prisma, world);
    await prisma.user.update({ where: { id: world.hk2.userId }, data: { isActive: true, role: Role.housekeeper } });
    await prisma.user.update({ where: { id: world.technician.userId }, data: { isActive: true, role: Role.technician } });
    await prisma.dailyPlanEntry.deleteMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } } });
  });
  after(async () => {
    if (world) {
      await prisma.dailyPlanEntry.deleteMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } } });
      await prisma.ticketEvent.deleteMany({ where: { ticket: { locationId: { in: [world.locationAId, world.locationBId] } } } });
      await cleanupCleaningWorld(prisma, world);
    }
    await prisma.$disconnect();
  });
  for (const path of ["create", "reassign", "ticket", "plan", "departure"] as const) {
    for (const change of ["deactivate", "role"] as const) {
      it(`${path}: ${change} waits for an assignment that passed eligibility`, async () => {
        const today = await hotelTodayYmd();
        const employee = path === "ticket" ? world.technician : world.hk2;
        let operation: () => Promise<unknown>;
        if (path === "reassign") {
          const task = await createCleaningTask({ locationId: world.locationAId, hotelDate: today, assignedEmployeeId: world.hk1.employeeId });
          operation = () => reassignCleaningTask({ taskId: task.id, assignedEmployeeId: employee.employeeId, reason: "serialize", expectedVersion: task.version });
        } else if (path === "ticket") {
          const ticket = await createOpenMaintenanceTicket(prisma, world, world.locationAId);
          operation = () => assignMaintenanceTicket({ ticketId: ticket.id, assigneeId: employee.employeeId, actorEmployeeId: world.manager.employeeId });
        } else if (path === "plan") {
          operation = () => createDailyPlanEntry({ locationId: world.locationAId, hotelDate: today, category: "priority", assignedEmployeeId: employee.employeeId, createdByEmployeeId: world.manager.employeeId });
        } else if (path === "departure") {
          operation = () => prisma.$transaction((tx: Prisma.TransactionClient) => linkOrCreateDepartureTask(tx, { locationId: world.locationAId, locationKind: "room", hotelDate: new Date(`${today}T00:00:00Z`), assignedEmployeeId: employee.employeeId }));
        } else {
          operation = () => createCleaningTask({ locationId: world.locationAId, hotelDate: today, assignedEmployeeId: employee.employeeId });
        }
        const ticketCountBefore = await prisma.maintenanceTicket.count({ where: { locationId: world.locationAId, assigneeId: employee.employeeId } });
        await withLateAssignmentBarrier(path === "ticket" ? "MaintenanceTicket" : "CleaningTask", employee.employeeId, operation, () => prisma.user.update({
          where: { id: employee.userId }, data: change === "deactivate" ? { isActive: false } : { role: Role.reception },
        }));
        const assignments = path === "ticket"
          ? await prisma.maintenanceTicket.count({ where: { locationId: world.locationAId, assigneeId: employee.employeeId } })
          : await prisma.cleaningTask.count({ where: { locationId: world.locationAId, assignedEmployeeId: employee.employeeId, status: "assigned" } });
        assert.equal(assignments, path === "ticket" ? ticketCountBefore + 1 : 1, "assignment serializes before the eligibility change");
        const user = await prisma.user.findUniqueOrThrow({ where: { id: employee.userId } });
        assert.equal(change === "deactivate" ? user.isActive : user.role, change === "deactivate" ? false : Role.reception);
      });
    }
  }
  it("parallel assignments share User locks without upgrades or deadlocks", async () => {
    const today = await hotelTodayYmd();
    await withLateAssignmentBarrier("CleaningTask", world.hk2.employeeId,
      () => Promise.all([world.locationAId, world.locationBId].map(locationId => createCleaningTask({
        locationId, hotelDate: today, assignedEmployeeId: world.hk2.employeeId,
      }))),
      () => prisma.user.update({ where: { id: world.hk2.userId }, data: { isActive: false } }),
      2,
    );
    assert.equal(await prisma.cleaningTask.count({ where: {
      locationId: { in: [world.locationAId, world.locationBId] }, assignedEmployeeId: world.hk2.employeeId, status: "assigned",
    } }), 2);
  });
  for (const path of ["cleaning", "ticket"] as const) {
    it(`${path} starter remains active through its write`, async () => {
      const employee = path === "cleaning" ? world.hk2 : world.technician;
      const task = path === "cleaning" ? await createCleaningTask({ locationId: world.locationAId, hotelDate: await hotelTodayYmd(), assignedEmployeeId: employee.employeeId }) : null;
      const ticket = path === "ticket" ? await createOpenMaintenanceTicket(prisma, world, world.locationAId) : null;
      if (ticket) await prisma.maintenanceTicket.update({ where: { id: ticket.id }, data: { status: "assigned", assigneeId: employee.employeeId } });
      await withLateAssignmentBarrier(path === "cleaning" ? "CleaningTask" : "MaintenanceTicket", employee.employeeId,
        () => task ? startCleaningTask({ taskId: task.id, employeeId: employee.employeeId, commandId: randomUUID(), expectedVersion: task.version }) : startMaintenanceTicket({ ticketId: ticket!.id, actorEmployeeId: employee.employeeId, commandId: randomUUID() }),
        () => prisma.user.update({ where: { id: employee.userId }, data: { isActive: false } }),
      );
      const updated = task ? await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } }) : await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticket!.id } });
      assert.equal(updated.status, "in_progress");
    });
  }
  for (const path of ["plan", "departure"] as const) {
    for (const change of ["deactivate", "role"] as const) {
      it(`${path}: a previously stored assignee is rejected after ${change} with no effects`, async () => {
        const today = await hotelTodayYmd();
        await prisma.user.update({ where: { id: world.hk2.userId }, data: change === "deactivate" ? { isActive: false } : { role: Role.reception } });
        const snapshot = async () => ({
          location: await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } }),
          tasks: await prisma.cleaningTask.findMany({ where: { locationId: world.locationAId }, orderBy: { id: "asc" } }),
          entries: await prisma.dailyPlanEntry.findMany({ where: { locationId: world.locationAId }, orderBy: { id: "asc" } }),
          audits: await prisma.auditEvent.findMany({ where: { locationId: world.locationAId }, orderBy: { id: "asc" } }),
        });
        const before = await snapshot();
        const operation = path === "plan"
          ? createDailyPlanEntry({ locationId: world.locationAId, hotelDate: today, category: "priority", assignedEmployeeId: world.hk2.employeeId, createdByEmployeeId: world.manager.employeeId })
          : prisma.$transaction(tx => linkOrCreateDepartureTask(tx, { locationId: world.locationAId, locationKind: "room", hotelDate: new Date(`${today}T00:00:00Z`), assignedEmployeeId: world.hk2.employeeId }));
        await assert.rejects(operation, /Assignee must be an active housekeeper/);
        assert.deepEqual(await snapshot(), before);
      });
    }
  }
});
