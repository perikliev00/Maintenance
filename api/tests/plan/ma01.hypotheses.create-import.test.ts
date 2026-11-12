/**
 * Audit hypothesis — manual create / import of a past departure vs a real newer check-in.
 * Decision+evidence must not vacate after occupancy is already occupied with audit proof.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CleaningStatus,
  // Execute the next setup or assertion step for this scenario.
  DailyPlanCategory,
  // Execute the next setup or assertion step for this scenario.
  Occupancy,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  TaskStatus,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { waitForBlockedBehind } from "../dbBarrier";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  createDailyPlanEntry,
  // Execute the next setup or assertion step for this scenario.
  importDailyPlan,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/dailyPlan";
// Import bindings from ../../src/services/locations/status.
import { setLocationOccupancy } from "../../src/services/locations/status";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cancelActiveTasks,
  // Execute the next setup or assertion step for this scenario.
  cleanupPlanArtifacts,
  // Execute the next setup or assertion step for this scenario.
  cleanupPlanWorld,
  // Execute the next setup or assertion step for this scenario.
  createActiveTask,
  // Execute the next setup or assertion step for this scenario.
  createPlanWorld,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  prepareRoom,
  // Execute the next setup or assertion step for this scenario.
  snapshotLocation,
  // Pagination step for list/contract coverage.
  ymdOffset,
  // Shape PlanWorld documents the fixture/response fields this suite touches.
  type PlanWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();
// REPS: repetition count to amplify race windows.
const REPS = 8;

// Suite: MA hypothesis: create/import past departure vs check-in.
describe("MA hypothesis: create/import past departure vs check-in", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: PlanWorld;
  // Execute the next setup or assertion step for this scenario.
  let today: string;
  // Execute the next setup or assertion step for this scenario.
  let past: string;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createPlanWorld(prisma);
    // Await async work before asserting or releasing locks.
    today = await hotelTodayYmd();
    // Pagination step for list/contract coverage.
    past = ymdOffset(today, -3);
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupPlanWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
    // Await async work before asserting or releasing locks.
    await cleanupPlanArtifacts(prisma, [
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      world.locationBId,
      // Execute the next setup or assertion step for this scenario.
      world.locationCId,
      // Execute the next setup or assertion step for this scenario.
      world.archivedLocationId,
    ]);
  });

  // Helper seedVacantWithTask: arrange fixture data for the case.
  async function seedVacantWithTask(locationId: string) {
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, locationId);
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, locationId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.verified_clean,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: 4,
    });
    // Return the arranged value/result to the caller.
    return createActiveTask(prisma, {
      // Execute the next setup or assertion step for this scenario.
      locationId,
      // Execute the next setup or assertion step for this scenario.
      hotelDateYmd: today,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: world.shiftId,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: 4,
    });
  }

  // Helper assertStayPreserved: assert expected post-condition.
  async function assertStayPreserved(locationId: string, cycle: number) {
    // loc: synchronize actors so the race window is observable.
    const loc = await snapshotLocation(prisma, locationId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.occupancy, Occupancy.occupied);
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningStatus, CleaningStatus.verified_clean);
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.cleaningCycle, cycle);
    // activeDepartureTasks: synchronize actors so the race window is observable.
    const activeDepartureTasks = await prisma.cleaningTask.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${past}T00:00:00.000Z`),
        // Fixture field status for the seeded actor/entity.
        status: {
          // Execute the next setup or assertion step for this scenario.
          in: [
            // Execute the next setup or assertion step for this scenario.
            TaskStatus.assigned,
            // Execute the next setup or assertion step for this scenario.
            TaskStatus.in_progress,
            // Execute the next setup or assertion step for this scenario.
            TaskStatus.rework,
            // Execute the next setup or assertion step for this scenario.
            TaskStatus.awaiting_inspection,
          ],
        },
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(activeDepartureTasks, 0);
  }

  // Case: sequential create after check-in protects the stay.
  it("sequential create after check-in protects the stay", async () => {
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await seedVacantWithTask(world.locationAId);
    // before: synchronize actors so the race window is observable.
    const before = await snapshotLocation(prisma, world.locationAId);
    // Await async work before asserting or releasing locks.
    await setLocationOccupancy(
      // Execute the next setup or assertion step for this scenario.
      world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      Occupancy.occupied,
      // Execute the next setup or assertion step for this scenario.
      world.reception.employeeId,
    );
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await createDailyPlanEntry({
      // Execute the next setup or assertion step for this scenario.
      hotelDate: past,
      // Execute the next setup or assertion step for this scenario.
      locationId: world.locationAId,
      // Execute the next setup or assertion step for this scenario.
      category: "departure",
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.owner.employeeId,
    });
    // Await async work before asserting or releasing locks.
    await assertStayPreserved(world.locationAId, before.cleaningCycle);
    // entry: synchronize actors so the race window is observable.
    const entry = await prisma.dailyPlanEntry.findFirstOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: new Date(`${past}T00:00:00.000Z`),
        // Execute the next setup or assertion step for this scenario.
        category: DailyPlanCategory.departure,
      },
    });
    // Protect stamps applied; defer leaves null — either preserves occupancy.
    assert.equal(
      // Await async work before asserting or releasing locks.
      (await snapshotLocation(prisma, world.locationAId)).occupancy,
      // Execute the next setup or assertion step for this scenario.
      Occupancy.occupied,
    );
    // Fire-and-await side effect required before the next assertion.
    void entry;
  });

  // Case: sequential import after check-in protects the stay.
  it("sequential import after check-in protects the stay", async () => {
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await seedVacantWithTask(world.locationBId);
    // before: synchronize actors so the race window is observable.
    const before = await snapshotLocation(prisma, world.locationBId);
    // Await async work before asserting or releasing locks.
    await setLocationOccupancy(
      // Execute the next setup or assertion step for this scenario.
      world.locationBId,
      // Execute the next setup or assertion step for this scenario.
      Occupancy.occupied,
      // Execute the next setup or assertion step for this scenario.
      world.reception.employeeId,
    );
    // imp: synchronize actors so the race window is observable.
    const imp = await importDailyPlan(
      {
        // Execute the next setup or assertion step for this scenario.
        hotelDate: past,
        // Execute the next setup or assertion step for this scenario.
        sourceLabel: "ma-hyp-import-seq",
        // Execute the next setup or assertion step for this scenario.
        entries: [
          {
            // Execute the next setup or assertion step for this scenario.
            buildingCode: world.buildingCode,
            // Execute the next setup or assertion step for this scenario.
            roomNumber: world.roomBNumber,
            // Execute the next setup or assertion step for this scenario.
            category: DailyPlanCategory.departure,
            // Execute the next setup or assertion step for this scenario.
            externalId: `ma-hyp-imp-${world.stamp}`,
          },
        ],
      },
      // Execute the next setup or assertion step for this scenario.
      world.owner.employeeId,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(imp.batch.errorCount, 0, JSON.stringify(imp));
    // Await async work before asserting or releasing locks.
    await assertStayPreserved(world.locationBId, before.cleaningCycle);
  });

  // Helper raceCheckInWhileTaskLocked: concurrency/isolation coordination.
  async function raceCheckInWhileTaskLocked(opts: {
    // Execute the next setup or assertion step for this scenario.
    locationId: string;
    // Execute the next setup or assertion step for this scenario.
    taskId: string;
    // Execute the next setup or assertion step for this scenario.
    startOp: () => Promise<unknown>;
  }) {
    // Shared Prisma client bound to the isolated test database.
    const holderPrisma = new PrismaClient();
    // Execute the next setup or assertion step for this scenario.
    let release!: () => void;
    // Bind gate for later setup or assertions in this scope.
    const gate = new Promise<void>((resolve) => {
      // Execute the next setup or assertion step for this scenario.
      release = resolve;
    });
    // Execute the next setup or assertion step for this scenario.
    let ready!: (pid: number) => void;
    // Bind held for later setup or assertions in this scope.
    const held = new Promise<number>((resolve) => {
      // Execute the next setup or assertion step for this scenario.
      ready = resolve;
    });
    // Bind holder for later setup or assertions in this scope.
    const holder = holderPrisma.$transaction(
      // Execute the next setup or assertion step for this scenario.
      async (tx) => {
        // Await async work before asserting or releasing locks.
        const [row] = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid
        `;
        // Await async work before asserting or releasing locks.
        await tx.$queryRaw`
          SELECT id FROM "CleaningTask" WHERE id = ${opts.taskId} FOR UPDATE
        `;
        // Execute the next setup or assertion step for this scenario.
        ready(row!.pid);
        // Await async work before asserting or releasing locks.
        await gate;
      },
      // Runner option controlling stability or isolation of the suite.
      { timeout: 20_000, maxWait: 20_000 },
    );
    // Try path where partial failure must not leak suite state.
    try {
      // holderPid: unique stamp so parallel runs do not collide.
      const holderPid = await held;
      // Bind opP for later setup or assertions in this scope.
      const opP = opts.startOp();
      // Fire-and-await side effect required before the next assertion.
      void opP.catch(() => undefined);
      // Coordinate DB lock waiters so the concurrent race is deterministic.
      await waitForBlockedBehind(prisma, holderPid, 1);
      // Await async work before asserting or releasing locks.
      await setLocationOccupancy(
        // Execute the next setup or assertion step for this scenario.
        opts.locationId,
        // Execute the next setup or assertion step for this scenario.
        Occupancy.occupied,
        // Execute the next setup or assertion step for this scenario.
        world.reception.employeeId,
      );
      // Execute the next setup or assertion step for this scenario.
      release();
      // Await async work before asserting or releasing locks.
      await holder;
      // Await async work before asserting or releasing locks.
      await opP;
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Execute the next setup or assertion step for this scenario.
      release();
      // Await async work before asserting or releasing locks.
      await holder.catch(() => undefined);
      // Disconnect Prisma so the pool does not leak across suites.
      await holderPrisma.$disconnect();
    }
  }

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let rep = 1; rep <= REPS; rep++) {
    // Case probes concurrency/isolation: create: check-in commits while create waits on task lock (rep ${rep}).
    it(`create: check-in commits while create waits on task lock (rep ${rep})`, async () => {
      // task: seeded entity required before the mutation under test.
      const task = await seedVacantWithTask(world.locationAId);
      // before: synchronize actors so the race window is observable.
      const before = await snapshotLocation(prisma, world.locationAId);

      // Await async work before asserting or releasing locks.
      await raceCheckInWhileTaskLocked({
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationAId,
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        startOp: () =>
          // Seed prerequisite rows so the mutation under test has a realistic baseline.
          createDailyPlanEntry({
            // Execute the next setup or assertion step for this scenario.
            hotelDate: past,
            // Execute the next setup or assertion step for this scenario.
            locationId: world.locationAId,
            // Execute the next setup or assertion step for this scenario.
            category: "departure",
            // Execute the next setup or assertion step for this scenario.
            createdByEmployeeId: world.owner.employeeId,
          }),
      });

      // Await async work before asserting or releasing locks.
      await assertStayPreserved(world.locationAId, before.cleaningCycle);
    });
  }

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let rep = 1; rep <= REPS; rep++) {
    // Case probes concurrency/isolation: import: check-in commits while import waits on task lock (rep ${rep}).
    it(`import: check-in commits while import waits on task lock (rep ${rep})`, async () => {
      // task: seeded entity required before the mutation under test.
      const task = await seedVacantWithTask(world.locationBId);
      // before: synchronize actors so the race window is observable.
      const before = await snapshotLocation(prisma, world.locationBId);
      // externalId: unique stamp so parallel runs do not collide.
      const externalId = `ma-hyp-imp-c-${world.stamp}-${rep}`;

      // Await async work before asserting or releasing locks.
      await raceCheckInWhileTaskLocked({
        // Execute the next setup or assertion step for this scenario.
        locationId: world.locationBId,
        // Execute the next setup or assertion step for this scenario.
        taskId: task.id,
        // Execute the next setup or assertion step for this scenario.
        startOp: () =>
          // Execute the next setup or assertion step for this scenario.
          importDailyPlan(
            {
              // Execute the next setup or assertion step for this scenario.
              hotelDate: past,
              // Execute the next setup or assertion step for this scenario.
              sourceLabel: `ma-hyp-import-${rep}`,
              // Execute the next setup or assertion step for this scenario.
              entries: [
                {
                  // Execute the next setup or assertion step for this scenario.
                  buildingCode: world.buildingCode,
                  // Execute the next setup or assertion step for this scenario.
                  roomNumber: world.roomBNumber,
                  // Execute the next setup or assertion step for this scenario.
                  category: DailyPlanCategory.departure,
                  // Execute the next setup or assertion step for this scenario.
                  externalId,
                },
              ],
            },
            // Execute the next setup or assertion step for this scenario.
            world.owner.employeeId,
          ),
      });

      // Await async work before asserting or releasing locks.
      await assertStayPreserved(world.locationBId, before.cleaningCycle);
    });
  }
});
