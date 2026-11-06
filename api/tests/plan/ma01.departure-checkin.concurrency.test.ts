/**
 * MA-01 — completed newer check-in survives concurrent apply of a past departure.
 * HTTP + PostgreSQL barrier on CleaningTask (departure decides before location lock).
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  CleaningStatus,
  Occupancy,
  PrismaClient,
  TaskStatus,
} from "@prisma/client";
import { assertTestDatabase } from "../assertTestDatabase";
import { waitForBlockedBehind } from "../dbBarrier";
import { ensureDefaultRoleGrants } from "../../src/services/roleGrants";
import {
  PLAN_PASSWORD,
  cancelActiveTasks,
  cleanupPlanArtifacts,
  cleanupPlanWorld,
  closeServer,
  createActiveTask,
  createPlanWorld,
  hotelTodayYmd,
  listenApp,
  loginBearer,
  prepareRoom,
  seedDeferredDeparture,
  snapshotLocation,
  ymdOffset,
  type PlanWorld,
} from "./fixtures";
import { patchJson, postJson } from "../httpHarness";

const prisma = new PrismaClient();
const REPS = 8;

describe("MA-01 past departure vs newer check-in", () => {
  let world: PlanWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let ownerToken: string;
  let receptionToken: string;
  let today: string;
  let past: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    await ensureDefaultRoleGrants();
    world = await createPlanWorld(prisma);
    ({ server, api } = await listenApp());
    ownerToken = (await loginBearer(api, world.owner.email, PLAN_PASSWORD)).token;
    receptionToken = (
      await loginBearer(api, world.reception.email, PLAN_PASSWORD)
    ).token;
    today = await hotelTodayYmd();
    past = ymdOffset(today, -2);
  });

  after(async () => {
    if (server) await closeServer(server);
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

  async function seedVacantVerifiedWithPastDeparture(locationId: string) {
    await cancelActiveTasks(prisma, locationId);
    await prepareRoom(prisma, locationId, {
      occupancy: Occupancy.vacant,
      cleaningStatus: CleaningStatus.verified_clean,
      cleaningCycle: 3,
    });
    const entry = await seedDeferredDeparture(prisma, {
      hotelDateYmd: past,
      locationId,
      createdByEmployeeId: world.owner.employeeId,
      assignedEmployeeId: world.hk1.employeeId,
      shiftId: world.shiftId,
      prepareOccupiedRoom: false,
      cleaningStatus: CleaningStatus.verified_clean,
      cleaningCycle: 3,
    });
    // Assigned task so bumpDirtyAndRebindWork locks CleaningTask before Location.
    const task = await createActiveTask(prisma, {
      locationId,
      hotelDateYmd: today,
      assignedEmployeeId: world.hk1.employeeId,
      shiftId: world.shiftId,
      cleaningCycle: 3,
    });
    return { entry, task };
  }

  async function assertCheckInSurvived(locationId: string, cycleBefore: number) {
    const loc = await snapshotLocation(prisma, locationId);
    assert.equal(loc.occupancy, Occupancy.occupied, "occupancy must stay occupied");
    assert.equal(
      loc.cleaningStatus,
      CleaningStatus.verified_clean,
      "verified_clean must be preserved",
    );
    assert.equal(
      loc.cleaningCycle,
      cycleBefore,
      "cleaningCycle must not bump for protected stay",
    );
    const occupiedAudits = await prisma.auditEvent.count({
      where: {
        locationId,
        action: "location.set_occupancy",
        after: { path: ["occupancy"], equals: Occupancy.occupied },
      },
    });
    assert.ok(occupiedAudits >= 1, "check-in audit must exist");
    const departureTasks = await prisma.cleaningTask.count({
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
    assert.equal(departureTasks, 0, "no new departure task for protected stay");
  }

  it("sequential control: check-in then apply → skipped:1, stay preserved", async () => {
    const { entry } = await seedVacantVerifiedWithPastDeparture(world.locationAId);
    const before = await snapshotLocation(prisma, world.locationAId);

    const checkIn = await patchJson(
      api,
      receptionToken,
      `/locations/${world.locationAId}/occupancy`,
      { occupancy: "occupied" },
    );
    assert.equal(checkIn.status, 200, JSON.stringify(checkIn.body));

    const apply = await postJson(
      api,
      ownerToken,
      "/daily-plan/apply-departure-effects",
      { hotelDate: past },
    );
    assert.equal(apply.status, 200, JSON.stringify(apply.body));
    const body = apply.body as { applied: number; skipped: number; deferred: number };
    assert.equal(body.applied, 0, JSON.stringify(body));
    assert.equal(body.skipped, 1, JSON.stringify(body));
    assert.equal(body.deferred, 0, JSON.stringify(body));

    const stamped = await prisma.dailyPlanEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    assert.ok(stamped.roomEffectsAppliedAt, "protect stamps the entry");
    await assertCheckInSurvived(world.locationAId, before.cleaningCycle);
  });

  for (let rep = 1; rep <= REPS; rep++) {
    it(`concurrent check-in∥apply: check-in commits while departure waits on task lock (rep ${rep})`, async () => {
      const { entry, task } = await seedVacantVerifiedWithPastDeparture(
        world.locationAId,
      );
      const before = await snapshotLocation(prisma, world.locationAId);

      // Hold CleaningTask until check-in commits, then release so apply decides
      // under locks with the newer stay already durable.
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
            SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE
          `;
          ready(row!.pid);
          await gate;
        },
        { timeout: 20_000, maxWait: 20_000 },
      );

      try {
        const holderPid = await held;
        const applyP = postJson(
          api,
          ownerToken,
          "/daily-plan/apply-departure-effects",
          { hotelDate: past },
        );
        void applyP.catch(() => undefined);
        await waitForBlockedBehind(prisma, holderPid, 1);
        const checkIn = await patchJson(
          api,
          receptionToken,
          `/locations/${world.locationAId}/occupancy`,
          { occupancy: "occupied" },
        );
        assert.equal(
          checkIn.status,
          200,
          `check-in must commit while departure is blocked: ${JSON.stringify(checkIn.body)}`,
        );
        release();
        await holder;
        const apply = await applyP;
        assert.equal(apply.status, 200, JSON.stringify(apply.body));
        const body = apply.body as {
          applied: number;
          skipped: number;
          deferred: number;
        };

        await assertCheckInSurvived(world.locationAId, before.cleaningCycle);
        assert.equal(
          body.applied,
          0,
          `must not apply over newer stay: ${JSON.stringify(body)}`,
        );
        assert.equal(
          body.skipped,
          1,
          `must protect/skip: ${JSON.stringify(body)}`,
        );

        const stamped = await prisma.dailyPlanEntry.findUniqueOrThrow({
          where: { id: entry.id },
        });
        assert.ok(stamped.roomEffectsAppliedAt);
      } finally {
        release();
        await holder.catch(() => undefined);
        await holderPrisma.$disconnect();
      }
    });
  }
});
