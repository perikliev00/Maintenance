/**
 * Audit hypothesis — manual create / import of a past departure vs a real newer check-in.
 * Decision+evidence must not vacate after occupancy is already occupied with audit proof.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  CleaningStatus,
  DailyPlanCategory,
  Occupancy,
  PrismaClient,
  TaskStatus,
} from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Concurrency helpers to order/observe PostgreSQL lock waiters.
import { waitForBlockedBehind } from "../dbBarrier";
import {
  createDailyPlanEntry,
  importDailyPlan,
} from "../../src/services/dailyPlan";
import { setLocationOccupancy } from "../../src/services/locations/status";
import {
  cancelActiveTasks,
  cleanupPlanArtifacts,
  cleanupPlanWorld,
  createActiveTask,
  createPlanWorld,
  hotelTodayYmd,
  prepareRoom,
  snapshotLocation,
  ymdOffset,
  // Shape PlanWorld documents the fixture/response fields this suite touches.
  type PlanWorld,
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();
// REPS: repetition count to amplify race windows.
const REPS = 8;

// Suite: MA hypothesis: create/import past departure vs check-in.
describe("MA hypothesis: create/import past departure vs check-in", () => {
  let world: PlanWorld;
  let today: string;
  let past: string;

  before(async () => {
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    world = await createPlanWorld(prisma);
    today = await hotelTodayYmd();
    past = ymdOffset(today, -3);
  });

  after(async () => {
    if (world) await cleanupPlanWorld(prisma, world);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanupPlanArtifacts(prisma, [
      world.locationAId,
      world.locationBId,
      world.locationCId,
      world.archivedLocationId,
    ]);
  });

  // Helper seedVacantWithTask: arrange fixture data for the case.
  async function seedVacantWithTask(locationId: string) {
    await cancelActiveTasks(prisma, locationId);
    await prepareRoom(prisma, locationId, {
      occupancy: Occupancy.vacant,
      cleaningStatus: CleaningStatus.verified_clean,
      cleaningCycle: 4,
    });
    return createActiveTask(prisma, {
      locationId,
      hotelDateYmd: today,
      assignedEmployeeId: world.hk1.employeeId,
      shiftId: world.shiftId,
      cleaningCycle: 4,
    });
  }

  // Helper assertStayPreserved: assert expected post-condition.
  async function assertStayPreserved(locationId: string, cycle: number) {
    const loc = await snapshotLocation(prisma, locationId);
    assert.equal(loc.occupancy, Occupancy.occupied);
    assert.equal(loc.cleaningStatus, CleaningStatus.verified_clean);
    assert.equal(loc.cleaningCycle, cycle);
    const activeDepartureTasks = await prisma.cleaningTask.count({
      where: {
        locationId,
        hotelDate: new Date(`${past}T00:00:00.000Z`),
        status: {
          in: [
            TaskStatus.assigned,
            TaskStatus.in_progress,
            TaskStatus.rework,
            TaskStatus.awaiting_inspection,
          ],
        },
      },
    });
    assert.equal(activeDepartureTasks, 0);
  }

  // Case: sequential create after check-in protects the stay.
  it("sequential create after check-in protects the stay", async () => {
    await seedVacantWithTask(world.locationAId);
    const before = await snapshotLocation(prisma, world.locationAId);
    await setLocationOccupancy(
      world.locationAId,
      Occupancy.occupied,
      world.reception.employeeId,
    );
    await createDailyPlanEntry({
      hotelDate: past,
      locationId: world.locationAId,
      category: "departure",
      createdByEmployeeId: world.owner.employeeId,
    });
    await assertStayPreserved(world.locationAId, before.cleaningCycle);
    const entry = await prisma.dailyPlanEntry.findFirstOrThrow({
      where: {
        locationId: world.locationAId,
        hotelDate: new Date(`${past}T00:00:00.000Z`),
        category: DailyPlanCategory.departure,
      },
    });
    // Protect stamps applied; defer leaves null — either preserves occupancy.
    assert.equal(
      (await snapshotLocation(prisma, world.locationAId)).occupancy,
      Occupancy.occupied,
    );
    // Fire-and-await side effect required before the next assertion.
    void entry;
  });

  // Case: sequential import after check-in protects the stay.
  it("sequential import after check-in protects the stay", async () => {
    await seedVacantWithTask(world.locationBId);
    const before = await snapshotLocation(prisma, world.locationBId);
    await setLocationOccupancy(
      world.locationBId,
      Occupancy.occupied,
      world.reception.employeeId,
    );
    const imp = await importDailyPlan(
      {
        hotelDate: past,
        sourceLabel: "ma-hyp-import-seq",
        entries: [
          {
            buildingCode: world.buildingCode,
            roomNumber: world.roomBNumber,
            category: DailyPlanCategory.departure,
            externalId: `ma-hyp-imp-${world.stamp}`,
          },
        ],
      },
      world.owner.employeeId,
    );
    assert.equal(imp.batch.errorCount, 0, JSON.stringify(imp));
    await assertStayPreserved(world.locationBId, before.cleaningCycle);
  });

  // Helper raceCheckInWhileTaskLocked: concurrency/isolation coordination.
  async function raceCheckInWhileTaskLocked(opts: {
    locationId: string;
    taskId: string;
    startOp: () => Promise<unknown>;
  }) {
    // Shared Prisma client bound to the isolated test database.
    const holderPrisma = new PrismaClient();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready!: (pid: number) => void;
    const held = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const holder = holderPrisma.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid
        `;
        await tx.$queryRaw`
          SELECT id FROM "CleaningTask" WHERE id = ${opts.taskId} FOR UPDATE
        `;
        ready(row!.pid);
        await gate;
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
    try {
      const holderPid = await held;
      const opP = opts.startOp();
      // Fire-and-await side effect required before the next assertion.
      void opP.catch(() => undefined);
      // Coordinate DB lock waiters so the concurrent race is deterministic.
      await waitForBlockedBehind(prisma, holderPid, 1);
      await setLocationOccupancy(
        opts.locationId,
        Occupancy.occupied,
        world.reception.employeeId,
      );
      release();
      await holder;
      await opP;
    } finally {
      release();
      await holder.catch(() => undefined);
      await holderPrisma.$disconnect();
    }
  }

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let rep = 1; rep <= REPS; rep++) {
    // Case probes concurrency/isolation: create: check-in commits while create waits on task lock (rep ${rep}).
    it(`create: check-in commits while create waits on task lock (rep ${rep})`, async () => {
      const task = await seedVacantWithTask(world.locationAId);
      const before = await snapshotLocation(prisma, world.locationAId);

      await raceCheckInWhileTaskLocked({
        locationId: world.locationAId,
        taskId: task.id,
        startOp: () =>
          createDailyPlanEntry({
            hotelDate: past,
            locationId: world.locationAId,
            category: "departure",
            createdByEmployeeId: world.owner.employeeId,
          }),
      });

      await assertStayPreserved(world.locationAId, before.cleaningCycle);
    });
  }

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let rep = 1; rep <= REPS; rep++) {
    // Case probes concurrency/isolation: import: check-in commits while import waits on task lock (rep ${rep}).
    it(`import: check-in commits while import waits on task lock (rep ${rep})`, async () => {
      const task = await seedVacantWithTask(world.locationBId);
      const before = await snapshotLocation(prisma, world.locationBId);
      const externalId = `ma-hyp-imp-c-${world.stamp}-${rep}`;

      await raceCheckInWhileTaskLocked({
        locationId: world.locationBId,
        taskId: task.id,
        startOp: () =>
          importDailyPlan(
            {
              hotelDate: past,
              sourceLabel: `ma-hyp-import-${rep}`,
              entries: [
                {
                  buildingCode: world.buildingCode,
                  roomNumber: world.roomBNumber,
                  category: DailyPlanCategory.departure,
                  externalId,
                },
              ],
            },
            world.owner.employeeId,
          ),
      });

      await assertStayPreserved(world.locationBId, before.cleaningCycle);
    });
  }
});
