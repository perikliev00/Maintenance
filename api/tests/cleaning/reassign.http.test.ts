/**
 * reception allow_reception_reassign gate (HTTP).
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { createCleaningTask } from "../../src/services/cleaning";
import { ensureDefaultRoleGrants } from "../../src/services/roleGrants";
import { withDatabaseBarrier } from "../dbBarrier";
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

describe("cleaning reassign HTTP", () => {
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

  it("reception blocked by flag; manager succeeds", async () => {
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

  for (const startFirst of [true, false]) {
    it(`HTTP: ${startFirst ? "start": "reassign"} first never returns 500`, async () => {
      await resetCleaningWork(prisma, world);
      const today = await hotelTodayYmd();
      const task = await createCleaningTask({
        locationId: world.locationAId,
        hotelDate: today,
        assignedEmployeeId: world.hk1.employeeId,
        actorEmployeeId: world.owner.employeeId,
      });
      const { token: hkToken } = await loginBearer(api, world.hk1.email, CLN_PASSWORD);
      const { token: managerToken } = await loginBearer(api, world.manager.email, CLN_PASSWORD);
      const start = () => postJson(api, hkToken, `/cleaning/tasks/${task.id}/start`, {
        commandId: randomUUID(),
        expectedVersion: task.version,
      });
      const reassign = () => postJson(api, managerToken, `/cleaning/tasks/${task.id}/reassign`, {
        assignedEmployeeId: world.hk2.employeeId,
        reason: "HTTP lock-order race",
        expectedVersion: task.version,
      });

      const ordered = await withDatabaseBarrier(
        prisma,
        (tx) => tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE`,
        async (waitFor) => {
          const first = (startFirst ? start : reassign)();
          await waitFor(1);
          const second = (startFirst ? reassign : start)();
          return Promise.all([first, second]);
        },
      );
      const [startResponse, reassignResponse] = startFirst
        ? ordered
        : [ordered[1]!, ordered[0]!];

      assert.notEqual(startResponse.status, 500);
      assert.notEqual(reassignResponse.status, 500);
      assert.equal(startResponse.status, startFirst ? 201 : 409);
      assert.equal(reassignResponse.status, startFirst ? 409 : 200);

      const finalTask = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: task.id } });
      const running = await prisma.cleaningSession.findFirst({
        where: { taskId: task.id, status: "running" },
      });
      assert.equal(Boolean(running), startFirst);
      assert.equal(
        finalTask.assignedEmployeeId,
        startFirst ? world.hk1.employeeId : world.hk2.employeeId,
      );
      if (running) assert.equal(running.employeeId, world.hk1.employeeId);
    });
  }
});
