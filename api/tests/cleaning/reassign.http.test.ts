/**
 * T-CLN-28 — reception allow_reception_reassign gate (HTTP).
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
  withFlagsPatch,
  type CleaningWorld,
} from "./fixtures";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-cleaning-reassign-http";

const prisma = new PrismaClient();

describe("cleaning reassign HTTP (T-CLN-28)", () => {
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

  it("T-CLN-28: reception blocked by flag; manager succeeds", async () => {
    await resetCleaningWork(prisma, world);
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });

    await withFlagsPatch(
      world.owner.employeeId,
      { allow_reception_reassign: false },
      async () => {
        const { token: receptionToken } = await loginBearer(
          api,
          world.reception.email,
          CLN_PASSWORD,
        );
        const receptionRes = await postJson(
          api,
          receptionToken,
          `/cleaning/tasks/${task.id}/reassign`,
          {
            assignedEmployeeId: world.hk2.employeeId,
            reason: "reception attempt",
            expectedVersion: task.version,
          },
        );
        assert.equal(receptionRes.status, 403);
        const body = receptionRes.body as {
          error?: string;
          message?: string;
        };
        assert.equal(body.error, "forbidden");
        assert.equal(
          body.message,
          "Reception reassign is disabled in settings",
        );

        const { token: managerToken } = await loginBearer(
          api,
          world.manager.email,
          CLN_PASSWORD,
        );
        const managerRes = await postJson(
          api,
          managerToken,
          `/cleaning/tasks/${task.id}/reassign`,
          {
            assignedEmployeeId: world.hk2.employeeId,
            reason: "manager reassign ok",
            expectedVersion: task.version,
          },
        );
        assert.equal(managerRes.status, 200);
        const updated = managerRes.body as {
          assignedEmployeeId?: string;
          reassignReason?: string;
        };
        assert.equal(updated.assignedEmployeeId, world.hk2.employeeId);
        assert.equal(updated.reassignReason, "manager reassign ok");
      },
    );
  });
});
