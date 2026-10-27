/**
 * Available-housekeepers HTTP + reassign availability conflict.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { createCleaningTask } from "../../src/services/cleaning";
import { ensureDefaultRoleGrants } from "../../src/services/roleGrants";
import {
  closeServer,
  getJson,
  listenApp,
  loginBearer,
  postJson,
} from "../httpHarness";
import {
  CLN_PASSWORD,
  cleanupCleaningWorld,
  createCleaningWorld,
  hotelTodayYmd,
  resetCleaningWork,
  type CleaningWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-cleaning-availability-http";

const prisma = new PrismaClient();

describe("cleaning available-housekeepers HTTP", () => {
  let world: CleaningWorld;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let api = "";

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await ensureDefaultRoleGrants();
    world = await createCleaningWorld(prisma);
    const listened = await listenApp();
    server = listened.server;
    api = listened.api;
  });

  after(async () => {
    if (server) await closeServer(server);
    if (world) await cleanupCleaningWorld(prisma, world);
    await prisma.$disconnect();
  });

  it("lists housekeepers with availability and excludes current assignee", async () => {
    await resetCleaningWork(prisma, world);
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });

    const { token } = await loginBearer(
      api,
      world.manager.email,
      CLN_PASSWORD,
    );
    const res = await getJson(
      api,
      token,
      `/cleaning/available-housekeepers?locationId=${world.locationAId}&taskId=${task.id}`,
    );
    assert.equal(res.status, 200);
    const body = res.body as {
      housekeepers: Array<{
        employeeId: string;
        availabilityStatus: string;
        assignedTaskCount: number;
      }>;
    };
    assert.ok(Array.isArray(body.housekeepers));
    assert.ok(
      !body.housekeepers.some((h) => h.employeeId === world.hk1.employeeId),
    );
    const hk2 = body.housekeepers.find(
      (h) => h.employeeId === world.hk2.employeeId,
    );
    assert.ok(hk2);
    assert.equal(hk2.availabilityStatus, "available");
  });

  it("rejects ordinary reassign when replacement is off_shift", async () => {
    await resetCleaningWork(prisma, world);
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });

    // Remove roster so hk2 becomes off_shift.
    await prisma.employeeShiftRoster.deleteMany({
      where: { employeeId: world.hk2.employeeId },
    });

    const { token } = await loginBearer(
      api,
      world.manager.email,
      CLN_PASSWORD,
    );
    const blocked = await postJson(
      api,
      token,
      `/cleaning/tasks/${task.id}/reassign`,
      {
        assignedEmployeeId: world.hk2.employeeId,
        reason: "should fail without override",
        expectedVersion: task.version,
      },
    );
    assert.equal(blocked.status, 409);
    const blockedBody = blocked.body as { error?: string };
    assert.equal(blockedBody.error, "availability_conflict");

    const forced = await postJson(
      api,
      token,
      `/cleaning/tasks/${task.id}/reassign`,
      {
        assignedEmployeeId: world.hk2.employeeId,
        reason: "manager override for ops",
        expectedVersion: task.version,
        forceDespiteAvailability: true,
      },
    );
    assert.equal(forced.status, 200);
  });
});
