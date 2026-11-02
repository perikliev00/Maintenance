/**
 * cleaning sync assignee bypass parity with HTTP.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { GrantKind, Role, SessionStatus } from "@prisma/client";
import { prisma } from "../../src/db";
import { createCleaningTask } from "../../src/services/cleaning";
import { assertTestDatabase } from "../assertTestDatabase";
import { invalidateGrantCache } from "../../src/services/roleGrants";
import { closeServer, listenApp, loginBearer, postJson } from "../httpHarness";
import {
  CLN_PASSWORD,
  cleanupCleaningWorld,
  createAndStartToday,
  createCleaningWorld,
  hotelTodayYmd,
  resetCleaningWork,
  type CleaningWorld,
} from "../cleaning/fixtures";

describe("sync push cleaning assignee gate", () => {
  let world: CleaningWorld;
  let api: string;
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let hk1Token: string;
  let hk2Token: string;
  let managerToken: string;

  before(async () => {
    await assertTestDatabase(prisma);
    process.env.E2E_DISABLE_RATE_LIMIT = "1";
    for (const key of ["cleaning.start", "cleaning.complete"] as const) {
      await prisma.roleGrant.upsert({
        where: {
          role_kind_key: { role: Role.manager, kind: GrantKind.action, key },
        },
        create: { role: Role.manager, kind: GrantKind.action, key },
        update: {},
      });
    }
    invalidateGrantCache();
    world = await createCleaningWorld(prisma);
    ({ api, server } = await listenApp());
    hk1Token = (await loginBearer(api, world.hk1.email, CLN_PASSWORD)).token;
    hk2Token = (await loginBearer(api, world.hk2.email, CLN_PASSWORD)).token;
    managerToken = (await loginBearer(api, world.manager.email, CLN_PASSWORD))
      .token;
  });

  beforeEach(async () => {
    await resetCleaningWork(prisma, world);
    await prisma.syncRun.deleteMany({
      where: {
        user: {
          employeeId: {
            in: [
              world.hk1.employeeId,
              world.hk2.employeeId,
              world.manager.employeeId,
            ],
          },
        },
      },
    });
  });

  after(async () => {
    if (server) await closeServer(server);
    if (world) {
      await prisma.syncRun.deleteMany({
        where: { user: { employeeId: { in: world.employeeIds } } },
      });
      await cleanupCleaningWorld(prisma, world);
    }
    await prisma.$disconnect();
  });

  it("foreign housekeeper is forbidden on sync cleaning.start", async () => {
    const today = await hotelTodayYmd();
    const task = await createCleaningTask({
      locationId: world.locationAId,
      hotelDate: today,
      assignedEmployeeId: world.hk1.employeeId,
      actorEmployeeId: world.owner.employeeId,
    });
    const cmd = {
      commandId: randomUUID(),
      type: "cleaning.start",
      payload: { taskId: task.id, expectedVersion: task.version },
      clientTime: "2026-01-01T00:00:00Z",
    };
    const res = await postJson(api, hk2Token, "/sync/push", { commands: [cmd] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const result = (
      res.body as { results: Array<{ status: string; message?: string }> }
    ).results[0];
    assert.ok(
      result.status === "forbidden" || result.status === "conflict",
      `expected deny, got ${JSON.stringify(result)}`,
    );

    const after = await prisma.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(after.status, "assigned");
    assert.equal(after.assignedEmployeeId, world.hk1.employeeId);
  });

  it("manager bypasses session owner via sync cleaning.complete", async () => {
    const { started } = await createAndStartToday(
      world,
      world.locationAId,
      world.hk1.employeeId,
    );
    const completeCmd = {
      commandId: randomUUID(),
      type: "cleaning.complete",
      payload: {
        sessionId: started.session.id,
        expectedVersion: started.task.version,
      },
      clientTime: "2026-01-01T00:00:01Z",
    };
    const completeRes = await postJson(api, managerToken, "/sync/push", {
      commands: [completeCmd],
    });
    assert.equal(completeRes.status, 200, JSON.stringify(completeRes.body));
    assert.equal(
      (completeRes.body as { results: Array<{ status: string }> }).results[0]
        .status,
      "ok",
      JSON.stringify(completeRes.body),
    );

    const session = await prisma.cleaningSession.findUniqueOrThrow({
      where: { id: started.session.id },
    });
    assert.equal(session.status, SessionStatus.completed);
    assert.equal(session.employeeId, world.hk1.employeeId);
    assert.equal(session.completeActorEmployeeId, world.manager.employeeId);
  });

  it("assignee can still progress own task via sync (non-bypass control)", async () => {
    const { started } = await createAndStartToday(
      world,
      world.locationAId,
      world.hk1.employeeId,
    );
    const cmd = {
      commandId: randomUUID(),
      type: "cleaning.complete",
      payload: {
        sessionId: started.session.id,
        expectedVersion: started.task.version,
      },
      clientTime: "2026-01-01T00:00:00Z",
    };
    const res = await postJson(api, hk1Token, "/sync/push", { commands: [cmd] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(
      (res.body as { results: Array<{ status: string }> }).results[0].status,
      "ok",
    );
    const session = await prisma.cleaningSession.findUniqueOrThrow({
      where: { id: started.session.id },
    });
    assert.equal(session.status, SessionStatus.completed);
  });
});
