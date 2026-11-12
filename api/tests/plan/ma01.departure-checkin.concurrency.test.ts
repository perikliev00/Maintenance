/**
 * MA-01 — completed newer check-in survives concurrent apply of a past departure.
 * HTTP + PostgreSQL barrier on CleaningTask (departure decides before location lock).
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
// Import bindings from ../../src/services/roleGrants.
import { ensureDefaultRoleGrants } from "../../src/services/roleGrants";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  PLAN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cancelActiveTasks,
  // Execute the next setup or assertion step for this scenario.
  cleanupPlanArtifacts,
  // Execute the next setup or assertion step for this scenario.
  cleanupPlanWorld,
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Execute the next setup or assertion step for this scenario.
  createActiveTask,
  // Execute the next setup or assertion step for this scenario.
  createPlanWorld,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  prepareRoom,
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  seedDeferredDeparture,
  // Execute the next setup or assertion step for this scenario.
  snapshotLocation,
  // Pagination step for list/contract coverage.
  ymdOffset,
  // Shape PlanWorld documents the fixture/response fields this suite touches.
  type PlanWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";
// HTTP harness to listen an in-process API for request-level tests.
import { patchJson, postJson } from "../httpHarness";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();
// REPS: repetition count to amplify race windows.
const REPS = 8;

// Suite: MA-01 past departure vs newer check-in.
describe("MA-01 past departure vs newer check-in", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: PlanWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Execute the next setup or assertion step for this scenario.
  let ownerToken: string;
  // Execute the next setup or assertion step for this scenario.
  let receptionToken: string;
  // Execute the next setup or assertion step for this scenario.
  let today: string;
  // Execute the next setup or assertion step for this scenario.
  let past: string;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Await async work before asserting or releasing locks.
    await ensureDefaultRoleGrants();
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createPlanWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
    // Await async work before asserting or releasing locks.
    ownerToken = (await loginBearer(api, world.owner.email, PLAN_PASSWORD)).token;
    // Execute the next setup or assertion step for this scenario.
    receptionToken = (
      // Await async work before asserting or releasing locks.
      await loginBearer(api, world.reception.email, PLAN_PASSWORD)
    // Execute the next setup or assertion step for this scenario.
    ).token;
    // Await async work before asserting or releasing locks.
    today = await hotelTodayYmd();
    // Pagination step for list/contract coverage.
    past = ymdOffset(today, -2);
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
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

  // Helper seedVacantVerifiedWithPastDeparture: arrange fixture data for the case.
  async function seedVacantVerifiedWithPastDeparture(locationId: string) {
    // Await async work before asserting or releasing locks.
    await cancelActiveTasks(prisma, locationId);
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, locationId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.verified_clean,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: 3,
    });
    // entry: seeded entity required before the mutation under test.
    const entry = await seedDeferredDeparture(prisma, {
      // Execute the next setup or assertion step for this scenario.
      hotelDateYmd: past,
      // Execute the next setup or assertion step for this scenario.
      locationId,
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: world.owner.employeeId,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: world.shiftId,
      // Execute the next setup or assertion step for this scenario.
      prepareOccupiedRoom: false,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.verified_clean,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: 3,
    });
    // Assigned task so bumpDirtyAndRebindWork locks CleaningTask before Location.
    const task = await createActiveTask(prisma, {
      // Execute the next setup or assertion step for this scenario.
      locationId,
      // Execute the next setup or assertion step for this scenario.
      hotelDateYmd: today,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: world.hk1.employeeId,
      // Execute the next setup or assertion step for this scenario.
      shiftId: world.shiftId,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: 3,
    });
    // Return the arranged value/result to the caller.
    return { entry, task };
  }

  // Helper assertCheckInSurvived: assert expected post-condition.
  async function assertCheckInSurvived(locationId: string, cycleBefore: number) {
    // loc: synchronize actors so the race window is observable.
    const loc = await snapshotLocation(prisma, locationId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(loc.occupancy, Occupancy.occupied, "occupancy must stay occupied");
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      loc.cleaningStatus,
      // Execute the next setup or assertion step for this scenario.
      CleaningStatus.verified_clean,
      // Execute the next setup or assertion step for this scenario.
      "verified_clean must be preserved",
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      loc.cleaningCycle,
      // Execute the next setup or assertion step for this scenario.
      cycleBefore,
      // Execute the next setup or assertion step for this scenario.
      "cleaningCycle must not bump for protected stay",
    );
    // occupiedAudits: synchronize actors so the race window is observable.
    const occupiedAudits = await prisma.auditEvent.count({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        locationId,
        // Execute the next setup or assertion step for this scenario.
        action: "location.set_occupancy",
        // Execute the next setup or assertion step for this scenario.
        after: { path: ["occupancy"], equals: Occupancy.occupied },
      },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(occupiedAudits >= 1, "check-in audit must exist");
    // departureTasks: synchronize actors so the race window is observable.
    const departureTasks = await prisma.cleaningTask.count({
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
    assert.equal(departureTasks, 0, "no new departure task for protected stay");
  }

  // Case: sequential control: check-in then apply → skipped:1, stay preserved.
  it("sequential control: check-in then apply → skipped:1, stay preserved", async () => {
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    const { entry } = await seedVacantVerifiedWithPastDeparture(world.locationAId);
    // before: synchronize actors so the race window is observable.
    const before = await snapshotLocation(prisma, world.locationAId);

    // checkIn: HTTP response captured for status/body checks.
    const checkIn = await patchJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      receptionToken,
      // Execute the next setup or assertion step for this scenario.
      `/locations/${world.locationAId}/occupancy`,
      // Execute the next setup or assertion step for this scenario.
      { occupancy: "occupied" },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(checkIn.status, 200, JSON.stringify(checkIn.body));

    // apply: in-process HTTP server handle for this suite.
    const apply = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      ownerToken,
      // Execute the next setup or assertion step for this scenario.
      "/daily-plan/apply-departure-effects",
      // Execute the next setup or assertion step for this scenario.
      { hotelDate: past },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(apply.status, 200, JSON.stringify(apply.body));
    // Bind body for later setup or assertions in this scope.
    const body = apply.body as { applied: number; skipped: number; deferred: number };
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.applied, 0, JSON.stringify(body));
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.skipped, 1, JSON.stringify(body));
    // Assert the observed value matches the intended post-condition.
    assert.equal(body.deferred, 0, JSON.stringify(body));

    // stamped: unique stamp so parallel runs do not collide.
    const stamped = await prisma.dailyPlanEntry.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: entry.id },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(stamped.roomEffectsAppliedAt, "protect stamps the entry");
    // Await async work before asserting or releasing locks.
    await assertCheckInSurvived(world.locationAId, before.cleaningCycle);
  });

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let rep = 1; rep <= REPS; rep++) {
    // Case probes concurrency/isolation: concurrent check-in∥apply: check-in commits while departure waits on task lock (rep ${rep}).
    it(`concurrent check-in∥apply: check-in commits while departure waits on task lock (rep ${rep})`, async () => {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      const { entry, task } = await seedVacantVerifiedWithPastDeparture(
        // Execute the next setup or assertion step for this scenario.
        world.locationAId,
      );
      // before: synchronize actors so the race window is observable.
      const before = await snapshotLocation(prisma, world.locationAId);

      // Hold CleaningTask until check-in commits, then release so apply decides
      // under locks with the newer stay already durable.
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
            SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE
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
        // applyP: in-process HTTP server handle for this suite.
        const applyP = postJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          ownerToken,
          // Execute the next setup or assertion step for this scenario.
          "/daily-plan/apply-departure-effects",
          // Execute the next setup or assertion step for this scenario.
          { hotelDate: past },
        );
        // Fire-and-await side effect required before the next assertion.
        void applyP.catch(() => undefined);
        // Coordinate DB lock waiters so the concurrent race is deterministic.
        await waitForBlockedBehind(prisma, holderPid, 1);
        // checkIn: HTTP response captured for status/body checks.
        const checkIn = await patchJson(
          // Execute the next setup or assertion step for this scenario.
          api,
          // Execute the next setup or assertion step for this scenario.
          receptionToken,
          // Execute the next setup or assertion step for this scenario.
          `/locations/${world.locationAId}/occupancy`,
          // Execute the next setup or assertion step for this scenario.
          { occupancy: "occupied" },
        );
        // Assert the observed value matches the intended post-condition.
        assert.equal(
          // Execute the next setup or assertion step for this scenario.
          checkIn.status,
          // Execute the next setup or assertion step for this scenario.
          200,
          // Concurrency/isolation step for the race under test.
          `check-in must commit while departure is blocked: ${JSON.stringify(checkIn.body)}`,
        );
        // Execute the next setup or assertion step for this scenario.
        release();
        // Await async work before asserting or releasing locks.
        await holder;
        // apply: in-process HTTP server handle for this suite.
        const apply = await applyP;
        // Assert HTTP status matches the contract for this path.
        assert.equal(apply.status, 200, JSON.stringify(apply.body));
        // Bind body for later setup or assertions in this scope.
        const body = apply.body as {
          // Execute the next setup or assertion step for this scenario.
          applied: number;
          // Execute the next setup or assertion step for this scenario.
          skipped: number;
          // Execute the next setup or assertion step for this scenario.
          deferred: number;
        };

        // Await async work before asserting or releasing locks.
        await assertCheckInSurvived(world.locationAId, before.cleaningCycle);
        // Assert the observed value matches the intended post-condition.
        assert.equal(
          // Execute the next setup or assertion step for this scenario.
          body.applied,
          0,
          // Execute the next setup or assertion step for this scenario.
          `must not apply over newer stay: ${JSON.stringify(body)}`,
        );
        // Assert the observed value matches the intended post-condition.
        assert.equal(
          // Execute the next setup or assertion step for this scenario.
          body.skipped,
          1,
          // Execute the next setup or assertion step for this scenario.
          `must protect/skip: ${JSON.stringify(body)}`,
        );

        // stamped: unique stamp so parallel runs do not collide.
        const stamped = await prisma.dailyPlanEntry.findUniqueOrThrow({
          // SQL fragment used to observe locks or assert DB state.
          where: { id: entry.id },
        });
        // Assert the observed value matches the intended post-condition.
        assert.ok(stamped.roomEffectsAppliedAt);
      // Execute the next setup or assertion step for this scenario.
      } finally {
        // Execute the next setup or assertion step for this scenario.
        release();
        // Await async work before asserting or releasing locks.
        await holder.catch(() => undefined);
        // Disconnect Prisma so the pool does not leak across suites.
        await holderPrisma.$disconnect();
      }
    });
  }
});
