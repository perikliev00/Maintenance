// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient, Role, type Prisma } from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { waitForBlockedBehind } from "../dbBarrier";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createCleaningWorld, cleanupCleaningWorld, resetCleaningWork, hotelTodayYmd, createOpenMaintenanceTicket, type CleaningWorld } from "./fixtures";
// Import bindings from ../../src/services/cleaning.
import { createCleaningTask, reassignCleaningTask, startCleaningTask } from "../../src/services/cleaning";
// Import bindings from ../../src/services/maintenance.
import { assignMaintenanceTicket, startMaintenanceTicket } from "../../src/services/maintenance";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Import bindings from ../../src/services/dailyPlan.
import { createDailyPlanEntry } from "../../src/services/dailyPlan";
// Import bindings from ../../src/services/dailyPlanEffects/tasks.
import { linkOrCreateDepartureTask } from "../../src/services/dailyPlanEffects/tasks";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();
// Execute the next setup or assertion step for this scenario.
let world: CleaningWorld;

// Pause the actual assignment write after the final eligibility SELECT. Unlike
// pausing at a domain lock, this reproduces the original uncovered TOCTOU gap.
async function withLateAssignmentBarrier(
  // Execute the next setup or assertion step for this scenario.
  table: "CleaningTask" | "MaintenanceTicket", employeeId: string,
  // Execute the next setup or assertion step for this scenario.
  assign: () => Promise<unknown>, mutate: () => Promise<unknown>,
  // Execute the next setup or assertion step for this scenario.
  assignmentCount = 1,
// Execute the next setup or assertion step for this scenario.
) {
  // Bind column for later setup or assertions in this scope.
  const column = table === "CleaningTask" ? "assignedEmployeeId" : "assigneeId";
  // Bind key for later setup or assertions in this scope.
  const key = Math.floor(Math.random() * 1_000_000_000);
  // Await async work before asserting or releasing locks.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION assignment_late_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."${column}" = '${employeeId}' THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$`);
  // Await async work before asserting or releasing locks.
  await prisma.$executeRawUnsafe(`CREATE TRIGGER assignment_late_barrier BEFORE INSERT OR UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION assignment_late_barrier()`);
  // Execute the next setup or assertion step for this scenario.
  let release!: () => void;
  // Bind gate for later setup or assertions in this scope.
  const gate = new Promise<void>(resolve => { release = resolve; });
  // Execute the next setup or assertion step for this scenario.
  let held!: (pid: number) => void;
  // Bind acquired for later setup or assertions in this scope.
  const acquired = new Promise<number>(resolve => { held = resolve; });
  // Bind holder for later setup or assertions in this scope.
  const holder = prisma.$transaction(async tx => {
    // Await async work before asserting or releasing locks.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${key}::bigint)`;
    // Await async work before asserting or releasing locks.
    const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    // Execute the next setup or assertion step for this scenario.
    held(row!.pid);
    // Await async work before asserting or releasing locks.
    await gate;
  // Runner option controlling stability or isolation of the suite.
  }, { timeout: 20000 });
  // Execute the next setup or assertion step for this scenario.
  let assignment: Promise<unknown> | undefined;
  // Execute the next setup or assertion step for this scenario.
  let mutation: Promise<unknown> | undefined;
  // Try path where partial failure must not leak suite state.
  try {
    // holderPid: unique stamp so parallel runs do not collide.
    const holderPid = await acquired;
    // Execute the next setup or assertion step for this scenario.
    assignment = assign();
    // Execute the next setup or assertion step for this scenario.
    assignment.catch(() => undefined);
    // assignmentPids: synchronize actors so the race window is observable.
    const assignmentPids = await waitForBlockedBehind(prisma, holderPid, assignmentCount);
    // Execute the next setup or assertion step for this scenario.
    mutation = mutate();
    // Execute the next setup or assertion step for this scenario.
    mutation.catch(() => undefined);
    // The User UPDATE must wait for an assignment transaction that already
    // passed eligibility under FOR SHARE, not just any unrelated lock.
    await waitForBlockedBehind(prisma, assignmentPids[0]!);
    // Execute the next setup or assertion step for this scenario.
    release();
    // Await async work before asserting or releasing locks.
    await holder;
    // Await async work before asserting or releasing locks.
    await assignment;
    // Await async work before asserting or releasing locks.
    await mutation;
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Execute the next setup or assertion step for this scenario.
    release();
    // Run actors together to expose races and serialization bugs.
    await Promise.allSettled([holder, assignment, mutation]);
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS assignment_late_barrier ON "${table}"`);
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS assignment_late_barrier()");
  }
}

// Suite: eligibility remains locked after the final read through assignment commit.
describe("eligibility remains locked after the final read through assignment commit", () => {
  // Arrange shared preconditions before cases run.
  before(async () => { await assertTestDatabase(prisma); world = await createCleaningWorld(prisma); });
  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await resetCleaningWork(prisma, world);
    // Await async work before asserting or releasing locks.
    await prisma.user.update({ where: { id: world.hk2.userId }, data: { isActive: true, role: Role.housekeeper } });
    // Await async work before asserting or releasing locks.
    await prisma.user.update({ where: { id: world.technician.userId }, data: { isActive: true, role: Role.technician } });
    // Await async work before asserting or releasing locks.
    await prisma.dailyPlanEntry.deleteMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } } });
  });
  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) {
      // Await async work before asserting or releasing locks.
      await prisma.dailyPlanEntry.deleteMany({ where: { locationId: { in: [world.locationAId, world.locationBId] } } });
      // Await async work before asserting or releasing locks.
      await prisma.ticketEvent.deleteMany({ where: { ticket: { locationId: { in: [world.locationAId, world.locationBId] } } } });
      // Await async work before asserting or releasing locks.
      await cleanupCleaningWorld(prisma, world);
    }
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });
  // Iterate to cover variants or wait until a condition holds.
  for (const path of ["create", "reassign", "ticket", "plan", "departure"] as const) {
    // Iterate to cover variants or wait until a condition holds.
    for (const change of ["deactivate", "role"] as const) {
      // Case: ${path}: ${change} waits for an assignment that passed eligibility.
      it(`${path}: ${change} waits for an assignment that passed eligibility`, async () => {
        // today: synchronize actors so the race window is observable.
        const today = await hotelTodayYmd();
        // Bind employee for later setup or assertions in this scope.
        const employee = path === "ticket" ? world.technician : world.hk2;
        // Execute the next setup or assertion step for this scenario.
        let operation: () => Promise<unknown>;
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (path === "reassign") {
          // task: seeded entity required before the mutation under test.
          const task = await createCleaningTask({ locationId: world.locationAId, hotelDate: today, assignedEmployeeId: world.hk1.employeeId });
          // Execute the next setup or assertion step for this scenario.
          operation = () => reassignCleaningTask({ taskId: task.id, assignedEmployeeId: employee.employeeId, reason: "serialize", expectedVersion: task.version });
        // Execute the next setup or assertion step for this scenario.
        } else if (path === "ticket") {
          // ticket: seeded entity required before the mutation under test.
          const ticket = await createOpenMaintenanceTicket(prisma, world, world.locationAId);
          // Execute the next setup or assertion step for this scenario.
          operation = () => assignMaintenanceTicket({ ticketId: ticket.id, assigneeId: employee.employeeId, actorEmployeeId: world.manager.employeeId });
        // Execute the next setup or assertion step for this scenario.
        } else if (path === "plan") {
          // Seed prerequisite rows so the mutation under test has a realistic baseline.
          operation = () => createDailyPlanEntry({ locationId: world.locationAId, hotelDate: today, category: "priority", assignedEmployeeId: employee.employeeId, createdByEmployeeId: world.manager.employeeId });
        // Execute the next setup or assertion step for this scenario.
        } else if (path === "departure") {
          // Execute the next setup or assertion step for this scenario.
          operation = () => prisma.$transaction((tx: Prisma.TransactionClient) => linkOrCreateDepartureTask(tx, { locationId: world.locationAId, locationKind: "room", hotelDate: new Date(`${today}T00:00:00Z`), assignedEmployeeId: employee.employeeId }));
        // Execute the next setup or assertion step for this scenario.
        } else {
          // Seed prerequisite rows so the mutation under test has a realistic baseline.
          operation = () => createCleaningTask({ locationId: world.locationAId, hotelDate: today, assignedEmployeeId: employee.employeeId });
        }
        // ticketCountBefore: synchronize actors so the race window is observable.
        const ticketCountBefore = await prisma.maintenanceTicket.count({ where: { locationId: world.locationAId, assigneeId: employee.employeeId } });
        // Await async work before asserting or releasing locks.
        await withLateAssignmentBarrier(path === "ticket" ? "MaintenanceTicket" : "CleaningTask", employee.employeeId, operation, () => prisma.user.update({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: employee.userId }, data: change === "deactivate" ? { isActive: false } : { role: Role.reception },
        }));
        // Bind assignments for later setup or assertions in this scope.
        const assignments = path === "ticket"
          // Await async work before asserting or releasing locks.
          ? await prisma.maintenanceTicket.count({ where: { locationId: world.locationAId, assigneeId: employee.employeeId } })
          // Await async work before asserting or releasing locks.
          : await prisma.cleaningTask.count({ where: { locationId: world.locationAId, assignedEmployeeId: employee.employeeId, status: "assigned" } });
        // Assert the observed value matches the intended post-condition.
        assert.equal(assignments, path === "ticket" ? ticketCountBefore + 1 : 1, "assignment serializes before the eligibility change");
        // user: synchronize actors so the race window is observable.
        const user = await prisma.user.findUniqueOrThrow({ where: { id: employee.userId } });
        // Assert the observed value matches the intended post-condition.
        assert.equal(change === "deactivate" ? user.isActive : user.role, change === "deactivate" ? false : Role.reception);
      });
    }
  }
  // Case probes concurrency/isolation: parallel assignments share User locks without upgrades or deadlocks.
  it("parallel assignments share User locks without upgrades or deadlocks", async () => {
    // today: synchronize actors so the race window is observable.
    const today = await hotelTodayYmd();
    // Await async work before asserting or releasing locks.
    await withLateAssignmentBarrier("CleaningTask", world.hk2.employeeId,
      // Run actors together to expose races and serialization bugs.
      () => Promise.all([world.locationAId, world.locationBId].map(locationId => createCleaningTask({
        // Execute the next setup or assertion step for this scenario.
        locationId, hotelDate: today, assignedEmployeeId: world.hk2.employeeId,
      }))),
      // Execute the next setup or assertion step for this scenario.
      () => prisma.user.update({ where: { id: world.hk2.userId }, data: { isActive: false } }),
      2,
    );
    // Assert collection size matches the expected post-condition.
    assert.equal(await prisma.cleaningTask.count({ where: {
      // Execute the next setup or assertion step for this scenario.
      locationId: { in: [world.locationAId, world.locationBId] }, assignedEmployeeId: world.hk2.employeeId, status: "assigned",
    // Execute the next setup or assertion step for this scenario.
    } }), 2);
  });
  // Iterate to cover variants or wait until a condition holds.
  for (const path of ["cleaning", "ticket"] as const) {
    // Case: ${path} starter remains active through its write.
    it(`${path} starter remains active through its write`, async () => {
      // Bind employee for later setup or assertions in this scope.
      const employee = path === "cleaning" ? world.hk2 : world.technician;
      // task: seeded entity required before the mutation under test.
      const task = path === "cleaning" ? await createCleaningTask({ locationId: world.locationAId, hotelDate: await hotelTodayYmd(), assignedEmployeeId: employee.employeeId }) : null;
      // ticket: seeded entity required before the mutation under test.
      const ticket = path === "ticket" ? await createOpenMaintenanceTicket(prisma, world, world.locationAId) : null;
      // Guard optional cleanup or alternate assertion paths.
      if (ticket) await prisma.maintenanceTicket.update({ where: { id: ticket.id }, data: { status: "assigned", assigneeId: employee.employeeId } });
      // Await async work before asserting or releasing locks.
      await withLateAssignmentBarrier(path === "cleaning" ? "CleaningTask" : "MaintenanceTicket", employee.employeeId,
        // Execute the next setup or assertion step for this scenario.
        () => task ? startCleaningTask({ taskId: task.id, employeeId: employee.employeeId, commandId: randomUUID(), expectedVersion: task.version }) : startMaintenanceTicket({ ticketId: ticket!.id, actorEmployeeId: employee.employeeId, commandId: randomUUID() }),
        // Execute the next setup or assertion step for this scenario.
        () => prisma.user.update({ where: { id: employee.userId }, data: { isActive: false } }),
      );
      // updated: synchronize actors so the race window is observable.
      const updated = task ? await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } }) : await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticket!.id } });
      // Assert HTTP status matches the contract for this path.
      assert.equal(updated.status, "in_progress");
    });
  }
  // Iterate to cover variants or wait until a condition holds.
  for (const path of ["plan", "departure"] as const) {
    // Iterate to cover variants or wait until a condition holds.
    for (const change of ["deactivate", "role"] as const) {
      // Case: ${path}: a previously stored assignee is rejected after ${change} with no effects.
      it(`${path}: a previously stored assignee is rejected after ${change} with no effects`, async () => {
        // today: synchronize actors so the race window is observable.
        const today = await hotelTodayYmd();
        // Await async work before asserting or releasing locks.
        await prisma.user.update({ where: { id: world.hk2.userId }, data: change === "deactivate" ? { isActive: false } : { role: Role.reception } });
        // Bind snapshot for later setup or assertions in this scope.
        const snapshot = async () => ({
          // Await async work before asserting or releasing locks.
          location: await prisma.location.findUniqueOrThrow({ where: { id: world.locationAId } }),
          // Await async work before asserting or releasing locks.
          tasks: await prisma.cleaningTask.findMany({ where: { locationId: world.locationAId }, orderBy: { id: "asc" } }),
          // Await async work before asserting or releasing locks.
          entries: await prisma.dailyPlanEntry.findMany({ where: { locationId: world.locationAId }, orderBy: { id: "asc" } }),
          // Await async work before asserting or releasing locks.
          audits: await prisma.auditEvent.findMany({ where: { locationId: world.locationAId }, orderBy: { id: "asc" } }),
        });
        // before: synchronize actors so the race window is observable.
        const before = await snapshot();
        // Bind operation for later setup or assertions in this scope.
        const operation = path === "plan"
          // Seed prerequisite rows so the mutation under test has a realistic baseline.
          ? createDailyPlanEntry({ locationId: world.locationAId, hotelDate: today, category: "priority", assignedEmployeeId: world.hk2.employeeId, createdByEmployeeId: world.manager.employeeId })
          : prisma.$transaction(tx => linkOrCreateDepartureTask(tx, { locationId: world.locationAId, locationKind: "room", hotelDate: new Date(`${today}T00:00:00Z`), assignedEmployeeId: world.hk2.employeeId }));
        // Await async work before asserting or releasing locks.
        await assert.rejects(operation, /Assignee must be an active housekeeper/);
        // Assert the observed value matches the intended post-condition.
        assert.deepEqual(await snapshot(), before);
      });
    }
  }
});
