/**
 * T-PLAN-57 — GET daily plan is read-only (P1-57).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import {
  PLAN_PASSWORD,
  assertLocationSnapEqual,
  cancelActiveTasks,
  cleanupPlanArtifacts,
  cleanupPlanWorld,
  closeServer,
  createPlanWorld,
  getJson,
  hotelTodayYmd,
  listenApp,
  loginBearer,
  seedDeferredDeparture,
  snapshotEntry,
  snapshotLocation,
  ymdOffset,
  type PlanWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});

const prisma = new PrismaClient();

describe("daily plan read-only GET (T-PLAN-57 / P1-57)", () => {
  let world: PlanWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let ownerToken: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    world = await createPlanWorld(prisma);
    ({ server, api } = await listenApp());
    const login = await loginBearer(api, world.owner.email, PLAN_PASSWORD);
    ownerToken = login.token;
  });

  after(async () => {
    if (server) await closeServer(server);
    if (world) await cleanupPlanWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("T-PLAN-57: GET with pending deferred departures does not apply effects", async () => {
    const today = await hotelTodayYmd();
    const past = ymdOffset(today, -3);
    await cleanupPlanArtifacts(prisma, [
      world.locationAId,
      world.locationBId,
      world.locationCId,
      world.archivedLocationId,
    ]);
    await cancelActiveTasks(prisma, world.locationAId, past);

    const entry = await seedDeferredDeparture(prisma, {
      hotelDateYmd: past,
      locationId: world.locationAId,
      createdByEmployeeId: world.owner.employeeId,
    });
    const beforeLoc = await snapshotLocation(prisma, world.locationAId);
    const beforeEntry = await snapshotEntry(prisma, entry.id);
    const beforeTasks = await prisma.cleaningTask.findMany({
      where: { locationId: world.locationAId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        status: true,
        priority: true,
        cleaningCycle: true,
      },
    });

    const first = await getJson(
      api,
      ownerToken,
      `/daily-plan?hotelDate=${past}`,
    );
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const midLoc = await snapshotLocation(prisma, world.locationAId);
    const midEntry = await snapshotEntry(prisma, entry.id);
    assertLocationSnapEqual(midLoc, beforeLoc, "after first GET");
    assert.deepEqual(midEntry, beforeEntry);

    const second = await getJson(
      api,
      ownerToken,
      `/daily-plan?hotelDate=${past}`,
    );
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assertLocationSnapEqual(
      await snapshotLocation(prisma, world.locationAId),
      beforeLoc,
      "after second GET",
    );
    assert.deepEqual(await snapshotEntry(prisma, entry.id), beforeEntry);
    assert.equal(
      (await snapshotEntry(prisma, entry.id)).roomEffectsAppliedAt,
      null,
    );
    const afterTasks = await prisma.cleaningTask.findMany({
      where: { locationId: world.locationAId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        status: true,
        priority: true,
        cleaningCycle: true,
      },
    });
    assert.deepEqual(afterTasks, beforeTasks);
  });
});
